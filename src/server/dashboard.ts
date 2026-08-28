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
      padding: 1.5rem 0;
      position: sticky;
      top: 0;
      z-index: 10;
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 0 2rem;
    }

    h1 {
      margin: 0;
      font-size: 1.5rem;
      font-weight: 791;
      letter-spacing: -0.025em;
      text-transform: uppercase;
      color: var(--text-primary);
    }

    .radar-glow {
      text-shadow: 0 0 18px rgba(250, 82, 15, 0.35), 0 0 42px rgba(250, 82, 15, 0.12);
      animation: radar-glow 3s ease-in-out infinite;
    }

    @keyframes radar-glow {
      0%, 100% { text-shadow: 0 0 18px rgba(250, 82, 15, 0.45), 0 0 42px rgba(250, 82, 15, 0.18); }
      50% { text-shadow: 0 0 34px rgba(250, 82, 15, 0.75), 0 0 78px rgba(250, 82, 15, 0.32); }
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
      padding: 2rem 0;
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

    .reason {
      font-size: 0.75rem;
      color: var(--text-secondary);
      margin-top: 0.25rem;
      max-width: 320px;
    }

    .dropdown {
      position: relative;
      display: inline-block;
    }

    .dropdown-trigger {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      background: var(--bg-card);
      border: 1px solid var(--border-default);
      border-radius: 2px;
      padding: 0.375rem 0.625rem;
      color: var(--sunshine-700);
      font-family: inherit;
      font-size: 0.75rem;
      font-weight: 791;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      cursor: pointer;
      transition: border-color 0.2s ease, color 0.2s ease;
    }

    .dropdown-trigger:hover {
      border-color: var(--accent);
      color: var(--beam-gold);
    }

    .dropdown-trigger:focus-visible {
      outline: 1px solid var(--accent);
      outline-offset: 1px;
    }

    .dropdown-chevron {
      font-size: 0.625rem;
      color: var(--beam-gold);
    }

    .dropdown-menu {
      position: absolute;
      top: calc(100% + 0.25rem);
      left: 0;
      min-width: 10rem;
      max-height: 26rem;
      overflow-y: auto;
      background: var(--bg-card);
      border: 1px solid var(--border-default);
      border-radius: 2px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
      z-index: 20;
      display: none;
    }

    .dropdown-open > .dropdown-menu {
      display: block;
    }

    .dropdown-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      width: 100%;
      padding: 0.5rem 0.75rem;
      background: transparent;
      border: none;
      color: var(--text-secondary);
      font-family: inherit;
      font-size: 0.8125rem;
      font-weight: 647;
      text-align: left;
      cursor: pointer;
      transition: background 0.15s ease, color 0.15s ease;
      white-space: nowrap;
    }

    .dropdown-item:hover,
    .dropdown-item:focus-visible {
      background: rgba(255, 161, 16, 0.08);
      color: var(--text-primary);
      outline: none;
    }

    .dropdown-item.active {
      color: var(--accent);
    }

    .dropdown-check {
      font-size: 0.625rem;
      color: var(--accent);
      visibility: hidden;
    }

    .dropdown-item.active .dropdown-check {
      visibility: visible;
    }

    th {
      vertical-align: middle;
    }

    th:nth-child(2), td:nth-child(2),
    th:nth-child(3), td:nth-child(3),
    th:nth-child(4), td:nth-child(4) {
      text-align: center;
    }

    footer {
      max-width: 1400px;
      margin: 2rem auto;
      padding: 0 2rem 2rem;
      color: var(--text-muted);
      font-size: 0.75rem;
      text-align: center;
    }

    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(4px);
      z-index: 100;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 2rem;
    }

    .modal-backdrop.open { display: flex; }

    .modal-window {
      width: 100%;
      max-width: 900px;
      max-height: calc(100vh - 4rem);
      background: rgba(42, 42, 42, 0.96);
      border: 1px solid var(--border-default);
      border-radius: 2px;
      box-shadow: 0 16px 64px rgba(0, 0, 0, 0.55);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 1rem 1.25rem;
      border-bottom: 1px solid var(--border-default);
      background: rgba(255, 161, 16, 0.04);
    }

    .modal-title {
      margin: 0;
      font-size: 1rem;
      font-weight: 791;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: rgba(255, 161, 16, 0.9);
    }

    .modal-actions {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .modal-close {
      background: transparent;
      border: none;
      color: var(--text-secondary);
      font-size: 1.25rem;
      line-height: 1;
      cursor: pointer;
      padding: 0.25rem;
    }

    .modal-close:hover { color: var(--text-primary); }

    .modal-body {
      padding: 1.25rem;
      overflow-y: auto;
    }

    .modal-body .meta {
      display: flex;
      align-items: center;
      gap: 1rem;
      margin-bottom: 1rem;
      flex-wrap: wrap;
    }

    .modal-body .namespace {
      font-size: 1.125rem;
      font-weight: 791;
      color: var(--text-primary);
    }

    .modal-body .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      padding: 0.25rem 0.5rem;
      border-radius: 2px;
      font-size: 0.6875rem;
      font-weight: 791;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .modal-body .status-success { background: rgba(74, 222, 128, 0.12); color: var(--success); border: 1px solid rgba(74, 222, 128, 0.25); }
    .modal-body .status-build_failed { background: rgba(239, 68, 68, 0.15); color: var(--danger); border: 1px solid rgba(239, 68, 68, 0.3); }
    .modal-body .status-dryrun_failed { background: rgba(239, 68, 68, 0.15); color: var(--danger); border: 1px solid rgba(239, 68, 68, 0.3); }
    .modal-body .status-skipped_no_mapping { background: rgba(255, 255, 255, 0.08); color: var(--text-secondary); border: 1px solid var(--border-default); }
    .modal-body .status-skipped_unsupported_source { background: rgba(255, 255, 255, 0.08); color: var(--text-secondary); border: 1px solid var(--border-default); }

    .modal-body section {
      background: rgba(31, 31, 31, 0.6);
      border: 1px solid var(--border-default);
      border-radius: 2px;
      margin-bottom: 0.75rem;
      overflow: hidden;
    }

    .modal-body h2 {
      margin: 0;
      padding: 0.625rem 0.875rem;
      font-size: 0.6875rem;
      font-weight: 791;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: rgba(255, 161, 16, 0.7);
      background: rgba(255, 161, 16, 0.04);
      border-bottom: 1px solid var(--border-default);
    }

    .modal-body pre {
      margin: 0;
      padding: 0.875rem;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: 'Monaspace Argon', 'SF Mono', 'Fira Code', monospace;
      font-size: 0.75rem;
      line-height: 1.6;
      color: var(--text-secondary);
    }

    .modal-body .empty {
      margin: 0;
      padding: 0.875rem;
      color: var(--text-muted);
      font-style: italic;
      font-size: 0.8125rem;
    }

    .output-link {
      font-size: 0.75rem;
      font-weight: 647;
    }

    .output-preview-trigger {
      background: transparent;
      border: none;
      padding: 0;
      color: var(--accent);
      font-family: inherit;
      font-size: inherit;
      font-weight: inherit;
      cursor: pointer;
      text-decoration: none;
    }

    .output-preview-trigger:hover {
      text-decoration: underline;
      color: var(--accent-hover);
    }

    @media (max-width: 768px) {
      .container { padding-left: 1rem; padding-right: 1rem; }
      footer { padding-left: 1rem; padding-right: 1rem; }
      th, td { padding: 0.625rem 0.75rem; }
      .hide-sm { display: none; }
    }
  </style>
</head>
<body>
  <a href="#main-content" class="skip-link">Skip to main content</a>
  <header>
    <div class="header-inner container">
      <h1><span class="accent">Sunbeam</span> <span class="radar-glow">RADAR</span> <img src="/assets/sunbeam.png" alt="" class="logo"></h1>
      <p class="subtitle">
        Release Automation &amp; Deployment Asset Registry — tracks the software versions
        pinned in the Sunbeam Kubernetes platform and surfaces upstream drift, risk
        assessments, and dry-run previews.
      </p>
    </div>
  </header>
  <main id="main-content">
    <div class="container">
      <div id="status-bar" class="status-bar" aria-live="polite"></div>
      <div id="content">
        <div class="message">Loading RADAR data…</div>
      </div>
    </div>
  </main>
  <div id="output-modal" class="modal-backdrop" aria-hidden="true">
    <div class="modal-window" role="dialog" aria-modal="true" aria-labelledby="output-modal-title">
      <div class="modal-header">
        <h2 id="output-modal-title" class="modal-title">Dry-run output</h2>
        <div class="modal-actions">
          <a id="output-modal-full" href="#" target="_blank" rel="noopener" class="output-link">View full output</a>
          <button type="button" id="output-modal-close" class="modal-close" aria-label="Close">×</button>
        </div>
      </div>
      <div id="output-modal-body" class="modal-body">
        <div class="message">Loading…</div>
      </div>
    </div>
  </div>
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

    function humanizeSortLabel(value) {
      return String(value)
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
    }

    function renderDropdown(label, options, selectedValue, col) {
      const items = options.map((opt) => \`
        <button type="button" class="dropdown-item \${opt.value === selectedValue ? "active" : ""}" data-col="\${escapeHtml(col)}" data-value="\${escapeHtml(opt.value)}">
          <span>\${escapeHtml(opt.label)}</span>
          <span class="dropdown-check">✓</span>
        </button>
      \`).join("");
      return \`
        <div class="dropdown" data-col="\${escapeHtml(col)}">
          <button type="button" class="dropdown-trigger" aria-haspopup="listbox" aria-expanded="false">
            \${escapeHtml(label)} <span class="dropdown-chevron" aria-hidden="true">▾</span>
          </button>
          <div class="dropdown-menu" role="listbox">
            \${items}
          </div>
        </div>
      \`;
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

      const dryrunLevels = [...new Set(components.map((c) => c.dryrun_status))].sort(
        (a, b) => (DRYRUN_ORDER[a] ?? 99) - (DRYRUN_ORDER[b] ?? 99),
      );

      const riskLevels = [...new Set(components.map((c) => c.risk_level))].sort(
        (a, b) => (SEVERITY_ORDER[a] ?? 99) - (SEVERITY_ORDER[b] ?? 99),
      );

      const COMPONENT_OPTIONS = [
        { value: "name_asc", label: "Name A-Z" },
        { value: "name_desc", label: "Name Z-A" },
        { value: "namespace", label: "Namespace" },
      ];

      const VERSION_OPTIONS = [
        { value: "version_asc", label: "Version A-Z" },
        { value: "version_desc", label: "Version Z-A" },
      ];

      const ASSESSMENT_OPTIONS = [
        { value: "severity", label: "Severity" },
        ...riskLevels.map((level) => ({ value: "level:" + level, label: humanizeSortLabel(level) })),
      ];

      const DRYRUN_OPTIONS = [
        { value: "status", label: "Status" },
        ...dryrunLevels
          .filter((status) => status !== "none")
          .map((status) => ({
            value: "status:" + status,
            label: humanizeSortLabel(status),
          })),
      ];

      const CVE_OPTIONS = [
        { value: "none", label: "—" },
      ];

      let sortCol = "assessment";
      let sortDir = 1;
      let componentSort = "name_asc";
      let currentSort = "version_asc";
      let latestSort = "version_asc";
      let cveSort = "none";
      let assessmentSort = "level:likely_safe";
      let dryrunSort = "status";

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
        let diff = 0;
        switch (sortCol) {
          case "component": {
            if (componentSort === "namespace") {
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
            const selected = assessmentSort.startsWith("level:") ? assessmentSort.slice(6) : null;
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
            const selected = dryrunSort.startsWith("status:") ? dryrunSort.slice(7) : null;
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
        if (diff !== 0) return diff * sortDir;
        return a.name.localeCompare(b.name);
      }

      function applySort(col, value) {
        sortCol = col;
        if (col === "component") componentSort = value;
        if (col === "current") currentSort = value;
        if (col === "latest") latestSort = value;
        if (col === "cve") cveSort = value;
        if (col === "assessment") assessmentSort = value;
        if (col === "dryrun") dryrunSort = value;
        sortDir = value.endsWith("_desc") ? -1 : 1;
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
              <td class="version cve"></td>
              <td>
                <span class="badge \${badgeClass}"><span aria-hidden="true">\${ASSESSMENT_EMOJI[c.risk_level] || "❓"}</span> \${escapeHtml(c.risk_level)}</span>
                \${c.risk_reason ? \`<div class="reason">\${escapeHtml(c.risk_reason)}</div>\` : ""}
              </td>
              <td>
                \${c.dryrun_status === "none" ? "" : \`<span class="badge \${dryrunClass}"><span aria-hidden="true">\${DRYRUN_EMOJI[c.dryrun_status] || "—"}</span> \${escapeHtml(c.dryrun_status)}</span><div class="reason"><button type="button" class="output-preview-trigger" data-namespace="\${encodeURIComponent(c.dryrun_namespace)}">show output</button></div>\`}
              </td>
            </tr>
          \`;
        }).join("");

        content.innerHTML = \`
          <div class="table-wrapper">
            <table role="table" aria-label="RADAR component overview">
              <thead>
                <tr>
                  <th scope="col">\${renderDropdown("Component", COMPONENT_OPTIONS, componentSort, "component")}</th>
                  <th scope="col">\${renderDropdown("Current", VERSION_OPTIONS, currentSort, "current")}</th>
                  <th scope="col">\${renderDropdown("Latest", VERSION_OPTIONS, latestSort, "latest")}</th>
                  <th scope="col" class="cve-col">\${renderDropdown("CVE", CVE_OPTIONS, cveSort, "cve")}</th>
                  <th scope="col">\${renderDropdown("Assessment", ASSESSMENT_OPTIONS, assessmentSort, "assessment")}</th>
                  <th scope="col">\${renderDropdown("Dry-run", DRYRUN_OPTIONS, dryrunSort, "dryrun")}</th>
                </tr>
              </thead>
              <tbody>\${rows}</tbody>
            </table>
          </div>
        \`;

        const table = content.querySelector("table");
        table.querySelectorAll(".dropdown-trigger").forEach((trigger) => {
          trigger.addEventListener("click", (e) => {
            e.stopPropagation();
            const dropdown = trigger.closest(".dropdown");
            const wasOpen = dropdown.classList.contains("dropdown-open");
            closeAllDropdowns();
            if (!wasOpen) {
              dropdown.classList.add("dropdown-open");
              trigger.setAttribute("aria-expanded", "true");
            }
          });
        });

        table.querySelectorAll(".dropdown-item").forEach((item) => {
          item.addEventListener("click", () => {
            const col = item.dataset.col;
            const value = item.dataset.value;
            applySort(col, value);
            closeAllDropdowns();
            renderTable();
          });
        });
      }

      function closeAllDropdowns() {
        document.querySelectorAll(".dropdown-open").forEach((d) => {
          d.classList.remove("dropdown-open");
          const trigger = d.querySelector(".dropdown-trigger");
          if (trigger) trigger.setAttribute("aria-expanded", "false");
        });
      }

      document.addEventListener("click", closeAllDropdowns);
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          closeAllDropdowns();
          closeOutputModal();
        }
      });

      const modal = document.getElementById("output-modal");
      const modalBody = document.getElementById("output-modal-body");
      const modalTitle = document.getElementById("output-modal-title");
      const modalFull = document.getElementById("output-modal-full");
      const modalClose = document.getElementById("output-modal-close");

      function openOutputModal(namespace) {
        const url = \`/output?namespace=\${encodeURIComponent(namespace)}\`;
        modalFull.href = url;
        modalTitle.textContent = \`Dry-run \${namespace}\`;
        modalBody.innerHTML = '<div class="message">Loading dry-run output…</div>';
        modal.classList.add("open");
        modal.setAttribute("aria-hidden", "false");
        modalClose.focus();

        fetch(url)
          .then((res) => res.text())
          .then((html) => {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");
            const main = doc.querySelector("main .container");
            modalBody.innerHTML = main ? main.innerHTML : '<div class="message error">Unable to load output preview.</div>';
          })
          .catch(() => {
            modalBody.innerHTML = '<div class="message error">Failed to load dry-run output.</div>';
          });
      }

      function closeOutputModal() {
        modal.classList.remove("open");
        modal.setAttribute("aria-hidden", "true");
        modalBody.innerHTML = '<div class="message">Loading…</div>';
      }

      modalClose.addEventListener("click", closeOutputModal);
      modal.addEventListener("click", (e) => {
        if (e.target === modal) closeOutputModal();
      });

      content.addEventListener("click", (e) => {
        const trigger = e.target.closest(".output-preview-trigger");
        if (!trigger) return;
        e.preventDefault();
        e.stopPropagation();
        openOutputModal(trigger.dataset.namespace);
      });

      const counts = { breaking: 0, update_available: 0, dryrun_success: 0, total: components.length };
      for (const c of components) {
        if (c.risk_level === "breaking") counts.breaking++;
        if (c.update_available) counts.update_available++;
        if (c.dryrun_status === "success") counts.dryrun_success++;
      }

      statusBar.innerHTML = \`
        <div class="stat"><div class="stat-value">\${counts.total}</div><div class="stat-label">Components</div></div>
        <div class="stat"><div class="stat-value \${counts.update_available > 0 ? 'pulse' : ''}">\${counts.update_available}</div><div class="stat-label">Updates Available</div></div>
        <div class="stat"><div class="stat-value">—</div><div class="stat-label">CVE</div></div>
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
