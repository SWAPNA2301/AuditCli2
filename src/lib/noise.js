/**
 * Identifies analytics/ad/telemetry beacon requests that are not real
 * page content — they're frequently 1x1 tracking pixels or fire-and-forget
 * logging endpoints that legitimately 404/reject when fetched standalone
 * (no session, no referrer, no batched payload). Treating these as
 * "broken assets" or dinging them for missing alt text produces noisy,
 * misleading findings, so audit checks should skip them entirely.
 */
const TRACKING_PATTERNS = [
  /fls-na\.amazon/i,
  /fls-eu\.amazon/i,
  /\/batch\/\d+\/OP\//i,
  /doubleclick\.net/i,
  /google-analytics\.com/i,
  /googletagmanager\.com/i,
  /googleadservices\.com/i,
  /googlesyndication\.com/i,
  /adservice\.google/i,
  /facebook\.com\/tr\b/i,
  /amazon-adsystem\.com/i,
  /\/pixel(\.\w+)?(\?|$)/i,
  /\/beacon(\.\w+)?(\?|$)/i,
  /\/collect\?/i,
  /segment\.io/i,
  /hotjar\.com/i,
  /scorecardresearch\.com/i,
];

function isTrackingOrAnalyticsUrl(url) {
  if (!url) return false;
  return TRACKING_PATTERNS.some((pattern) => pattern.test(url));
}

module.exports = { isTrackingOrAnalyticsUrl };
