const fs = require('fs');
const path = require('path');
const { SHARED_STYLES } = require('./reportStyles');
const { CHART_KIT_JS } = require('./chartKit');

function severityWeight(s) {
  return { high: 0, medium: 1, low: 2 }[s] ?? 3;
}

function slimForExport(auditResult) {
  const { rootPageHtml, ...rest } = auditResult;
  return {
    ...rest,
    competitors: (auditResult.competitors || []).map(({ rootPageHtml: _drop, ...c }) => c),
  };
}

function generateMarkdownReport(auditResult) {
  const { targetUrl, issues, techStack, performance, competitors, timestamp } = auditResult;
  const sorted = [...issues].sort((a, b) => severityWeight(a.severity) - severityWeight(b.severity));

  let md = `# AuditCLI Report\n\n`;
  md += `**Target:** ${targetUrl}\n\n**Generated:** ${timestamp}\n\n`;
  md += `## Summary\n\n`;
  md += `- Total issues found: **${issues.length}**\n`;
  md += `- High severity: **${issues.filter(i => i.severity === 'high').length}**\n`;
  md += `- Medium severity: **${issues.filter(i => i.severity === 'medium').length}**\n`;
  md += `- Low severity: **${issues.filter(i => i.severity === 'low').length}**\n`;
  md += `- Performance score: **${performance?.details?.score ?? 'n/a'}/100**\n`;
  md += `- Detected tech stack: ${techStack.length ? techStack.join(', ') : 'none detected'}\n\n`;

  if (auditResult.aiSummary?.ok) {
    const ai = auditResult.aiSummary;
    md += `## AI Executive Summary\n\n`;
    if (ai.overallHealth) md += `${ai.overallHealth}\n\n`;
    if (ai.items && ai.items.length) {
      md += `| Issue | Root Cause | Suggested Fix |\n|---|---|---|\n`;
      for (const item of ai.items) {
        md += `| ${item.issue} | ${item.rootCause} | ${item.fix} |\n`;
      }
      md += `\n`;
    }
  }

  md += `## Issues\n\n| Severity | Type | URL | Detail |\n|---|---|---|---|\n`;
  for (const issue of sorted) {
    md += `| ${issue.severity} | ${issue.type} | ${truncate(issue.url, 60)} | ${issue.detail} |\n`;
  }

  if (competitors && competitors.length) {
    md += `\n## Competitor Comparison\n\n| Metric | ${targetUrl} | ${competitors.map(c => c.targetUrl).join(' | ')} |\n`;
    md += `|---|---|${competitors.map(() => '---').join('|')}|\n`;
    md += `| Performance score | ${performance?.details?.score ?? 'n/a'} | ${competitors.map(c => c.performance?.details?.score ?? 'n/a').join(' | ')} |\n`;
    md += `| Issues found | ${issues.length} | ${competitors.map(c => c.issues.length).join(' | ')} |\n`;
    md += `| Tech stack | ${techStack.join(', ') || 'n/a'} | ${competitors.map(c => c.techStack.join(', ') || 'n/a').join(' | ')} |\n`;
  }

  return md;
}

/**
 * Renders a fully self-contained, professional static HTML report — same
 * dark-themed visual language as the live dashboard, but with the data
 * embedded inline so the file works standalone (no server, works offline,
 * safe to email/share). Severity filtering runs client-side against the
 * embedded JSON; there's no Jira/push functionality here since that needs
 * a live server — `auditcli view` covers that.
 */
function generateHtmlReport(auditResult) {
  const data = slimForExport(auditResult);
  const dataJson = JSON.stringify(data).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>AuditCLI Report — ${escapeAttr(data.targetUrl)}</title>
<style>
${SHARED_STYLES}
  body { padding: 32px 36px; }
  .wrap { max-width: 1100px; margin: 0 auto; }
  .masthead { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 26px; flex-wrap: wrap; gap: 12px; }
  .masthead .brand { font-weight: 800; font-size: 15px; letter-spacing: 0.03em; color: var(--accent); text-transform: uppercase; }
  .masthead h2 { margin: 6px 0 4px; font-size: 28px; font-weight: 800; letter-spacing: -0.01em; word-break: break-all; }
  .masthead .meta { color: var(--muted); font-size: 13px; }
  .hero { background: var(--text); border-radius: 12px; text-align: center; padding: 26px 24px; margin-bottom: 24px; }
  .hero-mark { font-size: 17px; font-weight: 800; letter-spacing: 0.24em; text-transform: uppercase; color: #ffffff; }
  .hero-rule { width: 48px; height: 3px; background: var(--accent); margin: 12px auto 10px; }
  .hero-tag { color: #b8c2b8; font-size: 12px; letter-spacing: 0.04em; }
  .kb-badge { display: inline-block; background: var(--panel-2); color: var(--muted); border: 1px solid var(--border); border-radius: 4px; padding: 2px 8px; font-size: 10.5px; font-weight: 600; margin-top: 6px; letter-spacing: 0.02em; }
  .footer-note { color: var(--muted); font-size: 12px; text-align: center; margin: 30px 0 10px; }
  .footer-note code { background: var(--panel-2); padding: 2px 6px; border-radius: 4px; }
</style>
</head>
<body>
<div class="wrap">
  <div class="hero">
    <div class="hero-mark">AuditCLI</div>
    <div class="hero-rule"></div>
    <div class="hero-tag">Automated Website Health, Security &amp; Content Report</div>
  </div>
  <div class="masthead">
    <div>
      <div class="brand">AuditCLI Report</div>
      <h2 id="target-url"></h2>
      <div class="meta" id="meta-line"></div>
    </div>
  </div>

  <div class="cards" id="cards"></div>

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
        <p class="chart-sub" id="risk-sub">Weighted by finding severity (high=12, medium=4, low=1) — separate from performance.</p>
        <div id="chart-risk"></div>
      </div>
      <div class="chart-card" style="grid-column: 1 / -1;">
        <h4>Issues by severity</h4>
        <p class="chart-sub" id="severity-sub"></p>
        <div id="chart-severity"></div>
      </div>
      <div class="chart-card" style="grid-column: 1 / -1;">
        <h4>Top issue types</h4>
        <p class="chart-sub">Most frequent finding categories, highest first.</p>
        <div id="chart-types"></div>
      </div>
      <div id="chart-comp-score-card" class="chart-card" style="display:none;">
        <h4>Performance score by site</h4>
        <div id="chart-comp-score"></div>
      </div>
      <div id="chart-comp-issues-card" class="chart-card" style="display:none;">
        <h4>Issues found by site</h4>
        <div id="chart-comp-issues"></div>
      </div>
    </div>
  </div>

  <div class="panel">
    <h3>AI Root-Cause Analysis</h3>
    <p class="panel-caption">Root-cause analysis grounded via RAG retrieval (TF-IDF vector similarity) against a curated vulnerability knowledge base.</p>
    <div id="chart-kb-coverage" style="max-width:400px; margin-bottom:16px;"></div>
    <div class="ai-summary" id="ai-summary"></div>
  </div>

  <div class="panel">
    <h3>Issues</h3>
    <div class="filters" id="filters"></div>
    <div style="max-height:600px; overflow:auto;">
      <table>
        <thead><tr><th>Severity</th><th>Type</th><th>URL</th><th>Detail</th></tr></thead>
        <tbody id="issues-body"></tbody>
      </table>
    </div>
  </div>

  <div class="panel">
    <h3>Per-page breakdown</h3>
    <p class="panel-caption">Issues attributed to the specific page they were found on.</p>
    <div id="page-breakdown"></div>
  </div>

  <div id="competitors-panel"></div>

  <div class="panel">
    <h3>Tech stack & security posture</h3>
    <p style="font-size:13px; color:var(--muted); margin:0 0 10px;" id="tech-line"></p>
    <p style="font-size:13px; color:var(--muted); margin:0;" id="tls-line"></p>
  </div>

  <div class="footer-note">Generated by AuditCLI. Run <code>auditcli view</code> for the live interactive dashboard with one-click Jira filing.</div>
</div>

<script>
${CHART_KIT_JS}

const report = ${dataJson};
let filter = 'all';

function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function hostOf(url) { try { return new URL(url).hostname; } catch(_) { return url; } }
function scoreClass(score) { if (typeof score !== 'number') return ''; return score >= 80 ? 'low' : score >= 50 ? 'medium' : 'high'; }
function severityCounts(issues) { return issues.reduce((acc, i) => { acc[i.severity] = (acc[i.severity]||0)+1; return acc; }, { high:0, medium:0, low:0 }); }

function renderHeader() {
  document.getElementById('target-url').textContent = report.targetUrl;
  document.getElementById('meta-line').textContent = \`Scanned \${new Date(report.timestamp).toLocaleString()} · \${report.pagesCrawled} pages · \${report.assetsFound} assets\`;
}

function renderCards() {
  const counts = severityCounts(report.issues);
  document.getElementById('cards').innerHTML = \`
    <div class="card"><div class="label">Total issues</div><div class="value">\${report.issues.length}</div></div>
    <div class="card"><div class="label">High</div><div class="value high">\${counts.high||0}</div></div>
    <div class="card"><div class="label">Medium</div><div class="value medium">\${counts.medium||0}</div></div>
    <div class="card"><div class="label">Low</div><div class="value low">\${counts.low||0}</div></div>
    <div class="card"><div class="label">Performance</div><div class="value \${scoreClass(report.performance?.details?.score)}">\${report.performance?.details?.score ?? 'n/a'}</div></div>
    <div class="card"><div class="label">Risk score</div><div class="value \${scoreClass(report.riskScore)}">\${report.riskScore ?? 'n/a'}</div></div>
  \`;
}

function renderAiSummary() {
  const ai = report.aiSummary;
  const el = document.getElementById('ai-summary');
  if (!ai) { el.innerHTML = '<span class="muted">Run the scan with --ai to generate an executive summary.</span>'; return; }
  if (!ai.ok) { el.innerHTML = \`<span class="muted">AI summary unavailable (\${escapeHtml(ai.reason || 'unknown error')}).</span>\`; return; }
  const health = ai.overallHealth ? \`<p class="health-callout">\${escapeHtml(ai.overallHealth)}</p>\` : '';
  const rows = (ai.items || []).map(it => \`<tr>
    <td style="font-weight:600; white-space:nowrap;">\${escapeHtml(it.issue)}</td>
    <td>\${escapeHtml(it.rootCause)}\${it.source ? \`<div><span class="kb-badge">\${escapeHtml(it.source)}</span></div>\` : ''}</td>
    <td>\${escapeHtml(it.fix)}</td>
  </tr>\`).join('');
  const table = rows ? \`<table><thead><tr><th>Issue</th><th>Root Cause</th><th>Suggested Fix</th></tr></thead><tbody>\${rows}</tbody></table>\` : '';
  el.innerHTML = health + table;
}

function renderFilters() {
  document.getElementById('filters').innerHTML = ['all','high','medium','low'].map(f =>
    \`<button data-filter="\${f}" class="\${filter===f?'active':''}">\${f}</button>\`
  ).join('');
  document.querySelectorAll('.filters button').forEach(b => b.onclick = () => { filter = b.dataset.filter; renderFilters(); renderIssues(); });
}

function renderIssues() {
  const filtered = filter === 'all' ? report.issues : report.issues.filter(i => i.severity === filter);
  const sorted = [...filtered].sort((a,b) => ({high:0,medium:1,low:2}[a.severity]??3) - ({high:0,medium:1,low:2}[b.severity]??3));
  const body = document.getElementById('issues-body');
  if (!sorted.length) { body.innerHTML = '<tr><td colspan="4" class="empty">No issues in this category.</td></tr>'; return; }
  body.innerHTML = sorted.map(issue => \`<tr>
    <td><span class="badge \${issue.severity}">\${issue.severity}</span></td>
    <td>\${escapeHtml(issue.type)}</td>
    <td class="url-cell" title="\${escapeHtml(issue.url||'')}">\${escapeHtml(issue.url||'—')}</td>
    <td>\${escapeHtml(issue.detail)}</td>
  </tr>\`).join('');
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

function renderPageBreakdown() {
  const pages = pageBreakdown(report.issues);
  const el = document.getElementById('page-breakdown');
  if (!pages.length) { el.innerHTML = '<div class="chart-empty">No issues to break down.</div>'; return; }
  const shown = pages.slice(0, 20);
  const rows = shown.map(p => \`<tr>
    <td class="url-cell" title="\${escapeHtml(p.url)}">\${escapeHtml(p.url)}</td>
    <td>\${p.high ? \`<span class="badge high">\${p.high} high</span>\` : ''}</td>
    <td>\${p.medium ? \`<span class="badge medium">\${p.medium} medium</span>\` : ''}</td>
    <td>\${p.low ? \`<span class="badge low">\${p.low} low</span>\` : ''}</td>
    <td style="font-weight:700;">\${p.total}</td>
  </tr>\`).join('');
  const more = pages.length > shown.length ? \`<p class="chart-sub" style="margin-top:10px;">…and \${pages.length - shown.length} more page(s), see the JSON report for all.</p>\` : '';
  el.innerHTML = \`<table><thead><tr><th>Page</th><th>High</th><th>Medium</th><th>Low</th><th>Total</th></tr></thead><tbody>\${rows}</tbody></table>\${more}\`;
}

function renderCompetitors() {
  const competitors = report.competitors;
  const panel = document.getElementById('competitors-panel');
  if (!competitors || !competitors.length) { panel.innerHTML = ''; return; }
  const cols = [report, ...competitors];
  const row = (label, fn) => \`<tr><td>\${label}</td>\${cols.map(c => \`<td>\${fn(c)}</td>\`).join('')}</tr>\`;
  panel.innerHTML = \`
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

function renderTechSecurity() {
  document.getElementById('tech-line').textContent = 'Tech: ' + ((report.techStack||[]).join(', ') || 'none detected');
  const tls = report.security?.tls;
  document.getElementById('tls-line').textContent = 'TLS: ' + (tls ? \`\${tls.protocol}, expires \${tls.validTo ? new Date(tls.validTo).toDateString() : 'n/a'}\` : 'n/a (not HTTPS or unreachable)');
}

function typeCounts(issues) {
  const map = new Map();
  issues.forEach(i => map.set(i.type, (map.get(i.type) || 0) + 1));
  return [...map.entries()].map(([label, value]) => ({ label, value }));
}

function drawCharts() {
  const counts = severityCounts(report.issues);
  document.getElementById('severity-sub').textContent = \`\${report.issues.length} total issue\${report.issues.length === 1 ? '' : 's'} found across the crawl.\`;
  if (report.peerStats) {
    const p = report.peerStats;
    const direction = p.issueCountVsPeerAvg > 0 ? 'more' : 'fewer';
    const flag = p.isIssueOutlier ? ' — statistical outlier' : '';
    document.getElementById('risk-sub').textContent += \` \${Math.abs(p.issueCountVsPeerAvg)}% \${direction} issues than your \${p.peerCount}-competitor peer average\${flag}.\`;
  }
  renderMeter('chart-meter', { value: report.performance?.details?.score ?? 0, max: 100, label: hostOf(report.targetUrl) });
  renderMeter('chart-risk', { value: report.riskScore ?? 0, max: 100, label: hostOf(report.targetUrl) });
  renderSeverityBar('chart-severity', counts);
  renderBarChart('chart-types', typeCounts(report.issues));
  if (report.aiSummary && report.aiSummary.ok && report.aiSummary.items) {
    const grounded = report.aiSummary.items.filter(it => it.source).length;
    renderMeter('chart-kb-coverage', { value: grounded, max: report.aiSummary.items.length, label: 'Knowledge base coverage' });
  }
  if (report.competitors && report.competitors.length) {
    document.getElementById('chart-comp-score-card').style.display = '';
    document.getElementById('chart-comp-issues-card').style.display = '';
    const sites = [report, ...report.competitors];
    renderEntityBarChart('chart-comp-score', sites.map(s => ({ label: hostOf(s.targetUrl), value: s.performance?.details?.score ?? 0 })));
    renderEntityBarChart('chart-comp-issues', sites.map(s => ({ label: hostOf(s.targetUrl), value: s.issues.length })));
  }
}

renderHeader();
renderCards();
drawCharts();
renderAiSummary();
renderFilters();
renderIssues();
renderPageBreakdown();
renderCompetitors();
renderTechSecurity();
</script>
</body>
</html>`;
}

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len - 1) + '…' : str;
}
function escapeAttr(str) {
  return (str || '').replace(/"/g, '&quot;');
}

function safeHostName(targetUrl) {
  return new URL(targetUrl).hostname.replace(/[^a-z0-9.-]/gi, '_');
}

/**
 * Saves the audit result. The JSON snapshot is always written — it's what
 * powers the live dashboard (`auditcli view` / the "Push to Jira" flow) and
 * is not a "report file" in the deliverable sense. No .html file is ever
 * written to disk: the HTML template exists only in memory, either to
 * render the live dashboard in a browser (unavoidable — that's just how a
 * browser renders anything) or as an intermediate step when rendering a
 * PDF (see lib/pdf.js). `format` is opt-in for an actual deliverable file:
 * 'pdf' or 'md'. Pass no format (or 'none') to only write the JSON.
 */
async function saveReport(auditResult, outDir, format = 'none') {
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const safeName = safeHostName(auditResult.targetUrl);

  let filePath = null;
  if (format === 'md') {
    filePath = path.join(outDir, `audit-${safeName}.md`);
    fs.writeFileSync(filePath, generateMarkdownReport(auditResult), 'utf8');
  } else if (format === 'pdf') {
    const { renderHtmlToPdf } = require('./pdf');
    filePath = path.join(outDir, `audit-${safeName}.pdf`);
    await renderHtmlToPdf(generateHtmlReport(auditResult), filePath);
  }

  saveJsonReport(auditResult, outDir);
  return filePath;
}

/**
 * Saves the full structured result as JSON so the local web dashboard
 * (`auditcli view`) can load it without re-running the audit. Strips the
 * raw crawled HTML (only needed transiently for competitor-seed extraction)
 * to keep report files small.
 */
function saveJsonReport(auditResult, outDir) {
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const safeName = safeHostName(auditResult.targetUrl);
  const filePath = path.join(outDir, `audit-${safeName}.json`);
  const slim = slimForExport(auditResult);
  fs.writeFileSync(filePath, JSON.stringify(slim, null, 2), 'utf8');

  updateManifest(outDir, { host: safeName, targetUrl: auditResult.targetUrl, timestamp: auditResult.timestamp });
  return filePath;
}

function updateManifest(outDir, entry) {
  const manifestPath = path.join(outDir, 'manifest.json');
  let manifest = [];
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (_) { /* no manifest yet */ }
  manifest = manifest.filter((m) => m.host !== entry.host);
  manifest.unshift(entry);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest.slice(0, 50), null, 2), 'utf8');
}

function listReports(outDir) {
  const manifestPath = path.join(outDir, 'manifest.json');
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (_) {
    return [];
  }
}

function loadJsonReport(outDir, host) {
  const filePath = path.join(outDir, `audit-${host}.json`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

module.exports = {
  generateMarkdownReport,
  generateHtmlReport,
  saveReport,
  saveJsonReport,
  listReports,
  loadJsonReport,
  safeHostName,
};
