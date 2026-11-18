#!/usr/bin/env python3
"""
Voice-over mit Nari Labs Dia (https://github.com/nari-labs/dia), lokal und kostenlos.

Aufruf (vom Node-Server):
  python dia_tts.py <job.json>
job.json: {"texts": ["...", ...], "outDir": "...", "prefix": "voice-",
           "voicePrompt": "/opt/dia/voice.wav" | null, "seed": 42}

Laedt das Modell EINMAL pro Reel und erzeugt eine WAV je Text:
<outDir>/<prefix><i>.wav. Eine Zeile "OK <i>" pro fertiger Datei auf stdout.

Gleiche Stimme in allen Szenen:
  - voicePrompt existiert: diese Aufnahme (+ voice.txt mit ihrem Text) ist die Stimme.
  - sonst: Szene 0 wird mit festem Seed erzeugt und dient fuer alle weiteren
    Szenen als Stimmvorlage. Ist voicePrompt gesetzt, aber die Datei fehlt,
    wird Szene 0 dort gespeichert -> ab dann immer dieselbe Stimme.
"""
import json
import os
import random
import shutil
import sys


def main() -> None:
    job = json.load(open(sys.argv[1], encoding="utf-8"))
    import numpy as np
    import torch
    from dia.model import Dia

    seed = int(job.get("seed", 42))
    device = os.environ.get("DIA_DEVICE") or ("cuda" if torch.cuda.is_available() else "cpu")
    dtype = os.environ.get("DIA_DTYPE") or ("float16" if device == "cuda" else "float32")
    model_id = os.environ.get("DIA_MODEL_ID", "nari-labs/Dia-1.6B-0626")
    if device == "cpu":
        torch.set_num_threads(max(1, os.cpu_count() or 1))
    model = Dia.from_pretrained(model_id, compute_dtype=dtype, device=torch.device(device))

    def seed_all() -> None:
        random.seed(seed)
        np.random.seed(seed)
        torch.manual_seed(seed)
        if device == "cuda":
            torch.cuda.manual_seed_all(seed)

    def gen(text: str, prompt_wav, prompt_text):
        seed_all()
        full = f"[S1] {text}"
        kwargs = dict(
            use_torch_compile=False,
            verbose=False,
            cfg_scale=float(os.environ.get("DIA_CFG_SCALE", "3.0")),
            temperature=float(os.environ.get("DIA_TEMPERATURE", "1.6")),
            top_p=0.90,
            cfg_filter_top_k=45,
        )
        if prompt_wav:
            # Dia erwartet den Text der Vorlage vor dem neuen Text
            full = f"[S1] {prompt_text} {full}"
            kwargs["audio_prompt"] = prompt_wav
        return model.generate(full, **kwargs)

    out_dir, prefix = job["outDir"], job.get("prefix", "voice-")
    vp = job.get("voicePrompt")
    prompt_wav = prompt_text = None
    if vp and os.path.isfile(vp):
        txt = os.path.splitext(vp)[0] + ".txt"
        if os.path.isfile(txt):
            prompt_wav, prompt_text = vp, open(txt, encoding="utf-8").read().strip()

    for i, text in enumerate(job["texts"]):
        if not text.strip():
            continue
        f = os.path.join(out_dir, f"{prefix}{i}.wav")
        audio = gen(text, prompt_wav, prompt_text)
        model.save_audio(f, audio)
        if prompt_wav is None:
            # erste Szene wird zur Stimmvorlage fuer den Rest
            prompt_wav, prompt_text = f, text
            if vp and not os.path.isfile(vp):
                os.makedirs(os.path.dirname(vp) or ".", exist_ok=True)
                shutil.copyfile(f, vp)
                open(os.path.splitext(vp)[0] + ".txt", "w", encoding="utf-8").write(text)
        print(f"OK {i}", flush=True)


if __name__ == "__main__":
    main()
