/**
 * Lightweight performance snapshot without a headless browser:
 * page load time (TTFB+download via axios) and total transferred weight estimate.
 * For a real Lighthouse-grade audit, swap this out for the Lighthouse CLI/API later.
 */
function checkPerformance(rootPageResult, assets) {
  const issues = [];
  const details = {};

  details.loadTimeMs = rootPageResult.timeMs;
  const htmlBytes = Buffer.byteLength(rootPageResult.html || '', 'utf8');
  details.htmlKb = Math.round(htmlBytes / 1024);
  details.assetCount = assets.length;

  if (rootPageResult.timeMs > 3000) {
    issues.push({
      severity: 'medium',
      type: 'slow-load-time',
      url: rootPageResult.url,
      detail: `Initial HTML response took ${rootPageResult.timeMs}ms (>3000ms threshold).`,
    });
  }

  if (details.htmlKb > 500) {
    issues.push({
      severity: 'low',
      type: 'large-html-payload',
      url: rootPageResult.url,
      detail: `HTML document is ${details.htmlKb}KB — consider server-side trimming or code-splitting.`,
    });
  }

  const imageCount = assets.filter(a => a.type === 'image').length;
  if (imageCount > 40) {
    issues.push({
      severity: 'low',
      type: 'high-image-count',
      url: rootPageResult.url,
      detail: `${imageCount} images referenced on crawled pages — check for lazy-loading.`,
    });
  }

  // simple 0-100 score, purely heuristic for demo purposes
  let score = 100;
  score -= Math.min(40, Math.floor(rootPageResult.timeMs / 100));
  score -= Math.min(20, Math.floor(details.htmlKb / 50));
  score -= Math.min(20, Math.floor(imageCount / 5));
  details.score = Math.max(0, score);

  return { issues, details };
}

module.exports = { checkPerformance };
