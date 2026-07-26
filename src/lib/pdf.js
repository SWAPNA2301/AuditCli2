const fs = require('fs');

// puppeteer-core (not puppeteer) — no bundled ~200MB Chromium download.
// Instead we point it at whatever Chrome/Edge is already installed on the
// machine, which covers the overwhelming majority of dev/CI environments.
const CANDIDATE_PATHS = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  // Windows
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  // macOS
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  // Linux
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/usr/bin/microsoft-edge',
].filter(Boolean);

function findBrowserExecutable() {
  for (const candidate of CANDIDATE_PATHS) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Renders a self-contained HTML report string (the same one used for the
 * .html report / dashboard) to a PDF via headless Chrome/Edge. Reuses the
 * exact same charts/layout instead of re-implementing the report in a
 * PDF-drawing library, so the PDF and the on-screen report never drift.
 */
async function renderHtmlToPdf(html, outPath) {
  const executablePath = findBrowserExecutable();
  if (!executablePath) {
    throw new Error(
      'No installed Chrome/Edge found for PDF rendering. Install Google Chrome or Microsoft Edge, ' +
      'or set PUPPETEER_EXECUTABLE_PATH in .env to a browser executable.'
    );
  }

  const puppeteer = require('puppeteer-core');
  const browser = await puppeteer.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    // charts render via an inline <script> on DOMContentLoaded/immediately —
    // give the SVG a brief moment to paint before snapshotting to PDF.
    await new Promise((resolve) => setTimeout(resolve, 300));
    await page.pdf({
      path: outPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '16mm', bottom: '16mm', left: '12mm', right: '12mm' },
    });
  } finally {
    await browser.close();
  }
  return outPath;
}

module.exports = { renderHtmlToPdf, findBrowserExecutable };
