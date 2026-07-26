/**
 * Curated vulnerability/misconfiguration reference corpus — the retrieval
 * corpus for the RAG pipeline in vectorRag.js. Each entry pairs a detailed,
 * technically-grounded description (attack scenario, real CVE/OWASP
 * references where applicable, remediation) with the kind of finding text
 * our checks actually produce, so TF-IDF retrieval against a live issue's
 * `detail` string reliably surfaces the right entry.
 */
const VULN_KNOWLEDGE_BASE = [
  {
    id: 'csp-missing',
    title: 'Missing Content-Security-Policy',
    text: 'Content-Security-Policy CSP header missing increases risk of XSS cross-site scripting and data injection attacks. Without a CSP, the browser will execute any inline or injected script an attacker manages to place on the page, e.g. via a stored XSS in a comment field or an unsanitized query parameter reflected into the DOM. A CSP acts as a browser-enforced allowlist restricting which script, style, and resource origins are permitted, so even if an attacker injects a script tag it will not execute. Remediation: define a strict CSP starting with default-src self, explicitly allowlist required third-party origins (analytics, CDNs), and avoid unsafe-inline/unsafe-eval.',
  },
  {
    id: 'hsts-missing',
    title: 'Missing Strict-Transport-Security (HSTS)',
    text: 'Missing HSTS header means the site does not enforce HTTPS for future requests, leaving users open to SSL stripping and protocol downgrade attacks on untrusted networks (public WiFi, compromised routers) where an attacker intercepts the first plaintext HTTP request before a redirect to HTTPS happens. HSTS instructs the browser to only ever connect over HTTPS for a specified duration, even if the user types http:// or clicks an http link. Remediation: send Strict-Transport-Security with a max-age of at least 6 months (15768000 seconds) and includeSubDomains, and consider HSTS preload list submission.',
  },
  {
    id: 'clickjacking',
    title: 'Missing X-Frame-Options (clickjacking)',
    text: 'Missing X-Frame-Options header means the site may be vulnerable to clickjacking, where an attacker embeds the page in an invisible iframe on a malicious site and tricks the user into clicking UI elements (like a "claim reward" button positioned over a real "transfer funds" or "delete account" button) while believing they are interacting with the attacker\'s page. Remediation: send X-Frame-Options: DENY or SAMEORIGIN, or the modern equivalent frame-ancestors directive in a Content-Security-Policy.',
  },
  {
    id: 'mime-sniff',
    title: 'Missing X-Content-Type-Options',
    text: 'Missing X-Content-Type-Options header means browsers may MIME-sniff responses, guessing a resource\'s content type from its content rather than trusting the declared Content-Type. This lets an attacker upload a file disguised as an image that is actually interpreted and executed as HTML/JavaScript by the browser, enabling stored XSS via file upload features. Remediation: send X-Content-Type-Options: nosniff on every response so browsers strictly honor the declared Content-Type.',
  },
  {
    id: 'referrer-policy',
    title: 'Missing Referrer-Policy',
    text: 'Missing Referrer-Policy header means full URLs, including sensitive query parameters like session tokens, search terms, or internal paths, may leak to third-party sites via the Referer header whenever a user clicks an outbound link. Remediation: send Referrer-Policy: strict-origin-when-cross-origin (a safe modern default) to limit what is disclosed to external origins.',
  },
  {
    id: 'permissions-policy',
    title: 'Missing Permissions-Policy',
    text: 'Missing Permissions-Policy header means powerful browser features like camera, microphone, and geolocation are not explicitly restricted, so if a third-party script embedded on the page (an ad, a compromised analytics library) is compromised it can attempt to access these APIs. Remediation: send a Permissions-Policy header explicitly disabling features the site does not use, e.g. camera=(), microphone=(), geolocation=().',
  },
  {
    id: 'cookie-flags',
    title: 'Cookie missing Secure/HttpOnly/SameSite flags',
    text: 'Cookies missing Secure, HttpOnly, or SameSite flags are exposed to several attacks: without Secure the cookie can be sent over plain HTTP and intercepted on the network; without HttpOnly the cookie is readable by JavaScript, so a single XSS vulnerability anywhere on the site lets an attacker steal session cookies wholesale; without SameSite the cookie is sent on cross-site requests, enabling CSRF. Remediation: set Secure, HttpOnly, and SameSite=Lax (or Strict) on every session/auth cookie.',
  },
  {
    id: 'no-https',
    title: 'Site served over plain HTTP',
    text: 'Site is served over plain HTTP, not HTTPS, meaning all traffic including any form submissions, login credentials, and cookies travel in cleartext and can be read or modified by anyone on the network path (public WiFi, ISP, nation-state actors). This is the most fundamental transport-layer vulnerability. Remediation: obtain a TLS certificate (e.g. via Let\'s Encrypt, free), redirect all HTTP traffic to HTTPS, and add HSTS.',
  },
  {
    id: 'weak-tls',
    title: 'Weak or deprecated TLS version negotiated',
    text: 'Server negotiated an old TLS version like TLS 1.0 or 1.1, which are deprecated and have known cryptographic weaknesses (e.g. BEAST, POODLE-adjacent issues) and are no longer trusted by modern browsers or PCI-DSS compliance standards. Remediation: disable TLS 1.0/1.1 in the server/load balancer configuration and only allow TLS 1.2 and 1.3.',
  },
  {
    id: 'tls-cert-invalid',
    title: 'Invalid or expired TLS certificate',
    text: 'TLS certificate is not trusted or has expired, which means browsers will show a hard security warning to every visitor, breaking trust and blocking most users outright; an expired certificate also means the encrypted channel can no longer be verified as genuinely belonging to the claimed domain, opening a window for man-in-the-middle attacks if a user manually bypasses the browser warning. Remediation: renew the certificate immediately and set up automated renewal (e.g. certbot) so this cannot recur.',
  },
  {
    id: 'exposed-env',
    title: 'Exposed .env / credentials file',
    text: 'An environment file (.env), .git directory, or credentials/backup file is publicly accessible. These files routinely contain database passwords, API keys, cloud provider secrets, and session signing keys. Public exposure of a .git directory in particular allows an attacker to reconstruct the entire source code history via tools like git-dumper, potentially exposing every secret ever committed even if later removed. This is one of the most severe findings possible — it can lead to full backend compromise. Remediation: remove the file from the web root immediately, rotate every credential it contained, and add server-level rules blocking dotfiles/backup extensions.',
  },
  {
    id: 'vulnerable-jquery',
    title: 'Vulnerable jQuery version',
    text: 'An outdated jQuery version before 3.5.0 is in use, affected by a cross-site scripting vulnerability in jQuery.htmlPrefilter tracked as CVE-2020-11022 and CVE-2020-11023, where untrusted HTML passed to jQuery methods like .html() can execute injected script tags even without explicit eval. Remediation: upgrade to jQuery 3.5.0 or later; downstream plugins may also need updating for compatibility.',
  },
  {
    id: 'vulnerable-bootstrap',
    title: 'Vulnerable Bootstrap version',
    text: 'An outdated Bootstrap version before 4.3.1 is in use, affected by CVE-2019-8331, an XSS vulnerability in the tooltip/popover component\'s data-template attribute that allows an attacker to inject and execute arbitrary script if they control any text rendered into a tooltip. Remediation: upgrade to Bootstrap 4.3.1 or later.',
  },
  {
    id: 'vulnerable-lodash',
    title: 'Vulnerable Lodash version',
    text: 'An outdated Lodash version before 4.17.21 is in use, affected by prototype pollution vulnerabilities CVE-2020-8203 and CVE-2021-23337, where crafted input to functions like merge, mergeWith, or template can pollute Object.prototype, potentially leading to denial of service or, in template usage, remote code execution. Remediation: upgrade to Lodash 4.17.21 or later.',
  },
  {
    id: 'spf-missing',
    title: 'Missing SPF record',
    text: 'No SPF (Sender Policy Framework, v=spf1) TXT record found for the domain, meaning email sent "from" this domain is easier to spoof — attackers can send phishing emails that appear to come from your domain, since there is no DNS record specifying which mail servers are authorized senders. This damages brand trust and email deliverability. Remediation: publish an SPF TXT record listing authorized sending mail servers/services.',
  },
  {
    id: 'dmarc-missing',
    title: 'Missing DMARC record',
    text: 'No DMARC record found at the _dmarc subdomain, which reduces protection against email spoofing and phishing using this domain. DMARC builds on SPF and DKIM to tell receiving mail servers what to do with messages that fail authentication (quarantine, reject) and provides reporting on abuse. Without it, spoofed emails impersonating the domain are more likely to reach recipients\' inboxes. Remediation: publish a DMARC TXT record starting with a monitoring policy (p=none) and tightening to p=quarantine or p=reject over time.',
  },
  {
    id: 'caa-missing',
    title: 'Missing CAA record',
    text: 'No CAA (Certification Authority Authorization) record found, meaning any certificate authority in the world is permitted to issue TLS certificates for this domain. If any CA is compromised or socially engineered, they could issue a fraudulent certificate for this domain, enabling man-in-the-middle attacks against users. Remediation: publish a CAA record restricting issuance to the specific CA(s) actually used (e.g. letsencrypt.org).',
  },
  {
    id: 'domain-expiring',
    title: 'Domain registration expiring soon',
    text: 'Domain registration is expiring soon or has already expired. An expired domain can be immediately re-registered by anyone, including attackers who then control all email, hosted content, and can impersonate the brand entirely — this is a common vector for supply-chain and phishing attacks against former customers. Remediation: renew the domain immediately and enable auto-renewal with a valid, monitored payment method.',
  },
  {
    id: 'broken-link',
    title: 'Broken link or asset (404)',
    text: 'A link or asset returns HTTP 404, meaning the resource no longer exists at that URL. Beyond user experience, broken links can be a security risk if an attacker registers the now-unclaimed destination (e.g. an abandoned third-party script host or a dangling DNS CNAME) and serves malicious content from a URL your site still references. Remediation: fix or remove the dead reference, and audit any broken references to external domains for dangling/takeover risk.',
  },
  {
    id: 'bot-protection',
    title: 'Possible bot protection / rate limiting',
    text: 'Multiple link or asset checks returned 401 Unauthorized, 403 Forbidden, 429 Too Many Requests, or 503 Service Unavailable responses across many different URLs in a short window. This pattern usually indicates the target\'s bot/rate-limit protection (a WAF, Cloudflare, or reverse-proxy rule) is reacting to automated scanning traffic rather than those pages being genuinely broken or misconfigured — a real browser session with cookies and normal request pacing would likely succeed. Remediation: not a defect to fix on the site; re-verify manually with a normal browser session, or re-run the scan with fewer pages/lower concurrency and appropriate authorization if this is expected to be a legitimate crawl.',
  },
  {
    id: 'exposed-server-status',
    title: 'Exposed server status page',
    text: 'An internal diagnostic page like Apache mod_status or phpinfo() is publicly reachable, exposing internal IP addresses, running process details, loaded PHP extensions and configuration, and sometimes environment variables — all reconnaissance information that helps an attacker plan further attacks. Remediation: restrict these diagnostic endpoints to internal/localhost access only, or disable them in production.',
  },
];

module.exports = { VULN_KNOWLEDGE_BASE };
