const state = { kind: "raw" };

const tabs = document.querySelectorAll(".tab");
const rawInput = document.getElementById("raw-input");
const moxfieldInput = document.getElementById("moxfield-input");
const archidektInput = document.getElementById("archidekt-input");

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    state.kind = tab.dataset.kind;
    rawInput.style.display = state.kind === "raw" ? "block" : "none";
    moxfieldInput.style.display = state.kind === "moxfield" ? "block" : "none";
    archidektInput.style.display = state.kind === "archidekt" ? "block" : "none";
  });
});

const generateBtn = document.getElementById("generate-btn");
const generateStatus = document.getElementById("generate-status");
const jobsList = document.getElementById("jobs-list");

generateBtn.addEventListener("click", async () => {
  const useLlm = document.getElementById("use-llm").checked;

  const payload = { kind: state.kind, useLlm };
  if (state.kind === "raw") payload.raw = rawInput.value;
  if (state.kind === "moxfield") payload.moxfieldUrl = moxfieldInput.value;
  if (state.kind === "archidekt") payload.archidektUrl = archidektInput.value;

  generateBtn.disabled = true;
  generateStatus.textContent =
    "Generiere Slides... (Puppeteer + Scryfall" + (useLlm ? " + LLM" : "") + ", kann etwas dauern)";

  try {
    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Unbekannter Fehler");
    generateStatus.textContent = `Job ${data.id}: Status "${data.status}"`;
    await refreshJobs();
  } catch (err) {
    generateStatus.textContent = "Fehler: " + err.message;
  } finally {
    generateBtn.disabled = false;
  }
});

function statusLabel(status) {
  const map = {
    generating: "Wird generiert...",
    ready: "Fertig",
    failed: "Fehlgeschlagen",
  };
  return map[status] || status;
}

function jobCard(job) {
  const el = document.createElement("div");
  el.className = "job-card";

  const slides = (job.slideUrls || [])
    .map((url) => `<img src="${url}?t=${Date.now()}" alt="slide" />`)
    .join("");

  const deck = job.deckSummary
    ? `${job.deckSummary.commander} &middot; ${job.deckSummary.cardCount} Karten &middot; ${job.deckSummary.colorIdentity.join("")}`
    : "";

  const fallbackNote =
    job.usedFallbackNames && job.usedFallbackNames.length > 0
      ? `<div class="fallback-note">Scryfall war fuer ${job.usedFallbackNames.length} Karte(n) nicht erreichbar - Moxfield/Archidekt-Daten als Fallback genutzt.</div>`
      : "";

  const actions = [];
  if (job.zipUrl) {
    actions.push(`<a class="zip-link" href="${job.zipUrl}" download>ZIP herunterladen</a>`);
  }
  if (job.captionUrl) {
    actions.push(`<a href="${job.captionUrl}" target="_blank">caption.txt</a>`);
  }

  el.innerHTML = `
    <div class="job-header">
      <span class="badge status-${job.status}">${statusLabel(job.status)}</span>
      <span class="job-id">${job.id}</span>
    </div>
    <div class="deck-line">${deck}</div>
    ${fallbackNote}
    ${job.error ? `<div class="error-line">${job.error}</div>` : ""}
    <div class="slides">${slides}</div>
    <div class="actions">${actions.join(" ")}</div>
  `;

  return el;
}

async function refreshJobs() {
  const res = await fetch("/api/jobs");
  const jobs = await res.json();
  jobsList.innerHTML = "";
  jobs.forEach((job) => jobsList.appendChild(jobCard(job)));
}

refreshJobs();
setInterval(refreshJobs, 5000);
