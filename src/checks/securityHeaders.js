/**
 * Inspects response headers of the root page for common security misconfigurations.
 * This is passive header inspection only — no exploitation, no payload injection.
 */
function checkSecurityHeaders(rootPageResult) {
  const issues = [];
  const headers = rootPageResult.headers || {};
  const get = (name) => headers[name.toLowerCase()];

  const rules = [
    {
      header: 'strict-transport-security',
      severity: 'high',
      detail: 'Missing HSTS header — site does not enforce HTTPS for future requests.',
    },
    {
      header: 'content-security-policy',
      severity: 'high',
      detail: 'Missing Content-Security-Policy — increases risk of XSS/data injection attacks.',
    },
    {
      header: 'x-frame-options',
      severity: 'medium',
      detail: 'Missing X-Frame-Options — site may be vulnerable to clickjacking.',
    },
    {
      header: 'x-content-type-options',
      severity: 'medium',
      detail: 'Missing X-Content-Type-Options — browsers may MIME-sniff responses.',
    },
    {
      header: 'referrer-policy',
      severity: 'low',
      detail: 'Missing Referrer-Policy — full URLs may leak to third parties via referrer header.',
    },
    {
      header: 'permissions-policy',
      severity: 'low',
      detail: 'Missing Permissions-Policy — browser features (camera, mic, geo) are not explicitly restricted.',
    },
  ];

  for (const rule of rules) {
    if (!get(rule.header)) {
      issues.push({
        severity: rule.severity,
        type: 'security-header',
        url: rootPageResult.url,
        detail: rule.detail,
      });
    }
  }

  // cookie flag check
  const setCookie = headers['set-cookie'];
  if (setCookie) {
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
    cookies.forEach((c) => {
      const missing = [];
      if (!/secure/i.test(c)) missing.push('Secure');
      if (!/httponly/i.test(c)) missing.push('HttpOnly');
      if (!/samesite/i.test(c)) missing.push('SameSite');
      if (missing.length) {
        issues.push({
          severity: 'medium',
          type: 'cookie-flags',
          url: rootPageResult.url,
          detail: `Cookie missing flags: ${missing.join(', ')} (${c.split('=')[0]})`,
        });
      }
    });
  }

  // HTTPS check
  if (rootPageResult.url && rootPageResult.url.startsWith('http://')) {
    issues.push({
      severity: 'high',
      type: 'no-https',
      url: rootPageResult.url,
      detail: 'Site is served over plain HTTP, not HTTPS.',
    });
  }

  return issues;
}

module.exports = { checkSecurityHeaders };
