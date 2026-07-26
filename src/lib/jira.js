const axios = require('axios');

/**
 * Creates a Jira issue for each audit finding.
 * Requires JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY in env (.env file).
 * Get a free API token at: https://id.atlassian.com/manage-profile/security/api-tokens
 */
function jiraConfigFromEnv() {
  const { JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY, JIRA_ISSUE_TYPE } = process.env;
  if (!JIRA_BASE_URL || !JIRA_EMAIL || !JIRA_API_TOKEN || !JIRA_PROJECT_KEY) {
    return null;
  }
  return {
    baseUrl: JIRA_BASE_URL.replace(/\/$/, ''),
    email: JIRA_EMAIL,
    token: JIRA_API_TOKEN,
    projectKey: JIRA_PROJECT_KEY,
    issueType: JIRA_ISSUE_TYPE || 'Bug',
  };
}

function authHeader(config) {
  return `Basic ${Buffer.from(`${config.email}:${config.token}`).toString('base64')}`;
}

function severityToPriority(severity) {
  switch (severity) {
    case 'high': return 'High';
    case 'medium': return 'Medium';
    default: return 'Low';
  }
}

/**
 * A Scrum board only ever shows issues assigned to its ACTIVE sprint —
 * anything created without one lands in the Backlog instead, invisible on
 * the board even though creation succeeded. This looks up the project's
 * board and, if it's a Scrum board with a running sprint, returns that
 * sprint's id so newly filed issues can be dropped straight onto the board.
 * Kanban boards need no such assignment (issues show up by status alone),
 * so this returns null for those — same as when there's no active sprint.
 */
async function resolveActiveSprintId(config) {
  try {
    const headers = { Authorization: authHeader(config) };
    const boards = await axios.get(`${config.baseUrl}/rest/agile/1.0/board`, {
      headers,
      params: { projectKeyOrId: config.projectKey },
      validateStatus: () => true,
    });
    const board = boards.data?.values?.[0];
    if (!board) return null;

    // Don't gate on board.type: team-managed Scrum boards report as
    // "simple" here, not "scrum" — the reliable signal is just whether an
    // active sprint actually exists. A true Kanban board has none, so this
    // request comes back empty and we correctly return null either way.
    const sprints = await axios.get(`${config.baseUrl}/rest/agile/1.0/board/${board.id}/sprint`, {
      headers,
      params: { state: 'active' },
      validateStatus: () => true,
    });
    return sprints.data?.values?.[0]?.id ?? null;
  } catch (_) {
    return null; // best-effort — issue creation still succeeds, just lands in the backlog
  }
}

async function addIssueToSprint(config, sprintId, issueKey) {
  try {
    await axios.post(
      `${config.baseUrl}/rest/agile/1.0/sprint/${sprintId}/issue`,
      { issues: [issueKey] },
      { headers: { Authorization: authHeader(config), 'Content-Type': 'application/json' }, validateStatus: () => true }
    );
  } catch (_) {
    /* non-fatal — the issue still exists in the backlog */
  }
}

function humanize(str) {
  return String(str || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// Groups every check type this tool produces into a broad category, so
// tickets can be filtered/grouped on the board by area (security vs. SEO
// vs. performance vs. content) without reading each summary individually.
const CATEGORY_BY_TYPE = {
  security: [
    'security-header', 'cookie-flags', 'no-https', 'weak-tls-version', 'invalid-tls-certificate',
    'expired-tls-certificate', 'tls-certificate-expiring-soon', 'tls-connection-failed',
    'exposed-sensitive-file', 'vulnerable-js-library', 'missing-spf-record', 'missing-dmarc-record',
    'missing-caa-record', 'domain-expiring-soon', 'domain-expired', 'possible-bot-protection',
    'access-restricted-link',
  ],
  seo: ['seo-missing-title', 'seo-missing-meta-description', 'seo-missing-h1', 'seo-multiple-h1', 'seo-missing-viewport', 'seo-duplicate-title'],
  performance: ['slow-load-time', 'large-html-payload', 'high-image-count'],
  content: ['broken-link', 'broken-asset', 'missing-alt-text'],
};

function categoryForType(type) {
  for (const [category, types] of Object.entries(CATEGORY_BY_TYPE)) {
    if (types.includes(type)) return category;
  }
  return 'general';
}

function labelsForIssue(issue) {
  const typeSlug = String(issue.type || 'general').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return ['auditcli', `severity-${issue.severity}`, `category-${categoryForType(issue.type)}`, `type-${typeSlug}`];
}

// Bold-label bullet list of only the fields that actually have a value,
// followed by a subtle info panel crediting AuditCLI instead of a bare
// trailing text line. No URL field — the labels (severity/category/type)
// carry the useful metadata, and the URL/foundOn duplicated the ticket's
// own context without adding anything scannable on the board.
function buildIssueDescription(issue) {
  const content = [
    { type: 'paragraph', content: [{ type: 'text', text: issue.detail }] },
  ];

  const fields = [['Severity', humanize(issue.severity)], ['Category', humanize(categoryForType(issue.type))]];

  content.push({
    type: 'bulletList',
    content: fields.map(([label, value]) => ({
      type: 'listItem',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: `${label}: `, marks: [{ type: 'strong' }] },
          { type: 'text', text: value },
        ],
      }],
    })),
  });

  content.push({
    type: 'panel',
    attrs: { panelType: 'info' },
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Automatically detected and filed by AuditCLI.' }] }],
  });

  return { type: 'doc', version: 1, content };
}

async function createJiraIssue(config, issue, sprintId) {
  const summary = `[AuditCLI] ${humanize(issue.type)}: ${truncate(issue.detail, 100)}`;

  const body = {
    fields: {
      project: { key: config.projectKey },
      summary,
      description: buildIssueDescription(issue),
      issuetype: { name: config.issueType },
      labels: labelsForIssue(issue),
    },
  };

  try {
    const res = await axios.post(`${config.baseUrl}/rest/api/3/issue`, body, {
      headers: {
        Authorization: authHeader(config),
        'Content-Type': 'application/json',
      },
    });
    if (sprintId) await addIssueToSprint(config, sprintId, res.data.key);
    return { ok: true, key: res.data.key, issue };
  } catch (err) {
    return {
      ok: false,
      error: err.response ? JSON.stringify(err.response.data) : err.message,
      issue,
    };
  }
}

async function fileIssuesToJira(config, issues, { concurrency = 3 } = {}) {
  const sprintId = await resolveActiveSprintId(config);
  const results = [];
  let idx = 0;
  async function worker() {
    while (idx < issues.length) {
      const issue = issues[idx++];
      results.push(await createJiraIssue(config, issue, sprintId));
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len - 1) + '…' : str;
}

module.exports = { jiraConfigFromEnv, fileIssuesToJira, createJiraIssue, resolveActiveSprintId, severityToPriority };
