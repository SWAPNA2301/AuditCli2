const cheerio = require('cheerio');

/**
 * Runs SEO / content-quality checks against each crawled page's HTML.
 */
function checkSeoContent(pages) {
  const issues = [];
  const seenTitles = new Map(); // title -> [urls]

  for (const page of pages) {
    if (!page.ok || !page.html) continue;
    const $ = cheerio.load(page.html);
    const url = page.url;

    const title = $('title').first().text().trim();
    const metaDesc = $('meta[name="description"]').attr('content');
    const h1s = $('h1');

    if (!title) {
      issues.push({ severity: 'medium', type: 'seo-missing-title', url, detail: 'Page has no <title> tag.' });
    } else {
      if (!seenTitles.has(title)) seenTitles.set(title, []);
      seenTitles.get(title).push(url);
    }

    if (!metaDesc || !metaDesc.trim()) {
      issues.push({ severity: 'low', type: 'seo-missing-meta-description', url, detail: 'Page has no meta description.' });
    }

    if (h1s.length === 0) {
      issues.push({ severity: 'low', type: 'seo-missing-h1', url, detail: 'Page has no <h1> heading.' });
    } else if (h1s.length > 1) {
      issues.push({ severity: 'low', type: 'seo-multiple-h1', url, detail: `Page has ${h1s.length} <h1> tags (should be 1).` });
    }

    if (!$('meta[name="viewport"]').attr('content')) {
      issues.push({ severity: 'low', type: 'seo-missing-viewport', url, detail: 'Missing responsive viewport meta tag.' });
    }
  }

  // duplicate titles across pages
  for (const [title, urls] of seenTitles.entries()) {
    if (urls.length > 1) {
      issues.push({
        severity: 'medium',
        type: 'seo-duplicate-title',
        url: urls.join(', '),
        detail: `${urls.length} pages share the same title: "${title}"`,
      });
    }
  }

  return issues;
}

module.exports = { checkSeoContent };
