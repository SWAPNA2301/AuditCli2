const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

/**
 * Disk cache for AI analysis responses, keyed by a hash of the exact prompt.
 *
 * The local RAG retrieval is free, but the model call is the rate-limited,
 * billable part — and re-scanning a site whose findings haven't changed
 * produces a byte-identical prompt. Caching on the prompt hash means a repeat
 * scan of an unchanged site costs zero API requests, while any change to the
 * findings (new issue, different severity, changed score) yields a different
 * hash and so correctly triggers a fresh call.
 */
const CACHE_FILE = path.join(os.tmpdir(), 'auditcli-ai-cache.json');
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // a week — long enough to help, short enough that advice refreshes
const MAX_ENTRIES = 200;

function promptKey(prompt) {
  return crypto.createHash('sha256').update(prompt).digest('hex');
}

function readCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch (_) {
    return {};
  }
}

function writeCache(cache) {
  try {
    // Keep the file bounded: drop the oldest entries past the cap.
    const entries = Object.entries(cache).sort((a, b) => (b[1].cachedAt || 0) - (a[1].cachedAt || 0));
    fs.writeFileSync(CACHE_FILE, JSON.stringify(Object.fromEntries(entries.slice(0, MAX_ENTRIES))), 'utf8');
  } catch (_) {
    /* cache is best-effort — never fail a scan over it */
  }
}

function getCached(prompt) {
  const entry = readCache()[promptKey(prompt)];
  if (!entry) return null;
  if (Date.now() - (entry.cachedAt || 0) > TTL_MS) return null;
  return entry.value;
}

function setCached(prompt, value) {
  const cache = readCache();
  cache[promptKey(prompt)] = { value, cachedAt: Date.now() };
  writeCache(cache);
}

function clearCache() {
  try {
    fs.unlinkSync(CACHE_FILE);
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = { getCached, setCached, clearCache, CACHE_FILE };
