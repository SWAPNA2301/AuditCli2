const cheerio = require('cheerio');

/**
 * Lightweight fingerprinting of front-end/back-end tech, inspired by Wappalyzer's
 * approach but far simpler: checks headers, script src patterns, and meta generator tags.
 */
function detectTechStack(rootPageResult) {
  const found = new Set();
  const headers = rootPageResult.headers || {};
  const html = rootPageResult.html || '';

  const headerChecks = [
    { header: 'x-powered-by', pattern: /express/i, tech: 'Express (Node.js)' },
    { header: 'x-powered-by', pattern: /php/i, tech: 'PHP' },
    { header: 'x-powered-by', pattern: /asp\.net/i, tech: 'ASP.NET' },
    { header: 'server', pattern: /nginx/i, tech: 'Nginx' },
    { header: 'server', pattern: /apache/i, tech: 'Apache' },
    { header: 'server', pattern: /cloudflare/i, tech: 'Cloudflare' },
    { header: 'x-vercel-id', pattern: /.*/, tech: 'Vercel' },
    { header: 'x-nf-request-id', pattern: /.*/, tech: 'Netlify' },
  ];

  for (const check of headerChecks) {
    const val = headers[check.header];
    if (val && check.pattern.test(val)) found.add(check.tech);
  }

  const htmlChecks = [
    { pattern: /__NEXT_DATA__/, tech: 'Next.js' },
    { pattern: /data-reactroot|react-dom/i, tech: 'React' },
    { pattern: /ng-version=/i, tech: 'Angular' },
    { pattern: /__NUXT__/, tech: 'Nuxt.js' },
    { pattern: /data-v-app|__vue__/i, tech: 'Vue.js' },
    { pattern: /wp-content|wp-includes/i, tech: 'WordPress' },
    { pattern: /cdn\.shopify\.com/i, tech: 'Shopify' },
    { pattern: /wixstatic\.com|wix\.com/i, tech: 'Wix' },
    { pattern: /squarespace/i, tech: 'Squarespace' },
    { pattern: /webflow/i, tech: 'Webflow' },
    { pattern: /gatsby/i, tech: 'Gatsby' },
    { pattern: /svelte/i, tech: 'Svelte' },
    { pattern: /tailwindcss|class="[^"]*\btext-\w+-\d{3}\b/, tech: 'Tailwind CSS (likely)' },
    { pattern: /bootstrap/i, tech: 'Bootstrap' },
    { pattern: /jquery/i, tech: 'jQuery' },
    { pattern: /google-analytics\.com|gtag\(/i, tech: 'Google Analytics' },
    { pattern: /googletagmanager\.com/i, tech: 'Google Tag Manager' },
  ];

  for (const check of htmlChecks) {
    if (check.pattern.test(html)) found.add(check.tech);
  }

  // meta generator tag is a strong signal
  try {
    const $ = cheerio.load(html);
    const generator = $('meta[name="generator"]').attr('content');
    if (generator) found.add(generator.trim());
  } catch (_) { /* ignore parse errors */ }

  return Array.from(found);
}

module.exports = { detectTechStack };
