const state = { kind: "raw" };

const tabs = document.querySelectorAll(".tab");
const rawInput = document.getElementById("raw-input");
const moxfieldInput = document.getElementById("moxfield-input");

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    state.kind = tab.dataset.kind;
    rawInput.style.display = state.kind === "raw" ? "block" : "none";
    moxfieldInput.style.display = state.kind === "moxfield" ? "block" : "none";
  });
});

const generateBtn = document.getElementById("generate-btn");
const generateStatus = document.getElementById("generate-status");
const jobsList = document.getElementById("jobs-list");

generateBtn.addEventListener("click", async () => {
  const dryRun = document.getElementById("dry-run").checked;
  const useLlm = document.getElementById("use-llm").checked;
  const scheduledAtRaw = document.getElementById("scheduled-at").value;
  const scheduledAt = scheduledAtRaw ? new Date(scheduledAtRaw).toISOString() : null;

  if (!dryRun) {
    const when = scheduledAt ? `am ${new Date(scheduledAt).toLocaleString("de-DE")}` : "SOFORT";
    const ok = confirm(
      `Dieses Deck wird ${when} WIRKLICH auf Instagram (@floating._.mana) veroeffentlicht. Fortfahren?`
    );
    if (!ok) return;
  }

  const payload = {
    kind: state.kind,
    dryRun,
    useLlm,
    scheduledAt,
  };
  if (state.kind === "raw") payload.raw = rawInput.value;
  if (state.kind === "moxfield") payload.moxfieldUrl = moxfieldInput.value;

  generateBtn.disabled = true;
  generateStatus.textContent = "Generiere Slides... (Puppeteer + Scryfall" + (useLlm ? " + LLM" : "") + ", kann etwas dauern)";

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
    scheduled: "Geplant",
    generating: "Wird generiert...",
    ready: "Bereit (Preview)",
    publishing: "Wird veroeffentlicht...",
    published: "Veroeffentlicht",
    failed: "Fehlgeschlagen",
    cancelled: "Storniert",
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

  const scheduledLine = job.scheduledAt
    ? `<div>Geplant fuer: ${new Date(job.scheduledAt).toLocaleString("de-DE")}</div>`
    : "";

  const actions = [];
  if (job.status === "ready" || job.status === "scheduled") {
    actions.push(`<button data-action="publish" data-id="${job.id}">Jetzt veroeffentlichen</button>`);
  }
  if (job.status === "scheduled") {
    actions.push(`<button data-action="cancel" data-id="${job.id}">Stornieren</button>`);
  }
  if (job.captionUrl) {
    actions.push(`<a href="${job.captionUrl}" target="_blank">caption.txt</a>`);
  }

  el.innerHTML = `
    <div class="job-header">
      <span class="badge status-${job.status}">${statusLabel(job.status)}</span>
      <span class="job-id">${job.id}</span>
      ${job.dryRun ? '<span class="badge dry">Dry-Run</span>' : ""}
    </div>
    <div class="deck-line">${deck}</div>
    ${scheduledLine}
    ${job.error ? `<div class="error-line">${job.error}</div>` : ""}
    <div class="slides">${slides}</div>
    <div class="actions">${actions.join(" ")}</div>
  `;

  el.querySelectorAll("button[data-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const action = btn.dataset.action;
      if (action === "publish") {
        const ok = confirm("Jetzt WIRKLICH auf Instagram veroeffentlichen?");
        if (!ok) return;
      }
      btn.disabled = true;
      await fetch(`/api/jobs/${id}/${action === "publish" ? "publish-now" : "cancel"}`, {
        method: "POST",
      });
      await refreshJobs();
    });
  });

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
