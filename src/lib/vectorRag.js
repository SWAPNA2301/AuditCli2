const { VULN_KNOWLEDGE_BASE } = require('./vulnKnowledgeBase');

/**
 * Retrieval layer for a small RAG (Retrieval-Augmented Generation) pipeline:
 * turns each knowledge-base entry and each live finding into a TF-IDF
 * vector in the same term space, then retrieves by cosine similarity.
 * This is the classic vector-space information-retrieval model — the same
 * underlying idea a vector database like Qdrant provides as a hosted
 * service, implemented in-process so the CLI needs zero extra
 * infrastructure (no server/Docker/API key) to get real retrieval.
 */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'to', 'of', 'in',
  'on', 'for', 'and', 'or', 'this', 'that', 'it', 'its', 'as', 'by', 'with', 'not', 'no',
  'at', 'from', 'may', 'can', 'will', 'has', 'have', 'had', 'if', 'so', 'than', 'then',
]);

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9.\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

function termFrequencies(tokens) {
  const tf = new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  return tf;
}

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (const [term, weight] of a) {
    normA += weight * weight;
    if (b.has(term)) dot += weight * b.get(term);
  }
  for (const weight of b.values()) normB += weight * weight;
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Builds a TF-IDF index over the given corpus once. Reused across a whole
 * scan (many issues get embedded against the same index) rather than
 * rebuilt per lookup.
 */
function buildIndex(corpus) {
  const docTokens = corpus.map((doc) => tokenize(doc.text + ' ' + doc.title));
  const df = new Map(); // document frequency per term
  docTokens.forEach((tokens) => {
    new Set(tokens).forEach((t) => df.set(t, (df.get(t) || 0) + 1));
  });
  const n = corpus.length;
  const idf = new Map();
  for (const [term, count] of df.entries()) idf.set(term, Math.log((n + 1) / (count + 1)) + 1);

  const vectors = docTokens.map((tokens) => {
    const tf = termFrequencies(tokens);
    const vec = new Map();
    for (const [term, freq] of tf.entries()) vec.set(term, freq * (idf.get(term) || 1));
    return vec;
  });

  return { corpus, vectors, idf };
}

function vectorizeQuery(index, text) {
  const tokens = tokenize(text);
  const tf = termFrequencies(tokens);
  const vec = new Map();
  for (const [term, freq] of tf.entries()) vec.set(term, freq * (index.idf.get(term) || 1));
  return vec;
}

/**
 * Retrieves the top-k most similar knowledge-base entries for a query
 * string (typically a finding's `detail` text). Returns [] if nothing
 * clears a minimal similarity floor, so callers can fall back cleanly
 * instead of citing an irrelevant match.
 */
function retrieve(index, queryText, { k = 1, minScore = 0.12 } = {}) {
  const queryVec = vectorizeQuery(index, queryText);
  const scored = index.corpus.map((doc, i) => ({ doc, score: cosineSimilarity(queryVec, index.vectors[i]) }));
  return scored
    .filter((s) => s.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

let cachedVulnIndex = null;
function getVulnKnowledgeIndex() {
  if (!cachedVulnIndex) cachedVulnIndex = buildIndex(VULN_KNOWLEDGE_BASE);
  return cachedVulnIndex;
}

module.exports = { buildIndex, retrieve, getVulnKnowledgeIndex };
