// Gemeinsame Tab-Leiste unten + Service-Worker-Registrierung fuer alle Seiten.
(function () {
  const TABS = [
    { href: "/queue.html", label: "Freigabe", icon: '<path d="M5 12l4 4L19 6"/>' },
    { href: "/", label: "Erstellen", icon: '<path d="M12 5v14M5 12h14"/>' },
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
})();
