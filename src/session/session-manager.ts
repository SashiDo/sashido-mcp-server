import { getRedisClient, isRedisConfigured } from "./redis-client.js";
import { appConfig } from "../config.js";
import type { SessionMetadata } from "./types.js";

// SSE sessions only: Streamable HTTP is stateless. A session remembers the
// hash of the token that opened it, so messages posted to it must come with
// the same token, on whichever instance they arrive.

const KEY_PREFIX = "mcp:";
const ttlMs = () => appConfig.redis.sessionTtlSeconds * 1000;

const inMemorySessions = new Map<string, SessionMetadata>();

// in-memory sessions expire like the Redis ones
setInterval(() => {
  const now = Date.now();
  inMemorySessions.forEach((session, id) => {
    if (now - session.lastAccessedAt > ttlMs()) {
      inMemorySessions.delete(id);
    }
  });
}, 60 * 1000).unref();

export async function registerSession(
  sessionId: string,
  tokenHash: string,
): Promise<void> {
  const metadata: SessionMetadata = {
    sessionId,
    createdAt: Date.now(),
    lastAccessedAt: Date.now(),
    transportType: "sse",
    tokenHash,
  };

  if (isRedisConfigured()) {
    const redis = await getRedisClient();
    if (redis) {
      await redis.setEx(
        `${KEY_PREFIX}session:${sessionId}`,
        appConfig.redis.sessionTtlSeconds,
        JSON.stringify(metadata),
      );
      return;
    }
  }
  inMemorySessions.set(sessionId, metadata);
}

/** The session if it exists, refreshing its expiry; null otherwise. */
export async function touchSession(
  sessionId: string,
): Promise<SessionMetadata | null> {
  if (isRedisConfigured()) {
    const redis = await getRedisClient();
    if (redis) {
      const key = `${KEY_PREFIX}session:${sessionId}`;
      const data = await redis.get(key);
      if (!data) return null;
      const metadata = JSON.parse(data) as SessionMetadata;
      metadata.lastAccessedAt = Date.now();
      await redis.setEx(
        key,
        appConfig.redis.sessionTtlSeconds,
        JSON.stringify(metadata),
      );
      return metadata;
    }
  }

  const session = inMemorySessions.get(sessionId);
  if (!session || Date.now() - session.lastAccessedAt > ttlMs()) {
    inMemorySessions.delete(sessionId);
    return null;
  }
  session.lastAccessedAt = Date.now();
  return session;
}

export async function deleteSession(sessionId: string): Promise<void> {
  if (isRedisConfigured()) {
    const redis = await getRedisClient();
    if (redis) {
      await redis.del(`${KEY_PREFIX}session:${sessionId}`);
      return;
    }
  }
  inMemorySessions.delete(sessionId);
}
