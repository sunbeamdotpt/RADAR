const html = `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sunbeam RADAR</title>
  <link rel="icon" type="image/png" href="/assets/sunbeam.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Ysabeau+Infant:ital,wght@0,1..1000;1,1..1000&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-page: #1f1f1f;
      --bg-card: #2a2a2a;
      --bg-nav: rgba(31, 31, 31, 0.92);
      --text-primary: #ffffff;
      --text-secondary: rgba(255, 255, 255, 0.7);
      --text-muted: rgba(255, 255, 255, 0.4);
      --border-default: rgba(255, 161, 16, 0.15);
      --border-subtle: rgba(255, 161, 16, 0.08);
      --accent: #fa520f;
      --accent-hover: #fb6424;
      --sunshine-700: #ffa110;
      --sunshine-500: #ffb83e;
      --sunshine-300: #ffd06a;
      --beam-gold: #ffe295;
      --success: #4ade80;
      --warning: #facc15;
      --danger: #ef4444;
      --info: #60a5fa;
    }

    * { box-sizing: border-box; }

    html, body {
      margin: 0;
      padding: 0;
      background: var(--bg-page);
      color: var(--text-primary);
      font-family: 'Ysabeau Infant', Arial, ui-sans-serif, system-ui, sans-serif;
      font-weight: 647;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
    }

    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; color: var(--accent-hover); }

    .skip-link {
      position: absolute;
      left: -9999px;
      z-index: 9999;
      background: var(--accent);
      color: white;
      padding: 0.5rem 1rem;
    }
    .skip-link:focus { left: 1rem; top: 1rem; }

    header {
      background: var(--bg-nav);
      border-bottom: 1px solid var(--border-default);
      padding: 1.5rem 2rem;
      position: sticky;
      top: 0;
      z-index: 10;
    }

    .header-inner {
      max-width: 1400px;
      margin: 0 auto;
    }

    h1 {
      margin: 0;
      font-size: 1.5rem;
      font-weight: 791;
      letter-spacing: -0.025em;
      text-transform: uppercase;
      color: var(--text-primary);
    }

    h1 .accent { color: var(--accent); }

    h1 .logo {
      height: 1.25em;
      width: auto;
      margin-left: 0.5rem;
      vertical-align: text-top;
      transform: translateY(-0.1em);
    }

    .subtitle {
      margin: 0.5rem 0 0;
      color: var(--text-secondary);
      font-size: 0.875rem;
      max-width: 720px;
    }

    main {
      max-width: 1400px;
      margin: 0 auto;
      padding: 2rem;
    }

    .status-bar {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }

    .stat {
      background: var(--bg-card);
      border: 1px solid var(--border-default);
      padding: 1rem;
      border-radius: 2px;
    }

    .stat-value {
      font-size: 1.5rem;
      font-weight: 791;
      color: var(--accent);
    }

    .stat-value.pulse {
      animation: pulse 2.5s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.55; }
    }

    .stat-label {
      font-size: 0.75rem;
      font-weight: 791;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin-top: 0.25rem;
    }

    .message {
      background: var(--bg-card);
      border: 1px solid var(--border-default);
      padding: 2rem;
      text-align: center;
      border-radius: 2px;
      color: var(--text-secondary);
    }

    .message.error { border-color: var(--danger); color: var(--danger); }

    .table-wrapper {
      background: var(--bg-card);
      border: 1px solid var(--border-default);
      border-radius: 2px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
      overflow: hidden;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      background: transparent;
    }

    thead {
      background: rgba(255, 161, 16, 0.08);
      border-bottom: 1px solid var(--border-default);
    }

    th, td {
      padding: 0.875rem 1rem;
      text-align: left;
      font-size: 0.875rem;
    }

    th {
      font-weight: 791;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-size: 0.75rem;
      color: var(--sunshine-700);
    }

    tbody tr { border-bottom: 1px solid var(--border-subtle); }
    tbody tr:last-child { border-bottom: none; }
    tbody tr:hover { background: rgba(255, 161, 16, 0.04); }

    .component-name {
      font-weight: 791;
      color: var(--text-primary);
    }

    .namespace {
      color: var(--text-muted);
      font-size: 0.75rem;
    }

    .version {
      font-family: 'Monaspace Argon', 'SF Mono', 'Fira Code', monospace;
      font-size: 0.8125rem;
    }

    .current { color: var(--text-secondary); }
    .latest { color: var(--beam-gold); }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      padding: 0.25rem 0.5rem;
      border-radius: 2px;
      font-size: 0.75rem;
      font-weight: 791;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      white-space: nowrap;
    }

    .badge-breaking { background: rgba(239, 68, 68, 0.15); color: var(--danger); border: 1px solid rgba(239, 68, 68, 0.3); }
    .badge-deprecated { background: rgba(250, 204, 21, 0.15); color: var(--warning); border: 1px solid rgba(250, 204, 21, 0.3); }
    .badge-eol_warning { background: rgba(255, 161, 16, 0.15); color: var(--sunshine-500); border: 1px solid rgba(255, 161, 16, 0.3); }
    .badge-false_positive { background: rgba(96, 165, 250, 0.15); color: var(--info); border: 1px solid rgba(96, 165, 250, 0.3); }
    .badge-floating_tag { background: rgba(139, 92, 246, 0.15); color: #c4b5fd; border: 1px solid rgba(139, 92, 246, 0.3); }
    .badge-custom_fork { background: rgba(167, 139, 250, 0.15); color: #ddd6fe; border: 1px solid rgba(167, 139, 250, 0.3); }
    .badge-review { background: rgba(255, 129, 5, 0.15); color: var(--sunshine-700); border: 1px solid rgba(255, 129, 5, 0.3); }
    .badge-unknown { background: rgba(255, 255, 255, 0.08); color: var(--text-secondary); border: 1px solid var(--border-default); }
    .badge-likely_safe { background: rgba(74, 222, 128, 0.12); color: var(--success); border: 1px solid rgba(74, 222, 128, 0.25); }
    .badge-non_applicable { background: rgba(255, 255, 255, 0.06); color: var(--text-muted); border: 1px solid var(--border-subtle); }

    .badge-dryrun-success { background: rgba(74, 222, 128, 0.12); color: var(--success); border: 1px solid rgba(74, 222, 128, 0.25); }
    .badge-dryrun-build_failed { background: rgba(239, 68, 68, 0.15); color: var(--danger); border: 1px solid rgba(239, 68, 68, 0.3); }
    .badge-dryrun-dryrun_failed { background: rgba(239, 68, 68, 0.15); color: var(--danger); border: 1px solid rgba(239, 68, 68, 0.3); }
    .badge-dryrun-skipped_no_mapping { background: rgba(255, 255, 255, 0.08); color: var(--text-secondary); border: 1px solid var(--border-default); }
    .badge-dryrun-skipped_unsupported_source { background: rgba(255, 255, 255, 0.08); color: var(--text-secondary); border: 1px solid var(--border-default); }
    .badge-dryrun-none { background: transparent; color: var(--text-muted); border: 1px dashed var(--border-default); }

    th.sortable {
      cursor: pointer;
      user-select: none;
      white-space: nowrap;
    }
    th.sortable:hover { color: var(--beam-gold); }
    th.sortable .sort-indicator {
      display: inline-block;
      margin-left: 0.25rem;
      color: var(--beam-gold);
      font-size: 0.625rem;
      white-space: nowrap;
    }

    .reason {
      font-size: 0.75rem;
      color: var(--text-secondary);
      margin-top: 0.25rem;
      max-width: 320px;
    }

    footer {
      max-width: 1400px;
      margin: 2rem auto;
      padding: 0 2rem 2rem;
      color: var(--text-muted);
      font-size: 0.75rem;
      text-align: center;
    }

    @media (max-width: 768px) {
      header, main, footer { padding-left: 1rem; padding-right: 1rem; }
      th, td { padding: 0.625rem 0.75rem; }
      .hide-sm { display: none; }
    }
  </style>
</head>
<body>
  <a href="#main-content" class="skip-link">Skip to main content</a>
  <header>
    <div class="header-inner">
      <h1><span class="accent">Sunbeam</span> RADAR <img src="/assets/sunbeam.png" alt="" class="logo"></h1>
      <p class="subtitle">
        Release Automation &amp; Deployment Asset Registry — tracks the software versions
        pinned in the Sunbeam Kubernetes platform and surfaces upstream drift, risk
        assessments, and dry-run previews.
      </p>
    </div>
  </header>
  <main id="main-content">
    <div id="status-bar" class="status-bar" aria-live="polite"></div>
    <div id="content">
      <div class="message">Loading RADAR data…</div>
    </div>
  </main>
  <footer>
    Data refreshes when the inventory, assess, and dry-run jobs run.
    <span id="generated-at"></span>
  </footer>
  <script>
    const SEVERITY_ORDER = {
      breaking: 0, deprecated: 1, eol_warning: 2, false_positive: 3,
      floating_tag: 4, custom_fork: 5, review: 6, unknown: 7,
      likely_safe: 8, non_applicable: 9,
    };

    const RISK_LEVELS = Object.keys(SEVERITY_ORDER);

    const ASSESSMENT_EMOJI = {
      breaking: "🚨", deprecated: "⚠️", eol_warning: "⏰", false_positive: "🔍",
      floating_tag: "🌊", custom_fork: "🔀", review: "👁️", unknown: "❓",
      likely_safe: "✅", non_applicable: "⏹️",
    };

    const DRYRUN_EMOJI = {
      success: "✅", build_failed: "🔧", dryrun_failed: "❌",
      skipped_no_mapping: "⏭️", skipped_unsupported_source: "🚫", none: "—",
    };

    const DRYRUN_ORDER = {
      success: 0,
      skipped_no_mapping: 1,
      skipped_unsupported_source: 2,
      build_failed: 3,
      dryrun_failed: 4,
      none: 5,
    };

    function formatLink(template, latest) {
      if (!template || !latest) return null;
      return template
        .replaceAll("{tag}", latest)
        .replaceAll("{version}", latest)
        .replaceAll("{app_version}", latest);
    }

    function escapeHtml(str) {
      return String(str)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
    }

    async function load() {
      const content = document.getElementById("content");
      const statusBar = document.getElementById("status-bar");
      const generatedAt = document.getElementById("generated-at");

      let inventory, assessments, dryRuns;
      try {
        const [invRes, assessRes, dryRes] = await Promise.all([
          fetch("/api/v1/components"),
          fetch("/api/v1/assessments"),
          fetch("/api/v1/dryruns"),
        ]);

        inventory = invRes.ok ? await invRes.json() : null;
        assessments = assessRes.ok ? await assessRes.json() : null;
        dryRuns = dryRes.ok ? await dryRes.json() : null;

        if (inventory && inventory.error) inventory = null;
        if (assessments && assessments.error) assessments = null;
        if (dryRuns && dryRuns.error) dryRuns = null;
      } catch (err) {
        content.innerHTML = \`<div class="message error">Failed to load RADAR data: \${escapeHtml(err.message)}</div>\`;
        return;
      }

      if (!inventory || inventory.length === 0) {
        content.innerHTML = \`
          <div class="message">
            No inventory data yet. Run the radar job first, then refresh this page.
          </div>
        \`;
        statusBar.innerHTML = "";
        return;
      }

      const assessByName = new Map((assessments?.assessments || []).map(a => [a.name, a]));
      const dryRunByNamespace = new Map((dryRuns?.dry_runs || []).map(d => [d.namespace, d]));
      const dryRunByComponent = new Map();
      for (const d of (dryRuns?.dry_runs || [])) {
        for (const name of d.components) {
          dryRunByComponent.set(name, d);
        }
      }

      let components = inventory.map(c => {
        const a = assessByName.get(c.name);
        const d = dryRunByComponent.get(c.name) || dryRunByNamespace.get(c.namespace);
        return {
          ...c,
          risk_level: a ? a.risk_level : "unknown",
          risk_reason: a ? a.reason : "",
          risk_action: a ? a.action : "",
          dryrun_status: d ? d.status : "none",
          dryrun_namespace: d ? d.namespace : "",
        };
      });

      let sortCol = "assessment";
      let sortDir = 1;
      let assessmentCycle = RISK_LEVELS.indexOf("likely_safe");
      let dryrunCycle = -1;
      let componentCycle = 0;

      const dryrunLevels = [...new Set(components.map((c) => c.dryrun_status))].sort(
        (a, b) => (DRYRUN_ORDER[a] ?? 99) - (DRYRUN_ORDER[b] ?? 99),
      );

      function parseVersion(v) {
        return String(v)
          .replace(/^v/i, "")
          .split(/[.-]/)
          .map(p => {
            const n = parseInt(p, 10);
            return Number.isNaN(n) ? p.toLowerCase() : n;
          });
      }

      function compareVersion(a, b) {
        const av = parseVersion(a);
        const bv = parseVersion(b);
        const len = Math.max(av.length, bv.length);
        for (let i = 0; i < len; i++) {
          const ai = av[i] ?? 0;
          const bi = bv[i] ?? 0;
          if (typeof ai === "number" && typeof bi === "number") {
            if (ai !== bi) return ai - bi;
          } else {
            const as = String(a).replace(/^v/i, "");
            const bs = String(b).replace(/^v/i, "");
            return as.localeCompare(bs);
          }
        }
        return String(a).localeCompare(String(b));
      }

      function compareRows(a, b) {
        const dir = sortDir;
        let diff = 0;
        switch (sortCol) {
          case "component": {
            if (componentCycle === 2) {
              diff = a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name);
            } else {
              diff = a.name.localeCompare(b.name);
            }
            break;
          }
          case "current":
            diff = compareVersion(a.current, b.current);
            break;
          case "latest":
            diff = compareVersion(a.latest, b.latest);
            break;
          case "assessment": {
            const selected = assessmentCycle >= 0 ? RISK_LEVELS[assessmentCycle] : null;
            const aSelected = a.risk_level === selected;
            const bSelected = b.risk_level === selected;
            if (selected) {
              if (aSelected && !bSelected) { diff = -1; break; }
              if (bSelected && !aSelected) { diff = 1; break; }
            }
            diff = (SEVERITY_ORDER[a.risk_level] ?? 99) - (SEVERITY_ORDER[b.risk_level] ?? 99);
            break;
          }
          case "dryrun": {
            const selected = dryrunCycle >= 0 ? dryrunLevels[dryrunCycle] : null;
            const aSelected = a.dryrun_status === selected;
            const bSelected = b.dryrun_status === selected;
            if (selected) {
              if (aSelected && !bSelected) { diff = -1; break; }
              if (bSelected && !aSelected) { diff = 1; break; }
            }
            diff = (DRYRUN_ORDER[a.dryrun_status] ?? 99) - (DRYRUN_ORDER[b.dryrun_status] ?? 99);
            break;
          }
        }
        if (diff !== 0) return diff * dir;
        return a.name.localeCompare(b.name);
      }

      function updateHeaders(table) {
        table.querySelectorAll("th.sortable").forEach(th => {
          const indicator = th.querySelector(".sort-indicator");
          if (th.dataset.col === sortCol) {
            indicator.textContent = sortDir === 1 ? "▲" : "▼";
          } else if (th.dataset.col === "component" && componentCycle === 2) {
            indicator.textContent = "▲";
          } else {
            indicator.textContent = "";
          }
        });
      }

      function renderTable() {
        const rows = components.slice().sort(compareRows).map(c => {
          const latestLink = formatLink(c.link_template, c.latest);
          const latestCell = latestLink
            ? \`<a href="\${escapeHtml(latestLink)}" target="_blank" rel="noopener">\${escapeHtml(c.latest)}</a>\`
            : escapeHtml(c.latest);
          const badgeClass = \`badge-\${c.risk_level}\`;
          const dryrunClass = c.dryrun_status === "none" ? "badge-dryrun-none" : \`badge-dryrun-\${c.dryrun_status}\`;
          return \`
            <tr>
              <td>
                <div class="component-name">\${escapeHtml(c.name)}</div>
                <div class="namespace">\${escapeHtml(c.namespace)}</div>
              </td>
              <td class="version current">\${escapeHtml(c.current)}</td>
              <td class="version latest">\${latestCell}</td>
              <td>
                <span class="badge \${badgeClass}"><span aria-hidden="true">\${ASSESSMENT_EMOJI[c.risk_level] || "❓"}</span> \${escapeHtml(c.risk_level)}</span>
                \${c.risk_reason ? \`<div class="reason">\${escapeHtml(c.risk_reason)}</div>\` : ""}
              </td>
              <td>
                <span class="badge \${dryrunClass}"><span aria-hidden="true">\${DRYRUN_EMOJI[c.dryrun_status] || "—"}</span> \${escapeHtml(c.dryrun_status)}</span>
                \${c.dryrun_status !== "none" ? \`<div class="reason"><a href="/api/v1/dryruns?namespace=\${encodeURIComponent(c.dryrun_namespace)}" target="_blank" rel="noopener">show output</a></div>\` : ""}
              </td>
            </tr>
          \`;
        }).join("");

        content.innerHTML = \`
          <div class="table-wrapper">
            <table role="table" aria-label="RADAR component overview">
              <thead>
                <tr>
                  <th scope="col" class="sortable" data-col="component">Component<span class="sort-indicator"></span></th>
                  <th scope="col" class="sortable" data-col="current">Current<span class="sort-indicator"></span></th>
                  <th scope="col" class="sortable" data-col="latest">Latest<span class="sort-indicator"></span></th>
                  <th scope="col" class="sortable" data-col="assessment">Assessment<span class="sort-indicator"></span></th>
                  <th scope="col" class="sortable" data-col="dryrun">Dry-run<span class="sort-indicator"></span></th>
                </tr>
              </thead>
              <tbody>\${rows}</tbody>
            </table>
          </div>
        \`;

        const table = content.querySelector("table");
        updateHeaders(table);
        table.querySelectorAll("th.sortable").forEach(th => {
          th.addEventListener("click", () => {
            const col = th.dataset.col;
            if (col === "assessment") {
              assessmentCycle++;
              if (assessmentCycle >= RISK_LEVELS.length) {
                assessmentCycle = -1;
              }
              dryrunCycle = -1;
              sortCol = "assessment";
              sortDir = 1;
            } else if (col === "dryrun") {
              dryrunCycle++;
              if (dryrunCycle >= dryrunLevels.length) {
                dryrunCycle = -1;
              }
              assessmentCycle = -1;
              sortCol = "dryrun";
              sortDir = 1;
            } else if (col === "component") {
              assessmentCycle = -1;
              dryrunCycle = -1;
              componentCycle = sortCol === "component" ? (componentCycle + 1) % 3 : 0;
              sortCol = "component";
              sortDir = componentCycle === 1 ? -1 : 1;
            } else {
              assessmentCycle = -1;
              dryrunCycle = -1;
              componentCycle = 0;
              if (col === sortCol) {
                sortDir = -sortDir;
              } else {
                sortCol = col;
                sortDir = 1;
              }
            }
            renderTable();
          });
        });
      }

      const counts = { breaking: 0, update_available: 0, dryrun_success: 0, total: components.length };
      for (const c of components) {
        if (c.risk_level === "breaking") counts.breaking++;
        if (c.update_available) counts.update_available++;
        if (c.dryrun_status === "success") counts.dryrun_success++;
      }

      statusBar.innerHTML = \`
        <div class="stat"><div class="stat-value">\${counts.total}</div><div class="stat-label">Components</div></div>
        <div class="stat"><div class="stat-value pulse">\${counts.update_available}</div><div class="stat-label">Updates Available</div></div>
        <div class="stat"><div class="stat-value">\${counts.breaking}</div><div class="stat-label">Breaking Risks</div></div>
        <div class="stat"><div class="stat-value">\${counts.dryrun_success}</div><div class="stat-label">Dry-run Successes</div></div>
      \`;

      renderTable();

      const timestamps = [
        inventory?.generated_at,
        assessments?.generated_at,
        dryRuns?.generated_at,
      ].filter(Boolean);
      if (timestamps.length > 0) {
        generatedAt.textContent = "Generated " + timestamps.join(" / ");
      }
    }

    load();
  </script>
</body>
</html>`;

export function renderDashboard(): Response {
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
