const axios = require('axios');

const SLACK_API = 'https://slack.com/api';

function slackConfigFromEnv() {
  const { SLACK_BOT_TOKEN, SLACK_CHANNEL_ID } = process.env;
  if (!SLACK_BOT_TOKEN || !SLACK_CHANNEL_ID) return null;
  return { token: SLACK_BOT_TOKEN, channel: SLACK_CHANNEL_ID };
}

const SEVERITY_EMOJI = { high: '🔴', medium: '🟠', low: '🟢' };

function humanize(str) {
  return String(str || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch (_) { return url; }
}

async function postToSlack(config, blocks, fallbackText) {
  try {
    const res = await axios.post(
      `${SLACK_API}/chat.postMessage`,
      { channel: config.channel, text: fallbackText, blocks },
      { headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json; charset=utf-8' }, validateStatus: () => true }
    );
    if (res.data?.ok) return { ok: true, ts: res.data.ts, channel: res.data.channel };
    return { ok: false, error: mapSlackError(res.data?.error) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function mapSlackError(code) {
  const known = {
    not_in_channel: 'The AuditCLI bot has not been added to this Slack channel yet. Open the channel → channel name → Integrations → Add an App → AuditCli.',
    channel_not_found: 'SLACK_CHANNEL_ID does not match a real channel the bot can see.',
    invalid_auth: 'SLACK_BOT_TOKEN is invalid or was revoked — generate a new one from OAuth & Permissions.',
    missing_scope: 'The Slack app is missing the chat:write scope. Add it under OAuth & Permissions and reinstall the app.',
  };
  return known[code] || code || 'unknown Slack error';
}

/**
 * Posts one finding as a focused Slack message — used by the dashboard's
 * per-issue "Push to Slack" button and CLI single-issue pushes.
 */
async function postIssueToSlack(config, issue, targetUrl) {
  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${SEVERITY_EMOJI[issue.severity] || '⚪'} *${humanize(issue.severity)} severity — ${humanize(issue.type)}*` +
          (targetUrl ? `\n_${hostOf(targetUrl)}_` : ''),
      },
    },
    { type: 'section', text: { type: 'mrkdwn', text: issue.detail } },
  ];

  if (issue.aiSuggestion) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Root cause:* ${issue.aiSuggestion.rootCause}\n*Suggested fix:* ${issue.aiSuggestion.fix}` },
    });
  }
  if (issue.url) {
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `<${issue.url}|${issue.url}>` }] });
  }
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: 'Filed by AuditCLI' }] });

  const fallbackText = `[${humanize(issue.severity)}] ${humanize(issue.type)}: ${issue.detail}`;
  return postToSlack(config, blocks, fallbackText);
}

/**
 * Posts ONE consolidated summary message for a full scan, rather than one
 * message per finding — dumping dozens of separate messages into a channel
 * for a single "push all" action would be noisy and against normal Slack
 * etiquette. Mirrors the shape of the AI executive summary: counts, risk
 * score, and the top few highest-severity findings.
 */
async function postSummaryToSlack(config, auditResult) {
  const counts = { high: 0, medium: 0, low: 0 };
  for (const i of auditResult.issues) counts[i.severity] = (counts[i.severity] || 0) + 1;

  const topIssues = [...auditResult.issues]
    .sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.severity] ?? 3) - ({ high: 0, medium: 1, low: 2 }[b.severity] ?? 3))
    .slice(0, 8);

  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `AuditCLI report — ${hostOf(auditResult.targetUrl)}` } },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Performance:* ${auditResult.performance?.details?.score ?? 'n/a'}/100` },
        { type: 'mrkdwn', text: `*Risk score:* ${auditResult.riskScore ?? 'n/a'}/100` },
        { type: 'mrkdwn', text: `🔴 High: ${counts.high}   🟠 Medium: ${counts.medium}   🟢 Low: ${counts.low}` },
        { type: 'mrkdwn', text: `*Total issues:* ${auditResult.issues.length}` },
      ],
    },
    { type: 'divider' },
  ];

  if (auditResult.aiSummary?.overallHealth) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `_${auditResult.aiSummary.overallHealth}_` } });
  }

  for (const issue of topIssues) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `${SEVERITY_EMOJI[issue.severity] || '⚪'} *${humanize(issue.type)}* — ${issue.detail}` },
    });
  }
  if (auditResult.issues.length > topIssues.length) {
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `…and ${auditResult.issues.length - topIssues.length} more. Full report: run \`auditcli view\`.` }] });
  }
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `Filed by AuditCLI · ${new Date(auditResult.timestamp).toLocaleString()}` }] });

  const fallbackText = `AuditCLI report for ${hostOf(auditResult.targetUrl)}: ${auditResult.issues.length} issues (${counts.high} high, ${counts.medium} medium, ${counts.low} low)`;
  return postToSlack(config, blocks, fallbackText);
}

module.exports = { slackConfigFromEnv, postIssueToSlack, postSummaryToSlack };
