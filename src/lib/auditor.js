const { crawlSite } = require('./crawler');
const { checkBrokenLinksAndAssets } = require('../checks/brokenLinks');
const { checkSecurityHeaders } = require('../checks/securityHeaders');
const { checkSeoContent } = require('../checks/seoContent');
const { detectTechStack } = require('../checks/techStack');
const { checkPerformance } = require('../checks/performance');
const { checkSsl } = require('../checks/ssl');
const { checkDnsWhois } = require('../checks/dnsWhois');
const { checkExposedFiles } = require('../checks/exposedFiles');
const { checkVulnerableLibs } = require('../checks/vulnerableLibs');
const { computeRiskScore } = require('./riskScore');

/**
 * Runs the full audit pipeline against a single URL and returns a structured result.
 * onProgress(stepName) is called before each stage, useful for spinner updates.
 */
async function runAudit(targetUrl, { maxPages = 15, onProgress = () => {} } = {}) {
  onProgress('crawling');
  const crawlResult = await crawlSite(targetUrl, { maxPages });
  const rootPage = crawlResult.pages[0];

  if (!rootPage || !rootPage.ok) {
    throw new Error(`Could not reach ${targetUrl}: ${rootPage ? rootPage.error : 'no response'}`);
  }

  // If the site answered with a bot-protection interstitial we still run the
  // full audit and always produce a report — but we record it as a finding so
  // the scores are read in context, since they describe the challenge page
  // that was returned rather than the site's real content.
  const crawlBlocked = Boolean(rootPage.challenged);

  onProgress('broken-links');
  const linkIssues = await checkBrokenLinksAndAssets(crawlResult);

  onProgress('security-headers');
  const securityIssues = checkSecurityHeaders(rootPage);

  onProgress('seo-content');
  const seoIssues = checkSeoContent(crawlResult.pages);

  onProgress('tech-stack');
  const techStack = detectTechStack(rootPage);

  onProgress('performance');
  const performance = checkPerformance(rootPage, crawlResult.assets);

  onProgress('tls-security');
  const ssl = await checkSsl(targetUrl);

  onProgress('dns-domain');
  const dnsWhois = await checkDnsWhois(targetUrl);

  onProgress('exposed-files');
  const exposedFileIssues = await checkExposedFiles(targetUrl);

  onProgress('vulnerable-libs');
  const vulnerableLibIssues = checkVulnerableLibs(crawlResult.assets);

  const issues = [
    ...linkIssues,
    ...securityIssues,
    ...seoIssues,
    ...performance.issues,
    ...ssl.issues,
    ...dnsWhois.issues,
    ...exposedFileIssues,
    ...vulnerableLibIssues,
  ];

  return {
    targetUrl,
    timestamp: new Date().toISOString(),
    pagesCrawled: crawlResult.pages.length,
    assetsFound: crawlResult.assets.length,
    linksFound: crawlResult.links.length,
    crawlBlocked,
    issues,
    techStack,
    performance,
    riskScore: computeRiskScore(issues),
    security: {
      tls: ssl.details,
      dns: dnsWhois.details,
    },
    rootPageHtml: rootPage.html,
  };
}

module.exports = { runAudit };
