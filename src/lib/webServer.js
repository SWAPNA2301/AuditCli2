const express = require('express');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

const { listReports, loadJsonReport, safeHostName, generateHtmlReport } = require('./report');
const { jiraConfigFromEnv, fileIssuesToJira, createJiraIssue, resolveActiveSprintId } = require('./jira');
const { slackConfigFromEnv, postIssueToSlack, postSummaryToSlack } = require('./slack');
const { renderDashboardHtml } = require('./dashboardTemplate');
const { renderHtmlToPdf } = require('./pdf');
const { generateIssueSuggestion } = require('./ai');
const { computeRiskScore } = require('./riskScore');

const VALID_SEVERITIES = new Set(['high', 'medium', 'low']);

function validateIssuePayload(body) {
  const severity = String(body?.severity || '').toLowerCase();
  const type = String(body?.type || '').trim();
  const detail = String(body?.detail || '').trim();
  const url = String(body?.url || '').trim();
  if (!VALID_SEVERITIES.has(severity)) return { error: 'severity must be high, medium, or low' };
  if (!type || type.length > 60) return { error: 'type is required (max 60 characters)' };
  if (!detail || detail.length < 8 || detail.length > 600) return { error: 'detail must be 8-600 characters' };
  if (url.length > 2000) return { error: 'url is too long' };
  return { issue: { severity, type, url, detail } };
}

function saveJsonReportRaw(outDir, host, report) {
  const filePath = path.join(outDir, `audit-${host}.json`);
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf8');
}

function createApp(outDir) {
  const app = express();
  app.use(express.json());

  app.get('/api/reports', (req, res) => {
    res.json(listReports(outDir));
  });

  app.get('/api/report/:host', (req, res) => {
    try {
      const report = loadJsonReport(outDir, req.params.host);
      res.json(report);
    } catch (_) {
      res.status(404).json({ error: 'not found' });
    }
  });

  app.get('/api/jira/status', (req, res) => {
    res.json({ configured: !!jiraConfigFromEnv() });
  });

  app.post('/api/jira/push', async (req, res) => {
    const config = jiraConfigFromEnv();
    if (!config) return res.status(400).json({ ok: false, error: 'Jira not configured in .env' });
    const { host, issueIndex } = req.body || {};
    try {
      const report = loadJsonReport(outDir, host);
      const issue = report.issues[issueIndex];
      if (!issue) return res.status(404).json({ ok: false, error: 'issue not found' });
      if (issue.jiraKey) return res.json({ ok: true, key: issue.jiraKey, alreadyExists: true });

      const sprintId = await resolveActiveSprintId(config);
      const result = await createJiraIssue(config, issue, sprintId);
      if (!result.ok) return res.status(502).json({ ok: false, error: result.error });

      report.issues[issueIndex].jiraKey = result.key;
      saveJsonReportRaw(outDir, host, report);
      res.json({ ok: true, key: result.key });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/jira/push-all', async (req, res) => {
    const config = jiraConfigFromEnv();
    if (!config) return res.status(400).json({ ok: false, error: 'Jira not configured in .env' });
    const { host } = req.body || {};
    try {
      const report = loadJsonReport(outDir, host);
      const pending = report.issues.map((issue, index) => ({ issue, index })).filter((x) => !x.issue.jiraKey);
      const results = await fileIssuesToJira(config, pending.map((p) => p.issue));

      const created = [];
      results.forEach((r, i) => {
        if (r.ok) {
          const index = pending[i].index;
          report.issues[index].jiraKey = r.key;
          created.push({ index, key: r.key });
        }
      });
      saveJsonReportRaw(outDir, host, report);
      res.json({ ok: true, created, total: report.issues.length });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/slack/status', (req, res) => {
    res.json({ configured: !!slackConfigFromEnv() });
  });

  // Posts one issue as a focused Slack message.
  app.post('/api/slack/push', async (req, res) => {
    const config = slackConfigFromEnv();
    if (!config) return res.status(400).json({ ok: false, error: 'Slack not configured in .env' });
    const { host, issueIndex } = req.body || {};
    try {
      const report = loadJsonReport(outDir, host);
      const issue = report.issues[issueIndex];
      if (!issue) return res.status(404).json({ ok: false, error: 'issue not found' });

      const result = await postIssueToSlack(config, issue, report.targetUrl);
      if (!result.ok) return res.status(502).json({ ok: false, error: result.error });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Posts ONE consolidated summary message for the whole report — see
  // lib/slack.js for why this is a single digest rather than one message
  // per finding.
  app.post('/api/slack/push-summary', async (req, res) => {
    const config = slackConfigFromEnv();
    if (!config) return res.status(400).json({ ok: false, error: 'Slack not configured in .env' });
    const { host } = req.body || {};
    try {
      const report = loadJsonReport(outDir, host);
      const result = await postSummaryToSlack(config, report);
      if (!result.ok) return res.status(502).json({ ok: false, error: result.error });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Manually add a new issue to a saved report — e.g. something the operator
  // spotted that the automated checks don't cover. Re-derives the risk score
  // so the KPI cards stay consistent with the edited issue list.
  app.post('/api/report/:host/issues', (req, res) => {
    const { issue, error } = validateIssuePayload(req.body);
    if (error) return res.status(400).json({ ok: false, error });
    try {
      const report = loadJsonReport(outDir, req.params.host);
      report.issues.push(issue);
      report.riskScore = computeRiskScore(report.issues);
      saveJsonReportRaw(outDir, req.params.host, report);
      res.json({ ok: true, index: report.issues.length - 1, issue, riskScore: report.riskScore });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Edit an existing issue in place (severity/type/url/detail only — jiraKey
  // and any prior AI suggestion are preserved as-is; ask again via /suggest
  // if the edit changes what the finding actually is).
  app.put('/api/report/:host/issues/:index', (req, res) => {
    const { issue, error } = validateIssuePayload(req.body);
    if (error) return res.status(400).json({ ok: false, error });
    try {
      const report = loadJsonReport(outDir, req.params.host);
      const idx = Number(req.params.index);
      const existing = report.issues[idx];
      if (!existing) return res.status(404).json({ ok: false, error: 'issue not found' });
      report.issues[idx] = { ...existing, ...issue };
      report.riskScore = computeRiskScore(report.issues);
      saveJsonReportRaw(outDir, req.params.host, report);
      res.json({ ok: true, issue: report.issues[idx], riskScore: report.riskScore });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // AI root-cause/fix suggestion for one issue (manually added or edited).
  // Guardrailed in lib/ai.js: the issue text is treated strictly as data to
  // analyze, never as instructions, and the model is told to refuse anything
  // that isn't a plausible real finding.
  app.post('/api/report/:host/issues/:index/suggest', async (req, res) => {
    try {
      const report = loadJsonReport(outDir, req.params.host);
      const idx = Number(req.params.index);
      const issue = report.issues[idx];
      if (!issue) return res.status(404).json({ ok: false, error: 'issue not found' });

      const suggestion = await generateIssueSuggestion(issue, { targetUrl: report.targetUrl });
      if (!suggestion.ok) return res.status(422).json({ ok: false, error: suggestion.error || suggestion.reason });

      report.issues[idx].aiSuggestion = {
        rootCause: suggestion.rootCause,
        fix: suggestion.fix,
        source: suggestion.source,
        model: suggestion.model,
      };
      saveJsonReportRaw(outDir, req.params.host, report);
      res.json({ ok: true, suggestion: report.issues[idx].aiSuggestion });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // On-demand PDF export — the dashboard's "Download PDF" button hits this
  // rather than the CLI writing a .html/.pdf file to disk on every scan.
  app.get('/api/report/:host/pdf', async (req, res) => {
    try {
      const report = loadJsonReport(outDir, req.params.host);
      const tmpPath = path.join(outDir, `.tmp-${req.params.host}-${Date.now()}.pdf`);
      await renderHtmlToPdf(generateHtmlReport(report), tmpPath);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="audit-${req.params.host}.pdf"`);
      const stream = fs.createReadStream(tmpPath);
      stream.pipe(res);
      stream.on('close', () => fs.unlink(tmpPath, () => {}));
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/', (req, res) => {
    res.send(renderDashboardHtml());
  });

  return app;
}

function openInBrowser(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

/**
 * Starts the local dashboard server. Tries the configured port, then a
 * handful of fallbacks if it's busy (e.g. a previous instance still running).
 */
function startDashboard(outDir, { port = 4545, host: initialHost, autoOpen = true } = {}) {
  const app = createApp(outDir);
  return new Promise((resolve, reject) => {
    const tryListen = (p, attemptsLeft) => {
      const server = app.listen(p, () => {
        const url = `http://localhost:${p}/${initialHost ? `?host=${encodeURIComponent(initialHost)}` : ''}`;
        if (autoOpen) openInBrowser(url);
        resolve({ server, url, port: p });
      });
      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
          tryListen(p + 1, attemptsLeft - 1);
        } else {
          reject(err);
        }
      });
    };
    tryListen(port, 5);
  });
}

module.exports = { startDashboard, createApp };
