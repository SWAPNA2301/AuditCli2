const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');

const DEFAULT_TIMEOUT = 8000;
// A normal browser UA. An obvious bot UA gets 403'd by a large share of real
// sites (WAFs, Cloudflare rules), which previously showed up as unreachable
// competitors and phantom "access-restricted" findings rather than as real
// results. Requests stay identical in every other respect — same read-only
// GET/HEAD, same low concurrency.
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Markers of a bot-protection interstitial (CAPTCHA / JS challenge) rather
// than the real page. These come back with a 200/202 and a tiny HTML body,
// so without this check the crawler would treat the challenge page as the
// site itself and report a misleadingly clean audit of a page that was
// never actually reached.
const CHALLENGE_MARKERS = [
  'sgcaptcha',
  'cf-browser-verification',
  '__cf_chl',
  'cf_chl_opt',
  'just a moment...',
  'checking your browser before accessing',
  'attention required! | cloudflare',
  'enable javascript and cookies to continue',
  'px-captcha',
  'perimeterx',
  '/recaptcha/api',
  'hcaptcha.com/captcha',
  'are you a robot',
];

function isBotChallengePage(html) {
  if (!html) return false;
  const sample = html.slice(0, 4000).toLowerCase();
  return CHALLENGE_MARKERS.some((marker) => sample.includes(marker));
}

/**
 * Fetches a single URL and returns
 * { ok, status, headers, html, challenged, error, timeMs }
 */
async function fetchUrl(url, { method = 'get', timeout = DEFAULT_TIMEOUT } = {}) {
  const start = Date.now();
  try {
    const res = await axios({
      method,
      url,
      timeout,
      maxRedirects: 5,
      validateStatus: () => true, // we want to inspect 404s etc ourselves
      headers: { 'User-Agent': USER_AGENT },
    });
    const html = typeof res.data === 'string' ? res.data : '';
    return {
      ok: true,
      status: res.status,
      headers: res.headers,
      html,
      challenged: isBotChallengePage(html),
      timeMs: Date.now() - start,
    };
  } catch (err) {
    return {
      ok: false,
      status: err.response ? err.response.status : null,
      error: err.code || err.message,
      timeMs: Date.now() - start,
    };
  }
}

/**
 * Crawls a site starting at rootUrl up to maxPages, staying on the same origin.
 * Returns { pages: [{url, status, timeMs, html}], assets: [{url, type, foundOn}], links: [{url, foundOn}] }
 */
async function crawlSite(rootUrl, { maxPages = 15, sameOriginOnly = true } = {}) {
  const rootOrigin = new URL(rootUrl).origin;
  const visited = new Set();
  const queue = [rootUrl];
  const pages = [];
  const assets = []; // images, scripts, stylesheets found across pages
  const links = [];  // all <a> hrefs found, internal + external

  while (queue.length && pages.length < maxPages) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);

    const result = await fetchUrl(current);
    pages.push({ url: current, ...result });

    if (!result.ok || !result.html) continue;

    const $ = cheerio.load(result.html);

    // collect assets
    $('img[src]').each((_, el) => {
      assets.push({ url: resolveUrl(current, $(el).attr('src')), type: 'image', foundOn: current, alt: $(el).attr('alt') });
    });
    $('script[src]').each((_, el) => {
      assets.push({ url: resolveUrl(current, $(el).attr('src')), type: 'script', foundOn: current });
    });
    $('link[rel="stylesheet"][href]').each((_, el) => {
      assets.push({ url: resolveUrl(current, $(el).attr('href')), type: 'stylesheet', foundOn: current });
    });

    // collect links, and enqueue internal ones for crawling
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href || /^(mailto:|tel:|#|javascript:|data:|sms:|whatsapp:)/i.test(href.trim())) return;
      const abs = resolveUrl(current, href);
      if (!abs) return;
      links.push({ url: abs, foundOn: current });

      try {
        const linkOrigin = new URL(abs).origin;
        if ((!sameOriginOnly || linkOrigin === rootOrigin) && !visited.has(abs) && !queue.includes(abs)) {
          queue.push(abs);
        }
      } catch (_) { /* ignore malformed urls */ }
    });
  }

  return { pages, assets, links, rootOrigin };
}

function resolveUrl(base, href) {
  try {
    return new URL(href, base).toString();
  } catch (_) {
    return null;
  }
}

module.exports = { fetchUrl, crawlSite, isBotChallengePage };
