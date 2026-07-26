/**
 * Detects outdated/known-vulnerable front-end library versions from <script src>
 * URLs and filenames (the same signal browser extensions like "Retire.js" use).
 * This is a small curated list, not a full CVE feed — good enough to flag the
 * most common offenders without pulling in a vulnerability database dependency.
 */
const KNOWN_VULNERABLE = [
  {
    name: 'jQuery',
    match: /jquery[.-](\d+\.\d+\.\d+)/i,
    maxSafeBelow: '3.5.0',
    detail: 'jQuery versions before 3.5.0 are affected by a cross-site scripting (XSS) issue in jQuery.htmlPrefilter (CVE-2020-11022/11023).',
  },
  {
    name: 'Bootstrap',
    match: /bootstrap[.-](\d+\.\d+\.\d+)/i,
    maxSafeBelow: '4.3.1',
    detail: 'Bootstrap versions before 4.3.1 have known XSS issues in the tooltip/popover data-template attribute (CVE-2019-8331).',
  },
  {
    name: 'Lodash',
    match: /lodash[.-](\d+\.\d+\.\d+)/i,
    maxSafeBelow: '4.17.21',
    detail: 'Lodash versions before 4.17.21 have known prototype pollution vulnerabilities (CVE-2020-8203/CVE-2021-23337).',
  },
  {
    name: 'AngularJS',
    match: /angular(?:js)?[.-](\d+\.\d+\.\d+)/i,
    maxSafeBelow: '1.8.0',
    detail: 'AngularJS versions before 1.8.0 have known sandbox-escape XSS vulnerabilities. Note: AngularJS (1.x) itself is end-of-life.',
  },
  {
    name: 'Moment.js',
    match: /moment[.-](\d+\.\d+\.\d+)/i,
    maxSafeBelow: '2.29.4',
    detail: 'Moment.js versions before 2.29.4 have a ReDoS vulnerability (CVE-2022-31129).',
  },
];

function versionLess(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0);
  }
  return false;
}

function checkVulnerableLibs(assets) {
  const issues = [];
  const seen = new Set();

  const scripts = (assets || []).filter((a) => a.type === 'script' && a.url);
  for (const asset of scripts) {
    for (const lib of KNOWN_VULNERABLE) {
      const m = asset.url.match(lib.match);
      if (!m) continue;
      const version = m[1];
      const key = `${lib.name}@${version}`;
      if (seen.has(key)) continue;
      if (versionLess(version, lib.maxSafeBelow)) {
        seen.add(key);
        issues.push({
          severity: 'high',
          type: 'vulnerable-js-library',
          url: asset.url,
          foundOn: asset.foundOn,
          detail: `${lib.name} v${version} detected — ${lib.detail}`,
        });
      }
    }
  }

  return issues;
}

module.exports = { checkVulnerableLibs };
