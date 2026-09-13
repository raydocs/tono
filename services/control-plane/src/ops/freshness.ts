// The full SSH quality sweep runs every 12h (ops-panel/collect.py), unlike
// the 1–5 minute Komari poll. Match the existing verdict/coverage evidence
// window; this timestamp is not a fast collector heartbeat.
export const QUALITY_SWEEP_FRESH_SECONDS = 26 * 3600;
