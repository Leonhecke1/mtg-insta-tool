#!/usr/bin/env python3
"""
Voice-over mit Kokoro (kokoro-onnx, https://github.com/thewh1teagle/kokoro-onnx),
klein genug fuer einen Server ohne Grafikkarte, Apache-2.0.

Aufruf (vom Node-Server):
  python kokoro_tts.py <job.json>
job.json: {"texts": ["...", ...], "outDir": "...", "prefix": "voice-",
           "model": "/opt/kokoro/kokoro-v1.0.int8.onnx", "voices": "/opt/kokoro/voices-v1.0.bin",
           "voice": "am_michael", "speed": 1.0}

Laedt das Modell EINMAL pro Reel und schreibt <outDir>/<prefix><i>.wav je Text.
Eine Zeile "OK <i>" pro fertiger Datei auf stdout. Die Stimme ist eine feste
Voreinstellung: jede Szene klingt gleich.
"""
import json
import os
import sys


def main() -> None:
    job = json.load(open(sys.argv[1], encoding="utf-8"))
    import soundfile as sf
    from kokoro_onnx import Kokoro

    kokoro = Kokoro(job["model"], job["voices"])
    voice = job.get("voice") or "am_michael"
    speed = float(job.get("speed") or 1.0)
    out_dir, prefix = job["outDir"], job.get("prefix", "voice-")
    for i, text in enumerate(job["texts"]):
        if not text.strip():
            continue
        samples, sr = kokoro.create(text, voice=voice, speed=speed, lang="en-us")
        sf.write(os.path.join(out_dir, f"{prefix}{i}.wav"), samples, sr)
        print(f"OK {i}", flush=True)


if __name__ == "__main__":
    main()
