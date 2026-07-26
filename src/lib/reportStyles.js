/**
 * Shared visual language for both the static HTML report (report.js) and
 * the live dashboard (dashboardTemplate.js) so the two never drift apart.
 * Professional light theme: white surface, near-black ink, green as the
 * single brand/interactive accent. Status colors (severity) and the fixed
 * categorical order (competitor comparison charts) follow the dataviz
 * skill's validated light-surface palette. See references/palette.md.
 */
const SHARED_STYLES = `
  :root {
    --bg: #f6f8f6; --panel: #ffffff; --panel-2: #f1f4f1; --border: #e2e6e2;
    --text: #10140f; --muted: #5b625b; --accent: #15803d; --accent-ink: #ffffff;
    --high: #dc2626; --medium: #b45309; --low: #15803d;
    --chrome-bg: #10140f; --chrome-text: #ffffff; --chrome-tagline: #b8c2b8;
  }
  :root[data-theme="dark"] {
    --bg: #0f1410; --panel: #171d17; --panel-2: #1f261f; --border: #2a322a;
    --text: #eef1ec; --muted: #9aa298; --accent: #22c55e; --accent-ink: #06210f;
    --high: #f87171; --medium: #eab308; --low: #4ade80;
  }
  :root[data-theme="dark"] .ai-summary .kb-badge { background: rgba(96,165,250,0.14); color: #93c5fd; border-color: rgba(96,165,250,0.35); }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Segoe UI", -apple-system, Roboto, Helvetica, Arial, sans-serif; background: var(--bg); color: var(--text); line-height: 1.5; -webkit-font-smoothing: antialiased; }
  a { color: var(--accent); }
  .eyebrow { color: var(--accent); font-size: 11.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.1em; }
  .btn { background: var(--accent); color: var(--accent-ink); border: none; padding: 10px 18px; border-radius: 8px; font-size: 13.5px; cursor: pointer; font-weight: 600; box-shadow: 0 1px 2px rgba(16,20,15,0.08); }
  .btn:hover { filter: brightness(1.12); }
  .btn.secondary { background: var(--panel-2); color: var(--text); border: 1px solid var(--border); box-shadow: none; }
  .btn:disabled { opacity: 0.45; cursor: not-allowed; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 14px; margin-bottom: 26px; }
  .card { background: var(--panel); border: 1px solid var(--border); border-top: 3px solid var(--accent); border-radius: 10px; padding: 16px 18px; box-shadow: 0 1px 3px rgba(16,20,15,0.06); }
  .card .label { color: var(--muted); font-size: 11.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; }
  .card .value { font-size: 30px; font-weight: 800; margin-top: 6px; color: var(--text); letter-spacing: -0.01em; }
  .value.high { color: var(--high); } .value.medium { color: var(--medium); } .value.low { color: var(--low); }
  .panel { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 22px 24px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(16,20,15,0.05); }
  .panel h3 { margin: 0 0 14px; font-size: 16px; font-weight: 700; color: var(--text); letter-spacing: -0.01em; }
  .panel .panel-caption { color: var(--muted); font-size: 12px; margin: -10px 0 16px; }
  .chart-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 24px; }
  .chart-card { padding: 4px 2px; }
  .chart-card h4 { margin: 0 0 4px; font-size: 13.5px; font-weight: 700; color: var(--text); }
  .chart-card .chart-sub { color: var(--muted); font-size: 12px; margin: 0 0 14px; }
  .chart-legend { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 10px; font-size: 12px; color: var(--muted); }
  .chart-legend-item { display: inline-flex; align-items: center; gap: 6px; }
  .chart-swatch { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
  .ai-suggestion-box { margin-top: 8px; padding: 8px 10px; background: var(--panel-2); border-left: 3px solid var(--accent); border-radius: 0 6px 6px 0; font-size: 12.5px; line-height: 1.5; }
  .chart-empty { color: var(--muted); font-size: 13px; padding: 24px 0; text-align: center; }
  .ai-summary { line-height: 1.6; font-size: 14px; color: var(--text); }
  .ai-summary table { border-collapse: separate; border-spacing: 0; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
  .ai-summary table th { font-size: 10.5px; background: var(--panel-2); border-bottom: 1px solid var(--border); }
  .ai-summary table td { font-size: 13px; }
  /* Issue = the finding (accent rail), Fix = the action to take (green wash) */
  .ai-summary table td:first-child { border-left: 3px solid var(--accent); background: rgba(21,128,61,0.03); }
  .ai-summary table td:last-child { background: rgba(21,128,61,0.05); border-left: 1px solid var(--border); }
  .ai-summary table tbody tr:last-child td { border-bottom: none; }
  .ai-summary .health-callout { background: var(--panel-2); border-left: 3px solid var(--accent); border-radius: 0 8px 8px 0; padding: 12px 16px; margin: 0 0 16px; font-weight: 600; }
  /* Knowledge-base citation chips read as *reference*, so they take the blue
     informational hue rather than the green used for actions/fixes. */
  .ai-summary .kb-badge { background: rgba(42,120,214,0.10); color: #1c5cab; border-color: rgba(42,120,214,0.30); }
  .ai-summary .muted { color: var(--muted); font-style: italic; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; color: var(--muted); font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; padding: 10px 12px; border-bottom: 2px solid var(--border); position: sticky; top: 0; background: var(--panel); }
  td { padding: 11px 12px; border-bottom: 1px solid var(--border); vertical-align: top; color: var(--text); }
  tr:hover td { background: var(--panel-2); }
  .badge { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; }
  .badge.high { background: rgba(220,38,38,0.10); color: var(--high); }
  .badge.medium { background: rgba(180,83,9,0.12); color: var(--medium); }
  .badge.low { background: rgba(21,128,61,0.12); color: var(--low); }
  .url-cell { max-width: 380px; word-break: break-all; }
  .filters { display: flex; gap: 8px; margin-bottom: 14px; }
  .filters button { background: var(--panel-2); border: 1px solid var(--border); color: var(--text); padding: 6px 12px; border-radius: 999px; font-size: 12px; cursor: pointer; }
  .filters button.active { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
  .empty { color: var(--muted); padding: 30px; text-align: center; }
  .comp-table td, .comp-table th { text-align: center; }
  .comp-table td:first-child, .comp-table th:first-child { text-align: left; }
`;

module.exports = { SHARED_STYLES };
