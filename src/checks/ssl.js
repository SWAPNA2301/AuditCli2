const tls = require('tls');

const CONNECT_TIMEOUT = 6000;

// Minimum TLS version we consider acceptable in 2026.
const WEAK_PROTOCOLS = new Set(['TLSv1', 'TLSv1.1', 'SSLv3']);

/**
 * Opens a passive TLS handshake (no data exchange beyond the handshake itself)
 * to read the negotiated protocol version and the server's certificate metadata.
 * This is the same kind of check a browser performs on every HTTPS connection —
 * no exploitation, no payload sent.
 */
function inspectTls(hostname, port = 443) {
  return new Promise((resolve) => {
    let settled = false;
    const socket = tls.connect(
      {
        host: hostname,
        port,
        servername: hostname,
        timeout: CONNECT_TIMEOUT,
        rejectUnauthorized: false, // we want to inspect invalid/self-signed certs too, not just fail
      },
      () => {
        if (settled) return;
        settled = true;
        const cert = socket.getPeerCertificate();
        const protocol = socket.getProtocol();
        const authorized = socket.authorized;
        const authError = socket.authorizationError;
        socket.end();
        resolve({
          ok: true,
          protocol,
          authorized,
          authError: authorized ? null : authError,
          validFrom: cert && cert.valid_from ? new Date(cert.valid_from) : null,
          validTo: cert && cert.valid_to ? new Date(cert.valid_to) : null,
          issuer: cert && cert.issuer ? (cert.issuer.O || cert.issuer.CN) : null,
          subject: cert && cert.subject ? cert.subject.CN : null,
        });
      }
    );
    socket.on('error', (err) => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, error: err.code || err.message });
    });
    socket.on('timeout', () => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ ok: false, error: 'ETIMEDOUT' });
    });
  });
}

async function checkSsl(targetUrl) {
  const issues = [];
  let hostname;
  try {
    hostname = new URL(targetUrl).hostname;
  } catch (_) {
    return { issues, details: null };
  }

  if (new URL(targetUrl).protocol !== 'https:') {
    // no-https is already flagged by security-headers check; skip TLS inspection.
    return { issues, details: null };
  }

  const result = await inspectTls(hostname);
  if (!result.ok) {
    issues.push({
      severity: 'high',
      type: 'tls-connection-failed',
      url: targetUrl,
      detail: `Could not establish a TLS connection to verify the certificate: ${result.error}`,
    });
    return { issues, details: null };
  }

  if (WEAK_PROTOCOLS.has(result.protocol)) {
    issues.push({
      severity: 'high',
      type: 'weak-tls-version',
      url: targetUrl,
      detail: `Server negotiated ${result.protocol}, which is deprecated and considered insecure. Upgrade to TLS 1.2+.`,
    });
  }

  if (!result.authorized) {
    issues.push({
      severity: 'high',
      type: 'invalid-tls-certificate',
      url: targetUrl,
      detail: `TLS certificate is not trusted: ${result.authError || 'unknown validation error'}.`,
    });
  }

  if (result.validTo) {
    const daysLeft = Math.floor((result.validTo.getTime() - Date.now()) / 86400000);
    if (daysLeft < 0) {
      issues.push({
        severity: 'high',
        type: 'expired-tls-certificate',
        url: targetUrl,
        detail: `TLS certificate expired ${Math.abs(daysLeft)} day(s) ago (${result.validTo.toDateString()}).`,
      });
    } else if (daysLeft < 14) {
      issues.push({
        severity: 'medium',
        type: 'tls-certificate-expiring-soon',
        url: targetUrl,
        detail: `TLS certificate expires in ${daysLeft} day(s) (${result.validTo.toDateString()}).`,
      });
    }
  }

  return {
    issues,
    details: {
      protocol: result.protocol,
      issuer: result.issuer,
      subject: result.subject,
      validFrom: result.validFrom,
      validTo: result.validTo,
      authorized: result.authorized,
    },
  };
}

module.exports = { checkSsl };
