const axios = require('axios');
const cheerio = require('cheerio');

const SERPAPI_URL = 'https://serpapi.com/search.json';
const DDG_SEARCH_URL = 'https://html.duckduckgo.com/html/';
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Domains that show up constantly in "X competitors" search results but are
// themselves marketing/analytics/listicle sites, not actual competitors —
// we use these as *sources to mine links from*, never as candidates.
const ARTICLE_SOURCE_DOMAINS = new Set([
  'semrush.com', 'similarweb.com', 'rankred.com', 'fourweekmba.com', 'shopify.com',
  'sellbery.com', 'doit.software', 'g2.com', 'capterra.com', 'trustpilot.com',
  'crunchbase.com', 'forbes.com', 'businessinsider.com', 'investopedia.com',
  'nerdwallet.com', 'techcrunch.com', 'statista.com', 'comparably.com', 'owler.com',
  'craft.co', 'zippia.com', 'apstartup.in', 'amzprep.com', 'headsup.bot',
  'medium.com', 'quora.com', 'producthunt.com', 'wikipedia.org', 'reddit.com',
  'litcommerce.com', 'goaura.com', 'amzscout.net', 'avartexwholesalegroup.com',
  'commercengine.io', 'influencermarketinghub.com',
]);

// Never a real competitor — social platforms, infra, and the ubiquitous
// third-party SaaS/footer links (chat widgets, schedulers, payment, CI, docs)
// that appear on virtually every site and so get picked up by link mining.
const NOISE_DOMAINS = new Set([
  ...ARTICLE_SOURCE_DOMAINS,
  // social / platforms
  'youtube.com', 'facebook.com', 'twitter.com', 'x.com', 'linkedin.com',
  'instagram.com', 'pinterest.com', 'tiktok.com', 'threads.net', 'bsky.app',
  't.me', 'telegram.org', 'whatsapp.com', 'mastodon.social',
  // big tech / infra / CDNs
  'amazon.com', 'google.com', 'apple.com', 'microsoft.com', 'github.com',
  'gitlab.com', 'bitbucket.org', 'play.google.com', 'apps.apple.com',
  'w3.org', 'schema.org', 'googleapis.com', 'gstatic.com', 'cloudflare.com',
  'fonts.google.com', 'ads.google.com', 'doubleclick.net', 'npmjs.com',
  'docker.com', 'vercel.com', 'netlify.com', 'stackoverflow.com',
  // ubiquitous embedded third-party SaaS (footer/widget links)
  'slack.com', 'discord.com', 'discord.gg', 'calendly.com', 'zoom.us',
  'notion.so', 'hubspot.com', 'mailchimp.com', 'stripe.com', 'paypal.com',
  'intercom.com', 'zendesk.com', 'typeform.com', 'airtable.com', 'loom.com',
  'figma.com', 'canva.com', 'atlassian.com', 'trello.com', 'asana.com',
  'monday.com', 'substack.com', 'patreon.com', 'buymeacoffee.com', 'nolt.io',
  'wordpress.org', 'wordpress.com', 'wix.com', 'squarespace.com',
  'dev.to', 'hashnode.com',
]);

// Generic modifier words that trailed "<brand> vs <word> ..." in autocomplete
// suggestions but aren't themselves a competitor name (e.g. "amazon vs stock").
const GENERIC_SUFFIX_WORDS = new Set([
  'stock', 'stocks', 'share', 'shares', 'market', 'cap', 'revenue', 'investment',
  'investments', 'earnings', 'prime', 'business', 'marketplace', 'haul', 'app',
  'apps', 'logo', 'price', 'pricing', 'value', 'worth', 'ipo', 'review', 'reviews',
  'comparison', 'wiki', 'wikipedia', 'stock price', 'q1', 'q2', 'q3', 'q4',
]);

// Substrings that reliably identify listicle/aggregator/site-analytics
// domains, which rank heavily for "best X like Y" and "sites similar to Y"
// queries but are never themselves a competitor. Deliberately specific
// tokens rather than broad words like "review" or "guide" — those appear in
// plenty of legitimate company domains and caused real competitors to be
// discarded.
const AGGREGATOR_TOKENS = [
  'sitelike', 'similarsites', 'similarweb', 'alternativeto', 'alternative.to',
  'whois', 'trafficestimate', 'webstatsdomain', 'siteworthtraffic', 'statshow',
  'vendorselection', 'bestproducts', 'listicle', 'toptenreviews', 'expertmarket',
];

// Multi-part public suffixes we care about, so "bbc.co.uk" doesn't collapse
// to the meaningless "co.uk". Not an exhaustive PSL — just the common ones
// this tool actually encounters.
const MULTI_PART_SUFFIXES = new Set([
  'co.uk', 'com.au', 'co.in', 'co.jp', 'co.nz', 'com.br', 'com.mx', 'co.za',
  'com.sg', 'com.tr', 'co.kr', 'com.cn', 'org.uk', 'net.au', 'ac.uk', 'gov.uk',
]);

function registrableDomain(hostname) {
  const parts = hostname.replace(/^www\./, '').toLowerCase().split('.');
  if (parts.length <= 2) return parts.join('.');
  const lastTwo = parts.slice(-2).join('.');
  return MULTI_PART_SUFFIXES.has(lastTwo) ? parts.slice(-3).join('.') : lastTwo;
}

/**
 * Rejects anything that isn't a plausible public website domain — bare IPs,
 * localhost, hostnames with no dot, and numeric/invalid TLDs. Without this,
 * a malformed href in a mined page could yield junk like "56.112", which
 * then fails to audit and shows up to the user as a "skipped competitor".
 */
function isValidPublicDomain(domain) {
  if (!domain || !domain.includes('.')) return false;
  if (/^\d+(\.\d+)*$/.test(domain)) return false; // bare IPv4 / numeric fragment
  if (domain === 'localhost' || domain.endsWith('.local')) return false;
  const tld = domain.split('.').pop();
  return /^[a-z]{2,24}$/.test(tld); // TLD must be alphabetic
}

function isRejectedDomain(domain) {
  if (!isValidPublicDomain(domain) || NOISE_DOMAINS.has(domain)) return true;
  return AGGREGATOR_TOKENS.some((token) => domain.includes(token));
}

async function detectBrandSeed(targetUrl, rootPageHtml) {
  try {
    const $ = cheerio.load(rootPageHtml || '');
    const ogSite = $('meta[property="og:site_name"]').attr('content');
    if (ogSite && ogSite.trim()) return ogSite.trim();
    const appName = $('meta[name="application-name"]').attr('content');
    if (appName && appName.trim()) return appName.trim();
  } catch (_) { /* fall through */ }
  const host = new URL(targetUrl).hostname.replace(/^www\./, '');
  const brand = host.split('.')[0];
  return brand.charAt(0).toUpperCase() + brand.slice(1);
}

// Keyword → business-category heuristic. Scores each category by keyword
// hits against the page's title/meta/body text so competitor search queries
// can stay in-niche (a shopping site should surface other shopping sites,
// not a random SaaS tool that happens to share a brand-name collision).
const CATEGORY_KEYWORDS = {
  'online shopping sites': ['shop', 'shopping', 'add to cart', 'checkout', 'free shipping', 'buy now', 'deals', 'cart', 'orders', 'wishlist'],
  'SaaS software platforms': ['software', 'saas', 'api', 'dashboard', 'integration', 'free trial', 'pricing plans', 'subscription', 'workspace'],
  'food delivery services': ['order food', 'food delivery', 'restaurant', 'menu', 'delivery time', 'cuisine'],
  'travel booking sites': ['hotel', 'flight', 'booking', 'travel', 'vacation', 'itinerary', 'destinations'],
  'banking and finance apps': ['bank', 'loan', 'credit card', 'investment', 'insurance', 'interest rate', 'mutual fund'],
  'online learning platforms': ['course', 'learn online', 'university', 'tutorial', 'certification', 'enroll', 'curriculum'],
  'news publications': ['breaking news', 'editor', 'journalist', 'headlines', 'subscribe to our newsletter'],
  'social networking apps': ['social network', 'follow us', 'community', 'friends', 'share your', 'profile'],
  'real estate listing sites': ['property', 'real estate', 'listing', 'for rent', 'mortgage', 'square feet'],
  'healthcare providers': ['appointment', 'doctor', 'clinic', 'patient', 'pharmacy', 'prescription', 'diagnosis'],
  'gaming platforms': ['play now', 'gameplay', 'multiplayer', 'leaderboard', 'download game'],
};

async function detectCategory(targetUrl, rootPageHtml) {
  try {
    const $ = cheerio.load(rootPageHtml || '');
    const text = [
      $('title').first().text(),
      $('meta[name="description"]').attr('content') || '',
      $('meta[name="keywords"]').attr('content') || '',
      $('meta[property="og:type"]').attr('content') || '',
      $('body').text().slice(0, 3000),
    ].join(' ').toLowerCase();

    let best = null;
    let bestScore = 0;
    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      const score = keywords.reduce((sum, kw) => sum + (text.includes(kw) ? 1 : 0), 0);
      if (score > bestScore) { bestScore = score; best = category; }
    }
    return bestScore >= 2 ? best : null;
  } catch (_) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// SerpAPI path (primary when SERPAPI_KEY is set) — a real search API instead
// of scraping search-engine HTML, so it doesn't get CAPTCHA'd/blocked.
// ---------------------------------------------------------------------------

async function serpApiRequest(apiKey, params) {
  try {
    const res = await axios.get(SERPAPI_URL, {
      params: { ...params, api_key: apiKey },
      timeout: 10000,
      validateStatus: () => true,
    });
    return res.status === 200 ? res.data : null;
  } catch (_) {
    return null;
  }
}

async function serpApiOrganicLinks(apiKey, query, num = 8) {
  const data = await serpApiRequest(apiKey, { engine: 'google', q: query, num });
  return data ? (data.organic_results || []).map((r) => r.link).filter(Boolean) : [];
}

/**
 * "<brand> vs" autocomplete suggestions are Google's own query-completion
 * data — for a well-known brand they're dominated by real head-to-head
 * comparisons ("amazon vs walmart", "amazon vs ebay"), which is a much more
 * direct signal than mining prose out of a "top 10 competitors" listicle.
 */
async function namesFromAutocomplete(apiKey, brand) {
  const data = await serpApiRequest(apiKey, { engine: 'google_autocomplete', q: `${brand} vs` });
  const suggestions = data ? (data.suggestions || []).map((s) => s.value) : [];
  const brandLower = brand.toLowerCase();
  const marker = `${brandLower} vs `;
  const names = [];
  const seen = new Set();
  for (const suggestion of suggestions) {
    const lower = suggestion.toLowerCase();
    if (!lower.startsWith(marker)) continue;
    const firstWord = lower.slice(marker.length).trim().split(/\s+/)[0];
    if (!firstWord || firstWord.length < 3 || /\d/.test(firstWord)) continue;
    if (firstWord === brandLower || brandLower.startsWith(firstWord) || firstWord.startsWith(brandLower)) continue;
    if (GENERIC_SUFFIX_WORDS.has(firstWord) || seen.has(firstWord)) continue;
    seen.add(firstWord);
    names.push(firstWord);
    if (names.length >= 6) break;
  }
  return names;
}

async function resolveNameToDomain(apiKey, name, excludeDomains) {
  const links = await serpApiOrganicLinks(apiKey, name, 5);
  for (const link of links) {
    try {
      const domain = registrableDomain(new URL(link).hostname);
      if (!excludeDomains.has(domain) && !isRejectedDomain(domain)) return domain;
    } catch (_) { /* ignore malformed */ }
  }
  return null;
}

/**
 * Strongest generic signal: a "sites like <domain>" search. Google answers
 * this query with actual peer sites far more often than a brand-name or
 * category query does, which matters most for smaller/niche sites where
 * "<brand> competitors" returns nothing but SEO listicles.
 */
async function namesFromSitesLikeSearch(apiKey, hostname, targetDomain, exclude) {
  const links = await serpApiOrganicLinks(apiKey, `sites like ${hostname}`, 8);
  const found = [];
  for (const link of links) {
    let domain;
    try { domain = registrableDomain(new URL(link).hostname); } catch (_) { continue; }
    if (domain === targetDomain || exclude.has(domain) || isRejectedDomain(domain) || found.includes(domain)) continue;
    found.push(domain);
  }
  return found;
}

async function fetchOutboundDomains(articleUrl, sourceDomain) {
  try {
    const res = await axios.get(articleUrl, {
      timeout: 7000,
      headers: { 'User-Agent': BROWSER_UA },
      validateStatus: () => true,
      maxContentLength: 3 * 1024 * 1024,
    });
    if (res.status !== 200 || typeof res.data !== 'string') return [];
    const $ = cheerio.load(res.data);
    const domains = [];
    $('a[href^="http"]').each((_, el) => {
      try {
        const domain = registrableDomain(new URL($(el).attr('href')).hostname);
        if (domain !== sourceDomain) domains.push(domain);
      } catch (_) { /* ignore malformed */ }
    });
    return domains;
  } catch (_) {
    return [];
  }
}

/**
 * Direct signal: for a niche/long-tail query like "best online shopping
 * sites like amazon", the organic results themselves are often the actual
 * competing product/company pages rather than SEO listicles — worth trying
 * before falling back to mining prose out of "top 10 competitors" articles.
 */
async function namesFromCategorySearch(apiKey, brand, category, targetDomain, exclude) {
  if (!category) return [];
  const links = await serpApiOrganicLinks(apiKey, `best ${category} like ${brand}`, 8);
  const found = [];
  for (const link of links) {
    let domain;
    try { domain = registrableDomain(new URL(link).hostname); } catch (_) { continue; }
    if (domain === targetDomain || exclude.has(domain) || isRejectedDomain(domain) || found.includes(domain)) continue;
    found.push(domain);
  }
  return found;
}

/**
 * Fallback signal (used when autocomplete/category search don't reach
 * `limit`): search "<brand> competitors [in <category>]" via SerpAPI, then
 * mine the domains the top-ranking listicle articles link out to — real
 * competitor sites tend to be cited by multiple independent articles.
 */
async function namesFromArticleMining(apiKey, brand, category, targetDomain, exclude) {
  const query = category ? `${brand} competitors in ${category}` : `${brand} competitors`;
  const links = await serpApiOrganicLinks(apiKey, query, 8);
  const articles = [];
  const seenSourceDomains = new Set();
  for (const link of links) {
    let domain;
    try { domain = registrableDomain(new URL(link).hostname); } catch (_) { continue; }
    if (domain === targetDomain || seenSourceDomains.has(domain)) continue;
    seenSourceDomains.add(domain);
    articles.push({ url: link, domain });
    if (articles.length >= 4) break;
  }
  if (!articles.length) return [];

  const domainCounts = new Map();
  await Promise.all(
    articles.map(async ({ url, domain }) => {
      const outbound = new Set(await fetchOutboundDomains(url, domain));
      for (const d of outbound) {
        if (d === targetDomain || exclude.has(d) || isRejectedDomain(d) || articles.some((a) => a.domain === d)) continue;
        domainCounts.set(d, (domainCounts.get(d) || 0) + 1);
      }
    })
  );
  return [...domainCounts.entries()].sort((a, b) => b[1] - a[1]).map(([domain]) => domain);
}

async function discoverViaSerpApi(apiKey, brand, category, targetDomain, limit, hostname) {
  const found = new Set();

  // Tier 1: "sites like <domain>" — the most reliable generic peer query,
  // and the only one that works well for small/niche sites.
  const sitesLike = await namesFromSitesLikeSearch(apiKey, hostname, targetDomain, new Set());
  for (const domain of sitesLike) {
    if (found.size >= limit) break;
    found.add(domain);
  }

  // Tier 2: same-category direct search ("best <category> like <brand>").
  if (found.size < limit && category) {
    const direct = await namesFromCategorySearch(apiKey, brand, category, targetDomain, new Set(found));
    for (const domain of direct) {
      if (found.size >= limit) break;
      found.add(domain);
    }
  }

  // Tier 3: "<brand> vs <name>" autocomplete, resolved to a homepage domain.
  if (found.size < limit) {
    const names = await namesFromAutocomplete(apiKey, brand);
    for (const name of names) {
      if (found.size >= limit) break;
      const exclude = new Set([targetDomain, ...found]);
      const domain = await resolveNameToDomain(apiKey, name, exclude);
      if (domain) found.add(domain);
    }
  }

  // Tier 4: mine outbound links from "<brand> competitors [in <category>]" articles.
  if (found.size < limit) {
    const mined = await namesFromArticleMining(apiKey, brand, category, targetDomain, new Set([targetDomain, ...found]));
    for (const domain of mined) {
      if (found.size >= limit) break;
      found.add(domain);
    }
  }

  return [...found].map((domain) => `https://${domain}`);
}

// ---------------------------------------------------------------------------
// DuckDuckGo HTML fallback (no API key required, but scrapes search HTML
// directly — DuckDuckGo can change markup or rate-limit without notice).
// ---------------------------------------------------------------------------

function decodeDuckDuckGoLink(href) {
  try {
    const idx = href.indexOf('/l/?');
    if (idx !== -1) {
      const params = new URLSearchParams(href.slice(idx + 3));
      const target = params.get('uddg');
      return target ? decodeURIComponent(target) : null;
    }
    if (href.startsWith('http')) return href;
    return null;
  } catch (_) {
    return null;
  }
}

async function ddgSearch(query) {
  try {
    const res = await axios.get(DDG_SEARCH_URL, {
      params: { q: query },
      timeout: 8000,
      headers: { 'User-Agent': BROWSER_UA },
      validateStatus: () => true,
    });
    if (res.status !== 200) return [];
    const $ = cheerio.load(res.data);
    const results = [];
    $('a.result__a').each((_, el) => {
      const resolved = decodeDuckDuckGoLink($(el).attr('href') || '');
      if (resolved) results.push(resolved);
    });
    return results;
  } catch (_) {
    return [];
  }
}

async function discoverViaDuckDuckGo(brand, category, targetDomain, limit) {
  const query = category ? `${brand} competitors in ${category}` : `${brand} competitors`;
  const serpResults = await ddgSearch(query);
  const articleUrls = [];
  const seenSourceDomains = new Set();
  for (const resultUrl of serpResults) {
    let domain;
    try { domain = registrableDomain(new URL(resultUrl).hostname); } catch (_) { continue; }
    if (domain === targetDomain || seenSourceDomains.has(domain)) continue;
    seenSourceDomains.add(domain);
    articleUrls.push({ url: resultUrl, domain });
    if (articleUrls.length >= 4) break;
  }
  if (!articleUrls.length) return [];

  const domainCounts = new Map();
  await Promise.all(
    articleUrls.map(async ({ url, domain }) => {
      const outbound = new Set(await fetchOutboundDomains(url, domain));
      for (const d of outbound) {
        if (d === targetDomain || isRejectedDomain(d) || articleUrls.some((a) => a.domain === d)) continue;
        domainCounts.set(d, (domainCounts.get(d) || 0) + 1);
      }
    })
  );
  return [...domainCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([domain]) => `https://${domain}`);
}

/**
 * Competitor discovery: uses SerpAPI (SERPAPI_KEY in .env) when available —
 * real search results, no scraping/blocking risk. Falls back to a best-effort
 * DuckDuckGo HTML scrape when no key is configured.
 */
async function discoverCompetitors(targetUrl, rootPageHtml, { limit = 4 } = {}) {
  const hostname = new URL(targetUrl).hostname.replace(/^www\./, '');
  const targetDomain = registrableDomain(hostname);
  const [seed, category] = await Promise.all([
    detectBrandSeed(targetUrl, rootPageHtml),
    detectCategory(targetUrl, rootPageHtml),
  ]);
  const apiKey = process.env.SERPAPI_KEY;

  const competitors = apiKey
    ? await discoverViaSerpApi(apiKey, seed, category, targetDomain, limit, hostname)
    : await discoverViaDuckDuckGo(seed, category, targetDomain, limit);

  return {
    seed,
    category,
    query: category ? `${seed} competitors in ${category}` : `${seed} competitors`,
    competitors,
    source: apiKey ? 'serpapi' : 'duckduckgo',
  };
}

module.exports = { discoverCompetitors };
