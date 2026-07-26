const { SHARED_STYLES } = require('./reportStyles');
const { CHART_KIT_JS } = require('./chartKit');

/**
 * Self-contained (no build step) client for the local audit dashboard.
 * Data is fetched client-side from the JSON API served by webServer.js,
 * so this single template renders any saved report by host.
 */
function renderDashboardHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>AuditCLI Dashboard</title>
<style>
${SHARED_STYLES}
  body { padding: 0; }
  .topbar { display: flex; align-items: center; justify-content: space-between; padding: 14px 28px; background: var(--text); color: var(--bg); }
  .topbar .brand { display: flex; align-items: center; gap: 10px; font-weight: 800; font-size: 16px; letter-spacing: -0.01em; }
  .topbar .brand .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--accent); display: inline-block; }
  .topbar .tagline { font-size: 12px; color: #b8c2b8; }
  .layout { display: flex; min-height: calc(100vh - 50px); }
  .sidebar { width: 260px; background: var(--panel); border-right: 1px solid var(--border); padding: 20px 16px; flex-shrink: 0; }
  .sidebar .eyebrow { display: block; margin-bottom: 14px; }
  .report-link { display: block; padding: 10px 12px; border-radius: 8px; color: var(--text); text-decoration: none; font-size: 12.5px; margin-bottom: 4px; border: 1px solid transparent; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .report-link:hover { background: var(--panel-2); }
  .report-link.active { background: rgba(21,128,61,0.10); border-color: rgba(21,128,61,0.35); color: var(--accent); font-weight: 600; }
  .main { flex: 1; padding: 28px 36px; max-width: 1200px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; flex-wrap: wrap; gap: 12px; }
  .header h2 { margin: 0 0 4px; font-size: 26px; font-weight: 800; letter-spacing: -0.01em; word-break: break-all; }
  .header .meta { color: var(--muted); font-size: 13px; }
  .hero { background: var(--text); border-radius: 12px; text-align: center; padding: 26px 24px; margin-bottom: 24px; }
  .hero-mark { font-size: 17px; font-weight: 800; letter-spacing: 0.24em; text-transform: uppercase; color: #ffffff; }
  .hero-rule { width: 48px; height: 3px; background: var(--accent); margin: 12px auto 10px; }
  .hero-tag { color: #b8c2b8; font-size: 12px; letter-spacing: 0.04em; }
  .kb-badge { display: inline-block; background: var(--panel-2); color: var(--muted); border: 1px solid var(--border); border-radius: 4px; padding: 2px 8px; font-size: 10.5px; font-weight: 600; margin-top: 6px; letter-spacing: 0.02em; }
  .push-btn { background: var(--panel-2); border: 1px solid var(--border); color: var(--text); padding: 4px 10px; border-radius: 6px; font-size: 11px; cursor: pointer; }
  .push-btn:hover { border-color: var(--accent); color: var(--accent); }
  .push-btn.done { color: var(--low); border-color: var(--low); cursor: default; }
  /* Brand colors: Jira blue (#0052CC) and Slack's aubergine (#4A154B) — so
     these read as "this goes to Jira/Slack" at a glance instead of blending
     into the generic action buttons. */
  .btn-jira { background: #0052CC; }
  .btn-jira:disabled { background: var(--panel-2); }
  .btn-slack { background: #4A154B; color: #fff; }
  .btn-slack:disabled { background: var(--panel-2); color: var(--text); }
  .push-btn-jira { border-color: #0052CC; color: #0052CC; }
  .push-btn-jira:hover { border-color: #0052CC; color: #0052CC; filter: brightness(1.15); }
  .push-btn-jira:disabled { border-color: var(--border); color: var(--text); }
  .push-btn-slack { border-color: #4A154B; color: #4A154B; }
  .push-btn-slack:hover { border-color: #4A154B; color: #4A154B; filter: brightness(1.3); }
  .push-btn-slack:disabled { border-color: var(--border); color: var(--text); }
  .toast { position: fixed; bottom: 20px; right: 20px; background: var(--chrome-bg); color: var(--chrome-text); border: 1px solid var(--border); padding: 12px 18px; border-radius: 10px; font-size: 13px; box-shadow: 0 8px 24px rgba(16,20,15,0.18); opacity: 0; transform: translateY(8px); transition: all .2s; z-index: 50; }
  .toast.show { opacity: 1; transform: translateY(0); }
  .ch-tooltip { position: fixed; pointer-events: none; background: var(--chrome-bg); color: var(--chrome-text); font-size: 12px; padding: 6px 10px; border-radius: 6px; box-shadow: 0 4px 12px rgba(16,20,15,0.25); opacity: 0; transform: translateY(4px); transition: opacity .1s; z-index: 100; white-space: nowrap; }
  .ch-tooltip.show { opacity: 1; transform: translateY(0); }
</style>
</head>
<body>
  <div class="topbar">
    <div class="brand"><span class="dot"></span>AuditCLI</div>
    <div class="tagline">Website Health, Security &amp; Content Auditor</div>
  </div>
  <div class="layout">
    <div class="sidebar">
      <span class="eyebrow">Saved Reports</span>
      <div id="report-list"></div>
    </div>
    <div class="main" id="main">
      <div class="empty">Loading report…</div>
    </div>
  </div>
  <div class="toast" id="toast"></div>
  <div class="ch-tooltip" id="ch-tooltip"></div>

<script>
${CHART_KIT_JS}

const state = { host: new URLSearchParams(location.search).get('host'), report: null, filter: 'all', pageFilter: null, jiraConfigured: false, slackConfigured: false, pushed: new Set(), aiItems: [] };

async function init() {
  const [reports, jiraStatus, slackStatus] = await Promise.all([
    fetch('/api/reports').then(r => r.json()),
    fetch('/api/jira/status').then(r => r.json()),
    fetch('/api/slack/status').then(r => r.json()),
  ]);
  state.jiraConfigured = jiraStatus.configured;
  state.slackConfigured = slackStatus.configured;
  renderSidebar(reports);
  if (!state.host && reports.length) state.host = reports[0].host;
  if (!state.host) { document.getElementById('main').innerHTML = '<div class="empty">No reports found. Run <code>auditcli scan &lt;url&gt;</code> first.</div>'; return; }
  await loadReport(state.host);
}

function renderSidebar(reports) {
  const el = document.getElementById('report-list');
  el.innerHTML = reports.map(r => \`<a class="report-link \${r.host === state.host ? 'active' : ''}" href="/?host=\${encodeURIComponent(r.host)}">\${escapeHtml(r.targetUrl)}</a>\`).join('') || '<span class="tag">No reports yet</span>';
}

async function loadReport(host) {
  const res = await fetch('/api/report/' + encodeURIComponent(host));
  if (!res.ok) { document.getElementById('main').innerHTML = '<div class="empty">Report not found.</div>'; return; }
  state.report = await res.json();
  state.pushed = new Set(state.report.issues.map((i, idx) => i.jiraKey ? idx : -1).filter(idx => idx >= 0));
  render();
}

function severityCounts(issues) {
  return issues.reduce((acc, i) => { acc[i.severity] = (acc[i.severity]||0)+1; return acc; }, { high:0, medium:0, low:0 });
}

function render() {
  const r = state.report;
  const counts = severityCounts(r.issues);
  const main = document.getElementById('main');

  main.innerHTML = \`
    <div class="hero">
      <div class="hero-mark">AuditCLI</div>
      <div class="hero-rule"></div>
      <div class="hero-tag">Automated Website Health, Security &amp; Content Report</div>
    </div>

    <div class="header">
      <div>
        <div class="eyebrow">Website Audit Report</div>
        <h2>\${escapeHtml(r.targetUrl)}</h2>
        <div class="meta">Scanned \${new Date(r.timestamp).toLocaleString()} · \${r.pagesCrawled} pages · \${r.assetsFound} assets</div>
      </div>
      <div style="display:flex; gap:8px;">
        <button class="btn secondary" id="download-pdf">Download PDF</button>
        <button class="btn btn-slack" id="push-slack-summary" \${state.slackConfigured ? '' : 'disabled title="Configure Slack in .env to enable"'}>Post summary to Slack</button>
        <button class="btn btn-jira" id="push-all" \${state.jiraConfigured ? '' : 'disabled title="Configure Jira in .env to enable"'}>Push all to Jira</button>
      </div>
    </div>

    <div class="cards">
      <div class="card"><div class="label">Total issues</div><div class="value">\${r.issues.length}</div></div>
      <div class="card"><div class="label">High</div><div class="value high">\${counts.high||0}</div></div>
      <div class="card"><div class="label">Medium</div><div class="value medium">\${counts.medium||0}</div></div>
      <div class="card"><div class="label">Low</div><div class="value low">\${counts.low||0}</div></div>
      <div class="card"><div class="label">Performance</div><div class="value \${scoreClass(r.performance?.details?.score)}">\${r.performance?.details?.score ?? 'n/a'}</div></div>
      <div class="card"><div class="label">Risk score</div><div class="value \${scoreClass(r.riskScore)}">\${r.riskScore ?? 'n/a'}</div></div>
    </div>

    <div class="panel">
      <h3>Visual overview</h3>
      <div class="chart-grid">
        <div class="chart-card">
          <h4>Performance score</h4>
          <p class="chart-sub">Heuristic 0-100 score from load time, payload size, and image count.</p>
          <div id="chart-meter"></div>
        </div>
        <div class="chart-card">
          <h4>Risk score</h4>
          <p class="chart-sub">Weighted by finding severity (high=12, medium=4, low=1) — separate from performance.\${renderPeerNote(r.peerStats)}</p>
          <div id="chart-risk"></div>
        </div>
        <div class="chart-card" style="grid-column: 1 / -1;">
          <h4>Issues by severity</h4>
          <p class="chart-sub">\${r.issues.length} total issue\${r.issues.length === 1 ? '' : 's'} found across the crawl.</p>
          <div id="chart-severity"></div>
        </div>
        <div class="chart-card" style="grid-column: 1 / -1;">
          <h4>Top issue types</h4>
          <p class="chart-sub">Most frequent finding categories, highest first.</p>
          <div id="chart-types"></div>
        </div>
        \${r.competitors && r.competitors.length ? \`
        <div class="chart-card">
          <h4>Performance score by site</h4>
          <div id="chart-comp-score"></div>
        </div>
        <div class="chart-card">
          <h4>Issues found by site</h4>
          <div id="chart-comp-issues"></div>
        </div>\` : ''}
      </div>
    </div>

    <div class="panel">
      <h3>AI Root-Cause Analysis</h3>
      <p class="panel-caption">Root-cause analysis grounded via RAG retrieval (TF-IDF vector similarity) against a curated vulnerability knowledge base.</p>
      \${r.aiSummary && r.aiSummary.ok ? '<div id="chart-kb-coverage" style="max-width:400px; margin-bottom:16px;"></div>' : ''}
      <div class="ai-summary">\${renderAiSummary(r.aiSummary)}</div>
    </div>

    <div class="panel" id="issues-panel">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <h3 style="margin:0;">Issues</h3>
        <button class="btn secondary" id="add-issue-btn">+ Add issue</button>
      </div>
      <div id="page-filter-banner"></div>
      <div id="issue-form-container"></div>
      <div class="filters">
        \${['all','high','medium','low'].map(f => \`<button data-filter="\${f}" class="\${state.filter===f?'active':''}">\${f}</button>\`).join('')}
      </div>
      <div style="max-height:480px; overflow:auto;">
        <table>
          <thead><tr><th>Severity</th><th>Type</th><th>URL</th><th>Detail</th><th></th></tr></thead>
          <tbody id="issues-body"></tbody>
        </table>
      </div>
    </div>

    <div class="panel">
      <h3>Per-page breakdown</h3>
      <p class="panel-caption">Issues attributed to the specific page they were found on.</p>
      \${renderPageBreakdown(r.issues)}
    </div>

    \${renderCompetitors(r.competitors)}

    <div class="panel">
      <h3>Tech stack & security posture</h3>
      <p style="font-size:13px; color:var(--muted); margin:0 0 10px;">
        Tech: \${(r.techStack||[]).join(', ') || 'none detected'}
      </p>
      <p style="font-size:13px; color:var(--muted); margin:0;">
        TLS: \${r.security?.tls ? \`\${r.security.tls.protocol}, expires \${r.security.tls.validTo ? new Date(r.security.tls.validTo).toDateString() : 'n/a'}\` : 'n/a (not HTTPS or unreachable)'}
      </p>
    </div>
  \`;

  document.querySelectorAll('.filters button').forEach(b => b.onclick = () => { state.filter = b.dataset.filter; render(); });
  document.getElementById('push-all').onclick = pushAllToJira;
  document.getElementById('add-issue-btn').onclick = () => showIssueForm('add');
  document.getElementById('download-pdf').onclick = downloadPdf;
  document.getElementById('push-slack-summary').onclick = pushSummaryToSlack;
  renderIssueRows();
  bindPageBreakdownClicks();
  bindAiSummaryClicks();
  updatePageFilterBanner();
  drawCharts(r);
}

function typeCounts(issues) {
  const map = new Map();
  issues.forEach(i => map.set(i.type, (map.get(i.type) || 0) + 1));
  return [...map.entries()].map(([label, value]) => ({ label, value }));
}

function renderPeerNote(peerStats) {
  if (!peerStats) return '';
  const direction = peerStats.issueCountVsPeerAvg > 0 ? 'more' : 'fewer';
  const flag = peerStats.isIssueOutlier ? ' — statistical outlier' : '';
  return \` \${Math.abs(peerStats.issueCountVsPeerAvg)}% \${direction} issues than your \${peerStats.peerCount}-competitor peer average\${flag}.\`;
}

function drawCharts(r) {
  renderMeter('chart-meter', { value: r.performance?.details?.score ?? 0, max: 100, label: hostOf(r.targetUrl) });
  renderMeter('chart-risk', { value: r.riskScore ?? 0, max: 100, label: hostOf(r.targetUrl) });
  renderSeverityBar('chart-severity', severityCounts(r.issues));
  renderBarChart('chart-types', typeCounts(r.issues));
  if (r.aiSummary && r.aiSummary.ok && r.aiSummary.items) {
    const grounded = r.aiSummary.items.filter(it => it.source).length;
    renderMeter('chart-kb-coverage', { value: grounded, max: r.aiSummary.items.length, label: 'Knowledge base coverage' });
  }
  if (r.competitors && r.competitors.length) {
    const sites = [r, ...r.competitors];
    renderEntityBarChart('chart-comp-score', sites.map(s => ({ label: hostOf(s.targetUrl), value: s.performance?.details?.score ?? 0 })));
    renderEntityBarChart('chart-comp-issues', sites.map(s => ({ label: hostOf(s.targetUrl), value: s.issues.length })));
  }
}

function pageBreakdown(issues) {
  const map = new Map();
  issues.forEach(i => {
    const page = i.foundOn || i.url || 'Unattributed';
    if (!map.has(page)) map.set(page, { url: page, high: 0, medium: 0, low: 0, total: 0 });
    const entry = map.get(page);
    entry[i.severity] = (entry[i.severity] || 0) + 1;
    entry.total++;
  });
  return [...map.values()].sort((a, b) => b.total - a.total);
}

function renderPageBreakdown(issues) {
  const pages = pageBreakdown(issues);
  if (!pages.length) return '<div class="chart-empty">No issues to break down.</div>';
  const shown = pages.slice(0, 20);
  const rows = shown.map(p => \`<tr class="page-row" data-page="\${escapeHtml(p.url)}" style="cursor:pointer;" title="Click to view this page's issues below">
    <td class="url-cell" title="\${escapeHtml(p.url)}">\${escapeHtml(p.url)}</td>
    <td>\${p.high ? \`<span class="badge high">\${p.high} high</span>\` : ''}</td>
    <td>\${p.medium ? \`<span class="badge medium">\${p.medium} medium</span>\` : ''}</td>
    <td>\${p.low ? \`<span class="badge low">\${p.low} low</span>\` : ''}</td>
    <td style="font-weight:700;">\${p.total}</td>
  </tr>\`).join('');
  const more = pages.length > shown.length ? \`<p class="chart-sub" style="margin-top:10px;">…and \${pages.length - shown.length} more page(s), see full JSON/CSV export.</p>\` : '';
  return \`<table><thead><tr><th>Page</th><th>High</th><th>Medium</th><th>Low</th><th>Total</th></tr></thead><tbody>\${rows}</tbody></table>\${more}\`;
}

function bindPageBreakdownClicks() {
  document.querySelectorAll('.page-row').forEach(row => {
    row.onclick = () => {
      state.pageFilter = row.dataset.page;
      renderIssueRows();
      updatePageFilterBanner();
      document.getElementById('issues-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  });
}

function updatePageFilterBanner() {
  const el = document.getElementById('page-filter-banner');
  if (!el) return;
  if (!state.pageFilter) { el.innerHTML = ''; return; }
  el.innerHTML = \`<div class="chart-legend-item" style="background:var(--panel-2); padding:6px 12px; border-radius:999px; margin-bottom:10px;">
    Showing issues for <strong>\${escapeHtml(state.pageFilter)}</strong>
    <button class="push-btn" id="clear-page-filter" style="margin-left:8px;">Clear</button>
  </div>\`;
  document.getElementById('clear-page-filter').onclick = () => { state.pageFilter = null; renderIssueRows(); updatePageFilterBanner(); };
}

function aiFixPrompt(it) {
  return \`Fix this website issue.\\n\\nIssue: \${it.issue}\\nRoot cause: \${it.rootCause}\\nSuggested fix: \${it.fix}\\n\\nProvide the exact code change needed.\`;
}

function renderAiSummary(ai) {
  if (!ai) return '<span class="muted">Run the scan with --ai to generate an executive summary.</span>';
  if (!ai.ok) return \`<span class="muted">AI summary unavailable (\${escapeHtml(ai.reason || 'unknown error')}).</span>\`;
  state.aiItems = ai.items || [];
  const health = ai.overallHealth ? \`<p class="health-callout">\${escapeHtml(ai.overallHealth)}</p>\` : '';
  const rows = (ai.items || []).map((it, idx) => \`<tr>
    <td style="font-weight:600; white-space:nowrap;">\${escapeHtml(it.issue)}</td>
    <td>\${escapeHtml(it.rootCause)}\${it.source ? \`<div><span class="kb-badge">\${escapeHtml(it.source)}</span></div>\` : ''}</td>
    <td>\${escapeHtml(it.fix)}</td>
    <td><button class="push-btn ai-prompt-btn" data-idx="\${idx}">Copy prompt</button></td>
  </tr>\`).join('');
  const table = rows ? \`<table><thead><tr><th>Issue</th><th>Root Cause</th><th>Suggested Fix</th><th>Prompt</th></tr></thead><tbody>\${rows}</tbody></table>\` : '';
  return health + table;
}

function bindAiSummaryClicks() {
  document.querySelectorAll('.ai-prompt-btn').forEach(btn => {
    btn.onclick = async () => {
      const it = state.aiItems[Number(btn.dataset.idx)];
      if (!it) return;
      try {
        await navigator.clipboard.writeText(aiFixPrompt(it));
        const original = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = original; }, 1500);
      } catch (_) { /* clipboard unavailable */ }
    };
  });
}

function renderCompetitors(competitors) {
  if (!competitors || !competitors.length) return '';
  const target = state.report;
  const cols = [target, ...competitors];
  const row = (label, fn) => \`<tr><td>\${label}</td>\${cols.map(c => \`<td>\${fn(c)}</td>\`).join('')}</tr>\`;
  return \`
    <div class="panel">
      <h3>Competitor comparison</h3>
      <table class="comp-table">
        <thead><tr><th>Metric</th>\${cols.map(c => \`<th>\${escapeHtml(hostOf(c.targetUrl))}</th>\`).join('')}</tr></thead>
        <tbody>
          \${row('Performance score', c => c.performance?.details?.score ?? 'n/a')}
          \${row('Issues found', c => c.issues.length)}
          \${row('Pages crawled', c => c.pagesCrawled)}
        </tbody>
      </table>
    </div>
  \`;
}

function renderIssueRows() {
  const r = state.report;
  let filtered = state.filter === 'all' ? r.issues : r.issues.filter(i => i.severity === state.filter);
  if (state.pageFilter) filtered = filtered.filter(i => (i.foundOn || i.url) === state.pageFilter);
  const sorted = [...filtered].sort((a,b) => ({high:0,medium:1,low:2}[a.severity]??3) - ({high:0,medium:1,low:2}[b.severity]??3));
  const body = document.getElementById('issues-body');
  if (!sorted.length) { body.innerHTML = '<tr><td colspan="5" class="empty">No issues in this category.</td></tr>'; return; }
  body.innerHTML = sorted.map((issue) => {
    const idx = r.issues.indexOf(issue);
    const pushed = state.pushed.has(idx);
    const suggestion = issue.aiSuggestion;
    const suggestionHtml = suggestion ? \`
      <div class="ai-suggestion-box">
        <div><strong>Root cause:</strong> \${escapeHtml(suggestion.rootCause)}</div>
        <div style="margin-top:4px;"><strong>Suggested fix:</strong> \${escapeHtml(suggestion.fix)}</div>
        \${suggestion.source ? \`<div style="margin-top:6px;"><span class="kb-badge">\${escapeHtml(suggestion.source)}</span></div>\` : ''}
      </div>\` : '';
    return \`<tr>
      <td><span class="badge \${issue.severity}">\${issue.severity}</span></td>
      <td>\${escapeHtml(issue.type)}</td>
      <td class="url-cell" title="\${escapeHtml(issue.url||'')}">\${escapeHtml(issue.url||'—')}</td>
      <td>\${escapeHtml(issue.detail)}\${suggestionHtml}</td>
      <td style="white-space:nowrap;">
        <button class="push-btn" data-action="edit" data-idx="\${idx}">Edit</button>
        <button class="push-btn" data-action="suggest" data-idx="\${idx}">\${suggestion ? 'Re-suggest' : 'AI suggest'}</button>
        <button class="push-btn push-btn-slack" data-action="slack" data-idx="\${idx}" \${state.slackConfigured ? '' : 'disabled'}>Slack</button>
        <button class="push-btn push-btn-jira \${pushed?'done':''}" data-action="push" data-idx="\${idx}" \${state.jiraConfigured ? '' : 'disabled'}>\${pushed ? '✓ In Jira' : 'Jira'}</button>
      </td>
    </tr>\`;
  }).join('');
  body.querySelectorAll('[data-action="push"]').forEach(btn => btn.onclick = () => pushOneToJira(Number(btn.dataset.idx)));
  body.querySelectorAll('[data-action="edit"]').forEach(btn => btn.onclick = () => showIssueForm('edit', Number(btn.dataset.idx)));
  body.querySelectorAll('[data-action="suggest"]').forEach(btn => btn.onclick = () => suggestForIssue(Number(btn.dataset.idx), btn));
  body.querySelectorAll('[data-action="slack"]').forEach(btn => btn.onclick = () => pushIssueToSlack(Number(btn.dataset.idx), btn));
}

function showIssueForm(mode, idx) {
  const container = document.getElementById('issue-form-container');
  const issue = mode === 'edit' ? state.report.issues[idx] : { severity: 'medium', type: '', url: '', detail: '' };
  container.innerHTML = \`
    <div class="panel" style="background:var(--panel-2); margin-bottom:14px;">
      <h4 style="margin:0 0 10px;">\${mode === 'edit' ? 'Edit issue' : 'Add new issue'}</h4>
      <div style="display:grid; grid-template-columns: 140px 1fr; gap:10px; align-items:center; max-width:640px;">
        <label style="font-size:12px; color:var(--muted);">Severity</label>
        <select id="issue-form-severity" style="padding:6px 8px; border-radius:6px; border:1px solid var(--border);">
          \${['high','medium','low'].map(s => \`<option value="\${s}" \${issue.severity===s?'selected':''}>\${s}</option>\`).join('')}
        </select>
        <label style="font-size:12px; color:var(--muted);">Type</label>
        <input id="issue-form-type" type="text" maxlength="60" value="\${escapeHtml(issue.type)}" placeholder="e.g. missing-rate-limiting" style="padding:6px 8px; border-radius:6px; border:1px solid var(--border);" />
        <label style="font-size:12px; color:var(--muted);">URL (optional)</label>
        <input id="issue-form-url" type="text" value="\${escapeHtml(issue.url||'')}" placeholder="https://..." style="padding:6px 8px; border-radius:6px; border:1px solid var(--border);" />
        <label style="font-size:12px; color:var(--muted);">Detail</label>
        <textarea id="issue-form-detail" rows="3" maxlength="600" placeholder="Describe the finding factually" style="padding:6px 8px; border-radius:6px; border:1px solid var(--border); font-family:inherit;">\${escapeHtml(issue.detail)}</textarea>
      </div>
      <div style="margin-top:12px; display:flex; gap:8px;">
        <button class="btn" id="issue-form-save">\${mode === 'edit' ? 'Save changes' : 'Add issue'}</button>
        <button class="btn secondary" id="issue-form-cancel">Cancel</button>
      </div>
      <div id="issue-form-error" style="color:var(--high); font-size:12px; margin-top:8px;"></div>
    </div>
  \`;
  document.getElementById('issue-form-cancel').onclick = () => { container.innerHTML = ''; };
  document.getElementById('issue-form-save').onclick = () => submitIssueForm(mode, idx);
}

async function submitIssueForm(mode, idx) {
  const payload = {
    severity: document.getElementById('issue-form-severity').value,
    type: document.getElementById('issue-form-type').value.trim(),
    url: document.getElementById('issue-form-url').value.trim(),
    detail: document.getElementById('issue-form-detail').value.trim(),
  };
  const errorEl = document.getElementById('issue-form-error');
  errorEl.textContent = '';

  const endpoint = mode === 'edit' ? \`/api/report/\${encodeURIComponent(state.host)}/issues/\${idx}\` : \`/api/report/\${encodeURIComponent(state.host)}/issues\`;
  const res = await fetch(endpoint, { method: mode === 'edit' ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await res.json();
  if (!data.ok) { errorEl.textContent = data.error || 'Failed to save issue.'; return; }

  if (mode === 'edit') state.report.issues[idx] = data.issue;
  else state.report.issues.push(data.issue);
  if (typeof data.riskScore === 'number') state.report.riskScore = data.riskScore;

  document.getElementById('issue-form-container').innerHTML = '';
  showToast(mode === 'edit' ? 'Issue updated' : 'Issue added');
  render();
}

async function suggestForIssue(idx, btn) {
  const originalText = btn.textContent;
  btn.textContent = 'Thinking…';
  btn.disabled = true;
  try {
    const res = await fetch(\`/api/report/\${encodeURIComponent(state.host)}/issues/\${idx}/suggest\`, { method: 'POST' });
    const data = await res.json();
    if (!data.ok) { showToast('AI suggestion failed: ' + (data.error || 'unknown error')); return; }
    state.report.issues[idx].aiSuggestion = data.suggestion;
    showToast('AI suggestion ready');
    renderIssueRows();
  } catch (err) {
    showToast('AI suggestion failed: ' + err.message);
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

async function pushOneToJira(idx) {
  showToast('Creating Jira ticket…');
  const res = await fetch('/api/jira/push', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ host: state.host, issueIndex: idx }) });
  const data = await res.json();
  if (data.ok) { state.pushed.add(idx); state.report.issues[idx].jiraKey = data.key; showToast(\`Created \${data.key}\`); renderIssueRows(); }
  else showToast('Failed: ' + (data.error || 'unknown error'));
}

async function pushAllToJira() {
  showToast('Creating Jira tickets for all issues…');
  const res = await fetch('/api/jira/push-all', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ host: state.host }) });
  const data = await res.json();
  if (data.ok) {
    data.created.forEach(({ index, key }) => { state.pushed.add(index); state.report.issues[index].jiraKey = key; });
    showToast(\`Created \${data.created.length}/\${data.total} tickets\`);
    renderIssueRows();
  } else showToast('Failed: ' + (data.error || 'unknown error'));
}

async function pushSummaryToSlack() {
  showToast('Posting summary to Slack…');
  const res = await fetch('/api/slack/push-summary', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ host: state.host }) });
  const data = await res.json();
  showToast(data.ok ? 'Posted to Slack' : 'Slack post failed: ' + (data.error || 'unknown error'));
}

async function pushIssueToSlack(idx, btn) {
  const originalText = btn.textContent;
  btn.textContent = '…';
  btn.disabled = true;
  const res = await fetch('/api/slack/push', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ host: state.host, issueIndex: idx }) });
  const data = await res.json();
  showToast(data.ok ? 'Posted to Slack' : 'Slack post failed: ' + (data.error || 'unknown error'));
  btn.textContent = originalText;
  btn.disabled = false;
}

async function downloadPdf() {
  const btn = document.getElementById('download-pdf');
  const originalText = btn.textContent;
  btn.textContent = 'Rendering…';
  btn.disabled = true;
  try {
    const res = await fetch('/api/report/' + encodeURIComponent(state.host) + '/pdf');
    if (!res.ok) throw new Error('Server returned ' + res.status);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'audit-' + state.host + '.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('PDF downloaded');
  } catch (err) {
    showToast('PDF export failed: ' + err.message);
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

function hostOf(url) { try { return new URL(url).hostname; } catch(_) { return url; } }
function scoreClass(score) { if (typeof score !== 'number') return ''; return score >= 80 ? 'low' : score >= 50 ? 'medium' : 'high'; }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

init();
</script>
</body>
</html>`;
}

module.exports = { renderDashboardHtml };
