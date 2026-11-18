// Gemeinsame Tab-Leiste unten + Service-Worker-Registrierung fuer alle Seiten.
(function () {
  const TABS = [
    { href: "/queue.html", label: "Freigabe", icon: '<path d="M5 12l4 4L19 6"/>' },
    { href: "/plan.html", label: "Plan", icon: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>' },
    { href: "/", label: "Erstellen", icon: '<path d="M12 5v14M5 12h14"/>' },
    { href: "/profile.html", label: "Profil", icon: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>' },
    { href: "/settings.html", label: "Einstellungen", icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>' },
  ];

  const style = document.createElement("style");
  style.textContent = `
    .tabbar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 50;
      display: grid; grid-template-columns: repeat(${TABS.length}, 1fr);
      background: rgba(255,255,255,.94); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
      border-top: 1px solid #E2D9C6; padding-bottom: env(safe-area-inset-bottom); }
    .tabbar a { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
      min-height: 56px; color: #9A8F7A; text-decoration: none; font-size: 11px; font-weight: 500; position: relative; }
    .tabbar a.active { color: #1F1D18; }
    .tabbar svg { width: 24px; height: 24px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .tabbar .badge[hidden] { display: none; }
    .tabbar .badge { position: absolute; top: 6px; left: calc(50% + 6px); min-width: 18px; height: 18px; padding: 0 5px;
      border-radius: 9px; background: #A23B2A; color: #fff; font-size: 11px; line-height: 18px; text-align: center; }
    body { padding-bottom: calc(64px + env(safe-area-inset-bottom)) !important; }
  `;
  document.head.appendChild(style);

  const here = location.pathname === "/index.html" ? "/" : location.pathname;
  const nav = document.createElement("nav");
  nav.className = "tabbar";
  nav.innerHTML = TABS.map(
    (t) => `<a href="${t.href}" class="${t.href === here ? "active" : ""}" aria-label="${t.label}">
      <svg viewBox="0 0 24 24" aria-hidden="true">${t.icon}</svg><span>${t.label}</span>
      ${t.href === "/queue.html" ? '<span class="badge" id="navBadge" hidden></span>' : ""}</a>`
  ).join("");
  document.body.appendChild(nav);

  // Anzahl offener Entwuerfe als Badge (Tab + App-Icon, wo unterstuetzt)
  async function updateBadge() {
    try {
      const r = await fetch("/api/queue");
      if (!r.ok) return;
      const n = (await r.json()).filter((i) => i.status === "draft").length;
      const b = document.getElementById("navBadge");
      if (b) { b.textContent = String(n); b.hidden = n === 0; }
      if ("setAppBadge" in navigator) n ? navigator.setAppBadge(n).catch(() => {}) : navigator.clearAppBadge().catch(() => {});
    } catch {}
  }
  updateBadge();
  setInterval(updateBadge, 60000);
  window.updateNavBadge = updateBadge;

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

  // ---------------------------------------------------------------------
  // Hintergrund-Auftraege: Fortschritt auf jeder Seite ueber der Tab-Leiste.
  // Der Server arbeitet unabhaengig von der Seite weiter.
  // ---------------------------------------------------------------------
  const tstyle = document.createElement("style");
  tstyle.textContent = `
    .tasks { position: fixed; left: 8px; right: 8px; z-index: 49; bottom: calc(64px + env(safe-area-inset-bottom));
      display: flex; flex-direction: column; gap: 6px; pointer-events: none; }
    .task { pointer-events: auto; background: #1F1D18; color: #F4EFE4; border-radius: 14px; padding: 10px 12px;
      box-shadow: 0 8px 24px rgba(0,0,0,.25); font-size: 13px; max-width: 700px; margin: 0 auto; width: 100%; }
    .task .top { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
    .task b { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .task .pct { font-variant-numeric: tabular-nums; opacity: .8; flex: none; }
    .task .step { opacity: .8; margin: 2px 0 7px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .task .bar { height: 6px; border-radius: 3px; background: rgba(255,255,255,.18); overflow: hidden; }
    .task .bar i { display: block; height: 100%; background: #C2D8CB; transition: width .6s ease; }
    .task.indet .bar i { width: 35% !important; animation: tslide 1.2s infinite ease-in-out; }
    @keyframes tslide { 0% { margin-left: -35%; } 100% { margin-left: 100%; } }
    .task.done { background: #2F6B3A; } .task.failed { background: #A23B2A; }
    .task a, .task button { color: inherit; font: inherit; font-weight: 600; background: none; border: 0; padding: 0; text-decoration: underline; cursor: pointer; }
    .task .acts { display: flex; gap: 14px; margin-top: 4px; }
  `;
  document.head.appendChild(tstyle);
  const box = document.createElement("div");
  box.className = "tasks";
  document.body.appendChild(box);

  const DISMISS_KEY = "fm-dismissed-tasks";
  const dismissed = new Set((() => { try { return JSON.parse(localStorage.getItem(DISMISS_KEY) || "[]"); } catch { return []; } })());
  const saveDismissed = () => { try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...dismissed].slice(-50))); } catch {} };
  const lastStatus = {};
  let timer = null;
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  async function pollTasks() {
    clearTimeout(timer);
    let list = [];
    try {
      const r = await fetch("/api/tasks");
      if (r.ok) list = await r.json();
    } catch {}
    const recentMs = 10 * 60_000;
    // Laufende immer, von den fertigen nur die zwei neuesten (sonst wird der Bildschirm voll)
    const candidates = list.filter((t) => !dismissed.has(t.id) &&
      (t.status === "running" || Date.now() - new Date(t.finishedAt).getTime() < recentMs));
    const visible = [
      ...candidates.filter((t) => t.status === "running"),
      ...candidates.filter((t) => t.status !== "running").slice(0, 2),
    ];

    let anyFinished = false;
    for (const t of list) {
      if (lastStatus[t.id] === "running" && t.status !== "running") anyFinished = true;
      lastStatus[t.id] = t.status;
    }
    if (anyFinished) {
      window.dispatchEvent(new CustomEvent("tasks-done"));
      updateBadge();
    }

    box.innerHTML = visible.map((t) => {
      const pct = t.progress == null ? null : Math.round(t.progress * 100);
      if (t.status === "running") {
        return `<div class="task ${pct == null ? "indet" : ""}"><div class="top"><b>${esc(t.label)}</b><span class="pct">${pct == null ? "" : pct + " %"}</span></div>
          <div class="step">${esc(t.step)}</div><div class="bar"><i style="width:${pct ?? 0}%"></i></div></div>`;
      }
      const ok = t.status === "done";
      return `<div class="task ${ok ? "done" : "failed"}"><div class="top"><b>${esc(t.label)}</b><span class="pct">${ok ? "fertig" : "Fehler"}</span></div>
        <div class="step">${esc(ok ? "Wartet in der Freigabe" : t.error)}</div>
        <div class="acts">${ok && location.pathname !== "/queue.html" ? '<a href="/queue.html">Ansehen</a>' : ""}<button data-dismiss="${t.id}">Ausblenden</button></div></div>`;
    }).join("");
    document.body.style.paddingBottom = `calc(${64 + box.offsetHeight + (visible.length ? 8 : 0)}px + env(safe-area-inset-bottom))`;

    const running = list.some((t) => t.status === "running");
    timer = setTimeout(pollTasks, running ? 1500 : 15000);
  }
  box.addEventListener("click", (e) => {
    const id = e.target.dataset && e.target.dataset.dismiss;
    if (!id) return;
    dismissed.add(id); saveDismissed(); pollTasks();
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) pollTasks(); });
  // Seiten rufen das nach dem Start eines Auftrags auf, damit sofort angezeigt wird
  window.trackTasks = pollTasks;
  pollTasks();
})();
