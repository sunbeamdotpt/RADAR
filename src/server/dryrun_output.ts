import type { DryRun } from "../schema/dryrun.ts";
import { themeInitScript, themeToggleButton, themeToggleScript } from "./theme.ts";

function escapeHtml(str: string): string {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeHtmlServer(str: string): string {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderPage(
  title: string,
  mainContent: string,
  status: number,
  grafanaUrl?: string,
): Response {
  const grafanaLink = grafanaUrl
    ? `<a href="${
      escapeHtmlServer(grafanaUrl)
    }" class="grafana-link" target="_blank" rel="noopener noreferrer" aria-label="Open Grafana dashboard"><img src="/assets/grafana.svg" alt="Grafana" class="grafana-logo"></a>`
    : "";
  const html = `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${themeInitScript()}
  <title>${escapeHtml(title)}</title>
  <link rel="icon" type="image/svg+xml" href="/assets/sunbeam-icon.svg">
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
      --accent: #fa520f;
      --accent-hover: #fb6424;
      --success: #4ade80;
      --warning: #facc15;
      --danger: #ef4444;
      --info: #60a5fa;
      --sunshine-700: #ffa110;
      --sunshine-500: #ffb83e;
      --sunshine-300: #ffd06a;
      --beam-gold: #ffe295;
      --warm-subtle-bg: rgba(255, 161, 16, 0.04);
    }

    html[data-theme="light"] {
      --bg-page: #fff8e0;
      --bg-card: #fff0c2;
      --bg-nav: rgba(255, 248, 224, 0.92);
      --text-primary: #1f1f1f;
      --text-secondary: rgba(31, 31, 31, 0.7);
      --text-muted: rgba(31, 31, 31, 0.5);
      --border-default: rgba(127, 99, 21, 0.2);
      --accent: #fa520f;
      --accent-hover: #fb6424;
      --success: #15803d;
      --warning: #a16207;
      --danger: #b91c1c;
      --info: #1d4ed8;
      --sunshine-700: #b45309;
      --sunshine-500: #f59e0b;
      --sunshine-300: #fbbf24;
      --beam-gold: #d97706;
      --warm-subtle-bg: rgba(127, 99, 21, 0.06);
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
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }

    h1 .h1-text {
      display: inline-flex;
      align-items: center;
      gap: 0.25em;
    }

    .grafana-link {
      display: inline-flex;
      align-items: center;
      flex-shrink: 0;
      opacity: 0.85;
      transition: opacity 0.15s ease;
    }

    .grafana-link:hover { opacity: 1; }

    .grafana-logo {
      height: 1.6875rem;
      width: auto;
    }

    .header-actions {
      display: inline-flex;
      align-items: center;
      gap: 0.75rem;
      flex-shrink: 0;
    }

    .theme-toggle {
      background: transparent;
      border: 0;
      padding: 0.25rem;
      color: var(--text-secondary);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: color 0.2s ease;
    }

    .theme-toggle:hover {
      color: var(--accent);
    }

    .theme-icon {
      width: 1.6875rem;
      height: 1.6875rem;
    }

    .radar-glow {
      text-shadow: 0 0 18px rgba(250, 82, 15, 0.35), 0 0 42px rgba(250, 82, 15, 0.12);
      animation: radar-glow 3s ease-in-out infinite;
    }

    @keyframes radar-glow {
      0%, 100% { text-shadow: 0 0 18px rgba(250, 82, 15, 0.45), 0 0 42px rgba(250, 82, 15, 0.18); }
      50% { text-shadow: 0 0 34px rgba(250, 82, 15, 0.75), 0 0 78px rgba(250, 82, 15, 0.32); }
    }

    html[data-theme="light"] .radar-glow {
      text-shadow: 0 0 18px rgba(250, 82, 15, 0.55), 0 0 42px rgba(250, 82, 15, 0.25);
      animation: radar-glow-light 3s ease-in-out infinite;
    }

    @keyframes radar-glow-light {
      0%, 100% { text-shadow: 0 0 18px rgba(250, 82, 15, 0.65), 0 0 42px rgba(250, 82, 15, 0.3); }
      50% { text-shadow: 0 0 34px rgba(250, 82, 15, 0.95), 0 0 78px rgba(250, 82, 15, 0.45); }
    }

    h1 .accent { color: var(--accent); }

    h1 .logo {
      height: 1.6875rem;
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

    main { padding: 2rem 0; }

    .meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      margin-bottom: 1.5rem;
      flex-wrap: wrap;
    }

    .namespace {
      font-size: 1.25rem;
      font-weight: 791;
      color: var(--text-primary);
    }

    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      padding: 0.25rem 0.5rem;
      border-radius: 2px;
      font-size: 0.75rem;
      font-weight: 791;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .status-success { background: rgba(74, 222, 128, 0.12); color: var(--success); border: 1px solid rgba(74, 222, 128, 0.25); }
    .status-build_failed { background: rgba(239, 68, 68, 0.15); color: var(--danger); border: 1px solid rgba(239, 68, 68, 0.3); }
    .status-dryrun_failed { background: rgba(239, 68, 68, 0.15); color: var(--danger); border: 1px solid rgba(239, 68, 68, 0.3); }
    .status-skipped_no_mapping { background: rgba(255, 255, 255, 0.08); color: var(--text-secondary); border: 1px solid var(--border-default); }
    .status-skipped_unsupported_source { background: rgba(255, 255, 255, 0.08); color: var(--text-secondary); border: 1px solid var(--border-default); }

    html[data-theme="light"] .status-skipped_no_mapping { background: rgba(127, 99, 21, 0.08); }
    html[data-theme="light"] .status-skipped_unsupported_source { background: rgba(127, 99, 21, 0.08); }

    section {
      background: var(--bg-card);
      border: 1px solid var(--border-default);
      border-radius: 2px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
      margin-bottom: 1rem;
      overflow: hidden;
    }

    h2 {
      margin: 0;
      padding: 0.75rem 1rem;
      font-size: 0.75rem;
      font-weight: 791;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--sunshine-700);
      background: var(--warm-subtle-bg);
      border-bottom: 1px solid var(--border-default);
    }

    pre {
      margin: 0;
      padding: 1rem;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: 'Monaspace Argon', 'SF Mono', 'Fira Code', monospace;
      font-size: 0.8125rem;
      line-height: 1.6;
      color: var(--text-secondary);
      background: var(--bg-card);
    }

    .empty {
      margin: 0;
      padding: 1rem;
      color: var(--text-muted);
      font-style: italic;
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
      .container { padding-left: 1rem; padding-right: 1rem; }
      footer { padding-left: 1rem; padding-right: 1rem; }
    }
  </style>
</head>
<body>
  <header>
    <div class="header-inner container">
      <h1>
        <span class="h1-text"><span class="accent">Sunbeam</span> <span class="radar-glow">RADAR</span> <img src="/assets/sunbeam-icon.svg" alt="" class="logo"></span>
        <span class="header-actions">
          ${grafanaLink}
          ${themeToggleButton()}
        </span>
      </h1>
      <p class="subtitle">Dry-run output viewer</p>
    </div>
  </header>
  <main>
    <div class="container">
      ${mainContent}
    </div>
  </main>
  <footer>
    Data refreshes when the inventory, assess, and dry-run jobs run.
  </footer>
  ${themeToggleScript()}
</body>
</html>`;

  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export function renderDryRunOutput(
  namespace: string,
  dryRun: DryRun | undefined,
  grafanaUrl?: string,
): Response {
  if (!dryRun) {
    return renderPage(
      "Dry-run not found — Sunbeam RADAR",
      `<p>Dry-run for namespace <code>${escapeHtml(namespace)}</code> not found.</p>`,
      404,
      grafanaUrl,
    );
  }

  const statusClass = `status-${dryRun.status}`;
  const sections = [
    { title: "kubectl stdout", content: dryRun.stdout },
    { title: "kubectl stderr", content: dryRun.stderr },
    { title: "Sunbeam logs", content: String(dryRun.details?.sunbeam_stderr ?? "") },
    { title: "Details", content: JSON.stringify(dryRun.details, null, 2) },
  ];

  const sectionHtml = sections.map((s) => {
    const hasContent = s.content.trim().length > 0;
    return `
      <section>
        <h2>${escapeHtml(s.title)}</h2>
        ${hasContent ? `<pre>${escapeHtml(s.content)}</pre>` : `<p class="empty">—</p>`}
      </section>
    `;
  }).join("");

  const mainContent = `
    <div class="meta">
      <span class="namespace">${escapeHtml(namespace)}</span>
      <span class="status-badge ${statusClass}">${escapeHtml(dryRun.status)}</span>
    </div>
    ${sectionHtml}
  `;

  return renderPage(`Dry-run ${namespace} — Sunbeam RADAR`, mainContent, 200, grafanaUrl);
}
