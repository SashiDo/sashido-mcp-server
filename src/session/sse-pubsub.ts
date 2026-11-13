import { createClient, RedisClientType } from "redis";
import { appConfig } from "../config.js";
import { isRedisConfigured } from "./redis-client.js";

type MessageHandler = (message: string) => void;

// Separate client for pub/sub (required by Redis - can't use same connection)
let subscriberClient: RedisClientType | null = null;
let publisherClient: RedisClientType | null = null;

// Local subscriptions: sessionId -> handler
const localSubscriptions = new Map<string, MessageHandler>();

// In-memory fallback for non-Redis mode
const inMemoryQueues = new Map<string, string[]>();

const CHANNEL_PREFIX = "mcp:sse:";

/**
 * Initialize pub/sub clients
 */
async function ensureClients(): Promise<boolean> {
  if (!isRedisConfigured() || !appConfig.redis.url) {
    return false;
  }

  if (subscriberClient?.isOpen && publisherClient?.isOpen) {
    return true;
  }

  try {
    const config = {
      url: appConfig.redis.url,
      password: appConfig.redis.password,
      database: appConfig.redis.db,
    };

    if (!subscriberClient?.isOpen) {
      subscriberClient = createClient(config) as RedisClientType;
      subscriberClient.on("error", (err) => {
        console.error("[SSE PubSub] Subscriber error:", err.message);
      });
      await subscriberClient.connect();
    }

    if (!publisherClient?.isOpen) {
      publisherClient = createClient(config) as RedisClientType;
      publisherClient.on("error", (err) => {
        console.error("[SSE PubSub] Publisher error:", err.message);
      });
      await publisherClient.connect();
    }

    console.error("[SSE PubSub] Connected");
    return true;
  } catch (err) {
    console.error("[SSE PubSub] Connection failed:", err);
    return false;
  }
}

/**
 * Subscribe to messages for a session
 */
export async function subscribeToSession(
  sessionId: string,
  handler: MessageHandler,
): Promise<void> {
  localSubscriptions.set(sessionId, handler);

  const redisAvailable = await ensureClients();
  if (redisAvailable && subscriberClient) {
    const channel = `${CHANNEL_PREFIX}${sessionId}`;
    await subscriberClient.subscribe(channel, (message) => {
      const localHandler = localSubscriptions.get(sessionId);
      if (localHandler) {
        localHandler(message);
      }
    });
  }
}

/**
 * Unsubscribe from a session
 */
export async function unsubscribeFromSession(sessionId: string): Promise<void> {
  localSubscriptions.delete(sessionId);
  inMemoryQueues.delete(sessionId);

  if (subscriberClient?.isOpen) {
    const channel = `${CHANNEL_PREFIX}${sessionId}`;
    await subscriberClient.unsubscribe(channel).catch(() => {});
  }
}

/**
 * Publish a message to a session (can be on any server)
 */
export async function publishToSession(
  sessionId: string,
  message: string,
): Promise<boolean> {
  // Try local first (same server optimization)
  const localHandler = localSubscriptions.get(sessionId);
  if (localHandler) {
    localHandler(message);
    return true;
  }

  // Try Redis pub/sub
  const redisAvailable = await ensureClients();
  if (redisAvailable && publisherClient) {
    const channel = `${CHANNEL_PREFIX}${sessionId}`;
    const receivers = await publisherClient.publish(channel, message);
    return receivers > 0;
  }

  // Fallback: queue in memory (only works for same server)
  const queue = inMemoryQueues.get(sessionId) ?? [];
  queue.push(message);
  inMemoryQueues.set(sessionId, queue);
  return false;
}

/**
 * Check if a session has a local subscriber (SSE connection on this server)
 */
export function hasLocalSubscriber(sessionId: string): boolean {
  return localSubscriptions.has(sessionId);
}

/**
 * Close pub/sub connections
 */
export async function closePubSub(): Promise<void> {
  localSubscriptions.clear();
  inMemoryQueues.clear();

  if (subscriberClient?.isOpen) {
    await subscriberClient.quit().catch(() => {});
    subscriberClient = null;
  }
  if (publisherClient?.isOpen) {
    await publisherClient.quit().catch(() => {});
    publisherClient = null;
  }
}
