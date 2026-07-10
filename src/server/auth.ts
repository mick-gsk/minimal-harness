import { createHash, timingSafeEqual } from "node:crypto";

/**
 * API-key auth for the agent server. Keys map to user ids; comparison runs
 * over SHA-256 digests with timingSafeEqual, so neither content nor length
 * of configured keys leaks through timing.
 */
export class ApiKeyAuth {
  private readonly entries: Array<{ digest: Buffer; userId: string }>;

  constructor(apiKeys: Record<string, string>) {
    this.entries = Object.entries(apiKeys).map(([key, userId]) => ({
      digest: sha256(key),
      userId,
    }));
  }

  /** Resolves an Authorization header to a user id, or null when invalid. */
  resolveUser(authorizationHeader: string | undefined): string | null {
    if (!authorizationHeader?.startsWith("Bearer ")) return null;
    const digest = sha256(authorizationHeader.slice("Bearer ".length));
    for (const entry of this.entries) {
      if (timingSafeEqual(digest, entry.digest)) return entry.userId;
    }
    return null;
  }
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}
