/**
 * Risk Score: a weighted composite derived from each finding's severity —
 * distinct from Performance Score (which only measures load time/payload/
 * image count, nothing about security/content risk). A page can load fast
 * and still score low here if it has serious findings.
 *
 * This is honest about what it is: a weighted feature vector (severity
 * counts as features, fixed weights as coefficients), not a trained model.
 * There's no labeled dataset of "known good/bad sites" to train a real
 * classifier or KNN against here — building one from nothing would just be
 * decoration. What *is* genuinely unsupervised and valid at this data
 * scale is peer-relative z-scoring against discovered competitors (below).
 */
const SEVERITY_WEIGHT = { high: 12, medium: 4, low: 1 };

function computeRiskScore(issues) {
  const penalty = issues.reduce((sum, i) => sum + (SEVERITY_WEIGHT[i.severity] ?? 1), 0);
  return Math.max(0, Math.round(100 - penalty));
}

function mean(values) {
  return values.reduce((s, v) => s + v, 0) / values.length;
}
function stddev(values, avg) {
  const variance = values.reduce((s, v) => s + (v - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Peer-relative anomaly detection: z-score the target's issue count and
 * risk score against its discovered/compared competitor cohort. With only
 * a handful of peers this is a small sample, so it's reported as a
 * directional signal ("more issues than your peer average"), not a
 * precise statistical claim.
 */
function peerRelativeStats(target, competitors) {
  if (!competitors || competitors.length < 2) return null; // too few peers for a meaningful comparison

  const cohort = [target, ...competitors];
  const issueCounts = cohort.map((c) => c.issues.length);
  const riskScores = cohort.map((c) => c.riskScore ?? computeRiskScore(c.issues));

  const issueMean = mean(issueCounts);
  const issueStd = stddev(issueCounts, issueMean) || 1;
  const riskMean = mean(riskScores);
  const riskStd = stddev(riskScores, riskMean) || 1;

  const targetIssueZ = (issueCounts[0] - issueMean) / issueStd;
  const targetRiskZ = (riskScores[0] - riskMean) / riskStd;

  return {
    peerCount: competitors.length,
    issueCountVsPeerAvg: issueMean ? Math.round(((issueCounts[0] - issueMean) / issueMean) * 100) : 0,
    isIssueOutlier: Math.abs(targetIssueZ) >= 1.5,
    issueZScore: Number(targetIssueZ.toFixed(2)),
    isRiskOutlier: Math.abs(targetRiskZ) >= 1.5,
    riskZScore: Number(targetRiskZ.toFixed(2)),
  };
}

module.exports = { computeRiskScore, peerRelativeStats };
