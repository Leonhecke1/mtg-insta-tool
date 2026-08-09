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
const modalRoot = document.getElementById("edit-modal-root");

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

// Welche Slide-Kinds haben bearbeitbaren Text (siehe src/types.ts SlideKind
// und server.ts POST /api/jobs/:id/texts) - "upgrades" zeigt nur noch
// Bild+Preis, kein Freitext mehr, daher nicht mehr editierbar.
const EDITABLE_KINDS = new Set(["cover", "gameplan"]);

// Bumped jedes Mal, wenn eine Job-Karte tatsaechlich neu gebaut wird (siehe
// refreshJobs) - nur dann bekommen ihre Bilder einen frischen Cache-Buster.
// Verhindert, dass unveraenderte Jobs bei jedem 5s-Poll neu geladen werden
// (das Flackern kam vom alten ?t=Date.now() bei JEDEM Refresh).
const jobVersions = new Map();
const renderedJobs = new Map(); // jobId -> { el, snapshot }

// Eingeklappte Jobs bleiben in data/jobs.json erhalten (siehe README) -
// "ausblenden" ist rein clientseitig, ueberlebt aber Reloads via
// localStorage.
const COLLAPSED_KEY = "mtg-insta-tool:collapsedJobs";
const collapsedJobs = new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) || "[]"));

function saveCollapsed() {
  localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsedJobs]));
}

function jobCard(job, version) {
  const el = document.createElement("div");
  const isCollapsed = collapsedJobs.has(job.id);
  el.className = "job-card" + (isCollapsed ? " collapsed" : "");

  const slides = (job.slideUrls || [])
    .map((url, i) => {
      const kind = (job.slideKinds || [])[i];
      const editable = EDITABLE_KINDS.has(kind);
      return `<img src="${url}?v=${version}" alt="slide" ${
        editable ? `class="editable" data-job="${job.id}" data-kind="${kind}" title="Text bearbeiten"` : ""
      } />`;
    })
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
  if (job.status === "ready") {
    actions.push(`<button type="button" data-edit-caption data-job="${job.id}">Caption bearbeiten</button>`);
  }

  el.innerHTML = `
    <div class="job-header">
      <button type="button" class="collapse-toggle" data-toggle-collapse data-job="${job.id}" title="Ein-/Ausblenden">${
        isCollapsed ? "▸" : "▾"
      }</button>
      <span class="badge status-${job.status}">${statusLabel(job.status)}</span>
      <span class="job-id">${job.id}</span>
      <span class="deck-line-inline">${deck}</span>
    </div>
    <div class="job-body">
      <div class="deck-line">${deck}</div>
      ${fallbackNote}
      ${job.error ? `<div class="error-line">${job.error}</div>` : ""}
      <div class="slides">${slides}</div>
      <div class="actions">${actions.join(" ")}</div>
    </div>
  `;

  return el;
}

/**
 * Baut nur Job-Karten neu, deren Daten sich seit dem letzten Poll
 * tatsaechlich geaendert haben (Snapshot-Vergleich) - unveraenderte Karten
 * bleiben unangetastet im DOM (kein Bild-Reload, kein Flackern). Reihenfolge
 * wird ueber appendChild-Verschieben hergestellt, ohne die Knoten neu zu
 * erzeugen.
 */
async function refreshJobs() {
  const res = await fetch("/api/jobs");
  const jobs = await res.json();

  const seenIds = new Set();
  for (const job of jobs) {
    seenIds.add(job.id);
    const snapshot = JSON.stringify(job);
    const existing = renderedJobs.get(job.id);

    if (!existing || existing.snapshot !== snapshot) {
      const version = (jobVersions.get(job.id) || 0) + 1;
      jobVersions.set(job.id, version);
      const el = jobCard(job, version);
      if (existing) {
        existing.el.replaceWith(el);
      }
      renderedJobs.set(job.id, { el, snapshot });
    }
  }

  for (const [id, entry] of renderedJobs) {
    if (!seenIds.has(id)) {
      entry.el.remove();
      renderedJobs.delete(id);
      jobVersions.delete(id);
    }
  }

  // Reihenfolge (Server liefert neueste zuerst) herstellen, ohne
  // unveraenderte Knoten neu zu erzeugen - appendChild verschiebt
  // bestehende Knoten nur, laedt Bilder nicht neu.
  jobs.forEach((job) => {
    const entry = renderedJobs.get(job.id);
    if (entry) jobsList.appendChild(entry.el);
  });
}

// --- Text-Editor-Modal -------------------------------------------------

function closeModal() {
  modalRoot.innerHTML = "";
}

function modalShell(title, bodyHtml) {
  modalRoot.innerHTML = `
    <div class="modal-overlay">
      <div class="modal">
        <h3>${title}</h3>
        <div class="modal-body">${bodyHtml}</div>
        <div class="modal-actions">
          <button type="button" id="modal-cancel">Abbrechen</button>
          <button type="button" id="modal-save" class="primary">Speichern &amp; neu rendern</button>
        </div>
        <p id="modal-status"></p>
      </div>
    </div>
  `;
  modalRoot.querySelector(".modal-overlay").addEventListener("click", (e) => {
    if (e.target.classList.contains("modal-overlay")) closeModal();
  });
  document.getElementById("modal-cancel").addEventListener("click", closeModal);
}

async function saveTexts(jobId, patch) {
  const statusEl = document.getElementById("modal-status");
  const saveBtn = document.getElementById("modal-save");
  saveBtn.disabled = true;
  statusEl.textContent = "Rendere neu...";
  try {
    const res = await fetch(`/api/jobs/${jobId}/texts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Unbekannter Fehler");
    closeModal();
    await refreshJobs();
  } catch (err) {
    statusEl.textContent = "Fehler: " + err.message;
    saveBtn.disabled = false;
  }
}

function openCoverEditor(jobId, texts) {
  modalShell(
    "Cover-Tagline bearbeiten",
    `<label>Tagline<textarea id="f-tagline" rows="2">${escapeHtml(texts.tagline)}</textarea></label>`
  );
  document.getElementById("modal-save").addEventListener("click", () => {
    saveTexts(jobId, { tagline: document.getElementById("f-tagline").value });
  });
}

function openGameplanEditor(jobId, texts) {
  const paragraphs = texts.gameplan.paragraphs.join("\n\n");
  const [s1, s2, s3] = texts.gameplan.steps;
  modalShell(
    "Gameplan bearbeiten",
    `
    <label>Absaetze (Leerzeile = neuer Absatz)
      <textarea id="f-paragraphs" rows="8">${escapeHtml(paragraphs)}</textarea>
    </label>
    <label>Schritt 01<input id="f-step1" type="text" value="${escapeHtml(s1 || "")}" /></label>
    <label>Schritt 02<input id="f-step2" type="text" value="${escapeHtml(s2 || "")}" /></label>
    <label>Schritt 03<input id="f-step3" type="text" value="${escapeHtml(s3 || "")}" /></label>
    `
  );
  document.getElementById("modal-save").addEventListener("click", () => {
    const paragraphs = document
      .getElementById("f-paragraphs")
      .value.split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);
    saveTexts(jobId, {
      gameplan: {
        paragraphs,
        steps: [
          document.getElementById("f-step1").value,
          document.getElementById("f-step2").value,
          document.getElementById("f-step3").value,
        ],
      },
    });
  });
}

function openCaptionEditor(jobId, texts) {
  modalShell(
    "Caption bearbeiten",
    `
    <label>Text<textarea id="f-body" rows="4">${escapeHtml(texts.caption.body)}</textarea></label>
    <label>Hashtags (mit Leerzeichen getrennt)
      <input id="f-hashtags" type="text" value="${escapeHtml(texts.caption.hashtags.join(" "))}" />
    </label>
    `
  );
  document.getElementById("modal-save").addEventListener("click", () => {
    const hashtags = document
      .getElementById("f-hashtags")
      .value.split(/\s+/)
      .map((h) => h.trim())
      .filter(Boolean);
    saveTexts(jobId, { caption: { body: document.getElementById("f-body").value, hashtags } });
  });
}

async function openEditModal(jobId, kind) {
  modalShell("Laedt...", "");
  const res = await fetch(`/api/jobs/${jobId}`);
  const data = await res.json();
  if (!res.ok || !data.texts) {
    modalShell("Fehler", `<p>${escapeHtml(data.error || "Texte nicht gefunden")}</p>`);
    return;
  }
  if (kind === "cover") openCoverEditor(jobId, data.texts);
  else if (kind === "gameplan") openGameplanEditor(jobId, data.texts);
  else if (kind === "caption") openCaptionEditor(jobId, data.texts);
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

jobsList.addEventListener("click", (e) => {
  const toggleBtn = e.target.closest("[data-toggle-collapse]");
  if (toggleBtn) {
    const id = toggleBtn.dataset.job;
    const card = toggleBtn.closest(".job-card");
    if (collapsedJobs.has(id)) {
      collapsedJobs.delete(id);
      card.classList.remove("collapsed");
      toggleBtn.textContent = "▾";
    } else {
      collapsedJobs.add(id);
      card.classList.add("collapsed");
      toggleBtn.textContent = "▸";
    }
    saveCollapsed();
    return;
  }

  const img = e.target.closest("img.editable");
  if (img) {
    openEditModal(img.dataset.job, img.dataset.kind);
    return;
  }
  const captionBtn = e.target.closest("[data-edit-caption]");
  if (captionBtn) {
    openEditModal(captionBtn.dataset.job, "caption");
  }
});

refreshJobs();
setInterval(refreshJobs, 5000);
