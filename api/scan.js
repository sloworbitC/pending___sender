export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  res.status(200).json([{ content: "Backend alive - no crash", sensitive_terms: [], sensitive_patterns: {} }]);
}
