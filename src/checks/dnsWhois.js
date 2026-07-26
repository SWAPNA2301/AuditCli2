const dns = require('dns').promises;
const axios = require('axios');

/**
 * Passive DNS + domain registration lookups. Uses standard public resolvers
 * and the public RDAP registry (the modern, standardized successor to WHOIS,
 * https://rdap.org) — a read-only lookup, same as `whois` on the command line.
 */
async function lookupDns(hostname) {
  const out = { a: [], aaaa: [], mx: [], ns: [], txt: [], caa: [] };
  await Promise.all([
    dns.resolve4(hostname).then((r) => (out.a = r)).catch(() => {}),
    dns.resolve6(hostname).then((r) => (out.aaaa = r)).catch(() => {}),
    dns.resolveMx(hostname).then((r) => (out.mx = r)).catch(() => {}),
    dns.resolveNs(hostname).then((r) => (out.ns = r)).catch(() => {}),
    dns.resolveTxt(hostname).then((r) => (out.txt = r.map((parts) => parts.join('')))).catch(() => {}),
    dns.resolveCaa(hostname).then((r) => (out.caa = r)).catch(() => {}),
  ]);
  return out;
}

async function lookupRdap(hostname) {
  const registrableDomain = toRegistrableDomain(hostname);
  try {
    const res = await axios.get(`https://rdap.org/domain/${registrableDomain}`, {
      timeout: 6000,
      validateStatus: () => true,
    });
    if (res.status !== 200 || !res.data) return null;
    const data = res.data;
    const registrar = (data.entities || []).find((e) => (e.roles || []).includes('registrar'));
    const expirationEvent = (data.events || []).find((e) => e.eventAction === 'expiration');
    return {
      domain: data.ldhName || registrableDomain,
      registrar: registrar && registrar.vcardArray ? extractVcardFn(registrar.vcardArray) : null,
      expiresAt: expirationEvent ? new Date(expirationEvent.eventDate) : null,
      status: data.status || [],
    };
  } catch (_) {
    return null;
  }
}

function extractVcardFn(vcardArray) {
  try {
    const entries = vcardArray[1] || [];
    const fn = entries.find((e) => e[0] === 'fn');
    return fn ? fn[3] : null;
  } catch (_) {
    return null;
  }
}

function toRegistrableDomain(hostname) {
  const parts = hostname.split('.');
  return parts.length > 2 ? parts.slice(-2).join('.') : hostname;
}

async function checkDnsWhois(targetUrl) {
  const issues = [];
  let hostname;
  try {
    hostname = new URL(targetUrl).hostname;
  } catch (_) {
    return { issues, details: null };
  }

  const [records, rdap] = await Promise.all([lookupDns(hostname), lookupRdap(hostname)]);

  const hasSpf = records.txt.some((t) => /^v=spf1/i.test(t));
  if (!hasSpf) {
    issues.push({
      severity: 'low',
      type: 'missing-spf-record',
      url: targetUrl,
      detail: 'No SPF (v=spf1) TXT record found — email sent "from" this domain may be easier to spoof.',
    });
  }

  const hasDmarc = records.txt.some((t) => /^v=dmarc1/i.test(t));
  // DMARC lives on _dmarc.<domain>, not the apex — check that too.
  let dmarcAtSubdomain = false;
  try {
    const dmarcTxt = await dns.resolveTxt(`_dmarc.${hostname}`);
    dmarcAtSubdomain = dmarcTxt.flat().some((t) => /^v=dmarc1/i.test(t));
  } catch (_) { /* no record */ }
  if (!hasDmarc && !dmarcAtSubdomain) {
    issues.push({
      severity: 'low',
      type: 'missing-dmarc-record',
      url: targetUrl,
      detail: 'No DMARC record found at _dmarc subdomain — reduces protection against email spoofing/phishing using this domain.',
    });
  }

  if (!records.caa || records.caa.length === 0) {
    issues.push({
      severity: 'low',
      type: 'missing-caa-record',
      url: targetUrl,
      detail: 'No CAA record found — any certificate authority is permitted to issue TLS certs for this domain.',
    });
  }

  if (rdap && rdap.expiresAt) {
    const daysLeft = Math.floor((rdap.expiresAt.getTime() - Date.now()) / 86400000);
    if (daysLeft < 30 && daysLeft >= 0) {
      issues.push({
        severity: 'medium',
        type: 'domain-expiring-soon',
        url: targetUrl,
        detail: `Domain registration expires in ${daysLeft} day(s) (${rdap.expiresAt.toDateString()}).`,
      });
    } else if (daysLeft < 0) {
      issues.push({
        severity: 'high',
        type: 'domain-expired',
        url: targetUrl,
        detail: `Domain registration appears to have expired (${rdap.expiresAt.toDateString()}).`,
      });
    }
  }

  return {
    issues,
    details: {
      records,
      registrar: rdap ? rdap.registrar : null,
      domainExpiresAt: rdap ? rdap.expiresAt : null,
    },
  };
}

module.exports = { checkDnsWhois };
