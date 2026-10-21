import { createHash, createHmac, randomBytes, randomInt } from "node:crypto"

export function createEmailMfaCode() {
  return randomInt(0, 1_000_000).toString().padStart(6, "0")
}

export function createEmailMfaChallengeToken() {
  return randomBytes(32).toString("base64url")
}

export function hashEmailMfaChallengeToken(token: string) {
  return createHash("sha256").update(token).digest("hex")
}

export function hashEmailMfaCode(token: string, code: string) {
  const pepper = process.env.MFA_CODE_PEPPER
  if (!pepper || pepper.length < 32) {
    throw new Error("MFA_CODE_PEPPER must be configured with at least 32 characters.")
  }
  return createHmac("sha256", pepper).update(`${token}:${code}`).digest("hex")
}
