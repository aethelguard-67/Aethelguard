export function calculateThreatScore(malicious: number, suspicious: number, totalEngines: number) {
  if (totalEngines === 0) return null
  return Math.round(((malicious + suspicious * 0.5) / totalEngines) * 100)
}
