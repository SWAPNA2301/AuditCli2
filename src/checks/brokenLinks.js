const { fetchUrl } = require('../lib/crawler');
const { isTrackingOrAnalyticsUrl } = require('../lib/noise');

// Status codes that don't necessarily mean the link is broken — they're
// frequently a site's bot/rate-limit protection reacting to automated
// requests (no session cookies, no browser fingerprint), or a page that
// legitimately requires authentication. Treating these the same as a
// genuine 404 produces misleading "broken link" spam on protected sites.
const SOFT_FAIL_CODES = new Set([401, 403, 429, 503]);

function classify(item, res) {
  const status = res.status;
  if (!res.ok || !status) {
    return { severity: 'medium', type: item.type === 'link' ? 'broken-link' : 'broken-asset', detail: `Request failed: ${res.error}` };
  }
  if (SOFT_FAIL_CODES.has(status)) {
    const label = { 401: 'requires authentication', 403: 'access forbidden', 429: 'rate-limited', 503: 'service unavailable' }[status];
    return {
      severity: 'low',
      type: 'access-restricted-link',
      detail: `HTTP ${status} (${label}) — this often means the page requires a logged-in session or the site is throttling automated requests, not that the link is genuinely broken. Verify manually.`,
    };
  }
  return {
    severity: status === 404 ? 'high' : 'medium',
    type: item.type === 'link' ? 'broken-link' : 'broken-asset',
    detail: `HTTP ${status}`,
  };
}

/**
 * Given crawl results, verifies status of every unique asset & link.
 * Returns a list of issues: { severity, type, url, foundOn, detail }
 */
async function checkBrokenLinksAndAssets(crawlResult, { concurrency = 6 } = {}) {
  const issues = [];
  let softFailCount = 0;
  let checkedCount = 0;
  const targets = dedupe([
    ...crawlResult.assets.map(a => ({ url: a.url, type: a.type, foundOn: a.foundOn })),
    ...crawlResult.links.map(l => ({ url: l.url, type: 'link', foundOn: l.foundOn })),
  ]).filter(t => !isTrackingOrAnalyticsUrl(t.url));

  // simple concurrency pool
  let idx = 0;
  async function worker() {
    while (idx < targets.length) {
      const item = targets[idx++];
      if (!item.url) continue;
      const res = await fetchUrl(item.url, { method: item.type === 'link' ? 'get' : 'head' });
      checkedCount++;
      if (!res.ok || (res.status && res.status >= 400)) {
        const classified = classify(item, res);
        if (classified.type === 'access-restricted-link') softFailCount++;
        issues.push({ severity: classified.severity, type: classified.type, url: item.url, foundOn: item.foundOn, detail: classified.detail });
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));

  // If a large chunk of everything we checked came back 401/403/429/503,
  // that's a strong signal the target's bot protection kicked in mid-crawl
  // rather than that we found dozens of independently broken links —
  // collapse the noise into one clear warning instead of a wall of "low"
  // findings that all share the same root cause.
  if (checkedCount >= 10 && softFailCount / checkedCount > 0.15) {
    const filtered = issues.filter((i) => i.type !== 'access-restricted-link');
    filtered.push({
      severity: 'medium',
      type: 'possible-bot-protection',
      url: crawlResult.rootOrigin,
      detail: `${softFailCount} of ${checkedCount} link/asset checks returned 401/403/429/503 responses — this pattern usually indicates the target is rate-limiting or blocking automated requests, not that those links are genuinely broken. Re-verify manually or rerun with fewer pages/lower concurrency.`,
    });
    issues.length = 0;
    issues.push(...filtered);
  }

  // flag images missing alt text (accessibility + SEO overlap)
  crawlResult.assets
    .filter(a => a.type === 'image' && (!a.alt || !a.alt.trim()) && !isTrackingOrAnalyticsUrl(a.url))
    .forEach(a => {
      issues.push({
        severity: 'low',
        type: 'missing-alt-text',
        url: a.url,
        foundOn: a.foundOn,
        detail: 'Image is missing alt text (accessibility/SEO issue)',
      });
    });

  return issues;
}

function dedupe(items) {
  const seen = new Set();
  return items.filter(i => {
    const key = i.url + '|' + i.type;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = { checkBrokenLinksAndAssets };
