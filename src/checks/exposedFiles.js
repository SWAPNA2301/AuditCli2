const { fetchUrl } = require('../lib/crawler');

/**
 * Passively checks whether common sensitive files/paths are publicly reachable
 * on the target origin. Every request is a plain GET to a fixed, well-known
 * path (the same requests a browser makes when you type the URL) — no
 * fuzzing, no auth bypass attempts, no payloads.
 */
const SENSITIVE_PATHS = [
  { path: '/.env', severity: 'high', label: 'Environment file (.env)' },
  { path: '/.git/config', severity: 'high', label: 'Exposed .git directory' },
  { path: '/.git/HEAD', severity: 'high', label: 'Exposed .git directory' },
  { path: '/wp-config.php.bak', severity: 'high', label: 'WordPress config backup' },
  { path: '/config.php.bak', severity: 'high', label: 'Config backup file' },
  { path: '/.aws/credentials', severity: 'high', label: 'AWS credentials file' },
  { path: '/backup.sql', severity: 'high', label: 'Database backup dump' },
  { path: '/database.sql', severity: 'high', label: 'Database dump' },
  { path: '/.DS_Store', severity: 'low', label: 'macOS .DS_Store metadata file' },
  { path: '/server-status', severity: 'medium', label: 'Apache mod_status page' },
  { path: '/phpinfo.php', severity: 'medium', label: 'phpinfo() debug page' },
  { path: '/.well-known/security.txt', severity: 'info', label: 'security.txt (informational, not an issue)' },
];

function looksLikeRealFile(res, path) {
  if (!res.ok || !res.status || res.status >= 400) return false;
  // many sites soft-404 to a 200 HTML page for any path; require the body to
  // not look like a normal HTML page, unless it's a directory listing.
  if (path.endsWith('.php') || path.endsWith('.sql') || path === '/.env' || path.includes('.git')) {
    const html = (res.html || '').trim().toLowerCase();
    if (html.startsWith('<!doctype html') || html.startsWith('<html')) return false;
  }
  return true;
}

async function checkExposedFiles(targetUrl, { concurrency = 5 } = {}) {
  const issues = [];
  let origin;
  try {
    origin = new URL(targetUrl).origin;
  } catch (_) {
    return issues;
  }

  const candidates = SENSITIVE_PATHS.filter((p) => p.severity !== 'info');
  let idx = 0;
  async function worker() {
    while (idx < candidates.length) {
      const item = candidates[idx++];
      const res = await fetchUrl(origin + item.path, { method: 'get', timeout: 5000 });
      if (looksLikeRealFile(res, item.path)) {
        issues.push({
          severity: item.severity,
          type: 'exposed-sensitive-file',
          url: origin + item.path,
          detail: `${item.label} appears to be publicly accessible (HTTP ${res.status}).`,
        });
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return issues;
}

module.exports = { checkExposedFiles };
