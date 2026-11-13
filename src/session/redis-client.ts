import { createClient, RedisClientType } from "redis";
import { appConfig } from "../config.js";

let redisClient: RedisClientType | null = null;
let connectionPromise: Promise<RedisClientType | null> | null = null;
let isConnecting = false;
let connectionAttempts = 0;
const MAX_RETRY_ATTEMPTS = 5;
const RETRY_DELAY_MS = 2000;

/**
 * Get or create the Redis client singleton.
 * Returns null if REDIS_URL is not configured or connection fails.
 */
export async function getRedisClient(): Promise<RedisClientType | null> {
  if (!appConfig.redis.url) {
    return null;
  }

  // Return existing healthy connection
  if (redisClient?.isOpen) {
    return redisClient;
  }

  // If already connecting, wait for that attempt
  if (connectionPromise) {
    return connectionPromise;
  }

  // Start new connection attempt
  connectionPromise = connectRedis();
  const result = await connectionPromise;
  connectionPromise = null;
  return result;
}

async function connectRedis(): Promise<RedisClientType | null> {
  if (isConnecting) return null;
  isConnecting = true;

  try {
    const client = createClient({
      url: appConfig.redis.url,
      password: appConfig.redis.password,
      database: appConfig.redis.db,
      socket: {
        connectTimeout: 5000,
        reconnectStrategy: (retries) => {
          if (retries >= MAX_RETRY_ATTEMPTS) {
            console.error(
              `[Redis] Max reconnection attempts (${MAX_RETRY_ATTEMPTS}) reached`,
            );
            return new Error("Max reconnection attempts reached");
          }
          const delay = Math.min(retries * 500, 3000);
          console.error(
            `[Redis] Reconnecting in ${delay}ms (attempt ${retries + 1}/${MAX_RETRY_ATTEMPTS})`,
          );
          return delay;
        },
      },
    });

    client.on("error", (err) => {
      console.error("[Redis] Error:", err.message);
    });

    client.on("reconnecting", () => {
      console.error("[Redis] Reconnecting...");
    });

    client.on("ready", () => {
      connectionAttempts = 0;
      console.error("[Redis] Connection ready");
    });

    client.on("end", () => {
      console.error("[Redis] Connection ended");
      redisClient = null;
    });

    await client.connect();
    console.error("[Redis] Connected to", appConfig.redis.url);

    redisClient = client as RedisClientType;
    connectionAttempts = 0;
    return redisClient;
  } catch (err) {
    connectionAttempts++;
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(
      `[Redis] Connection failed (attempt ${connectionAttempts}): ${message}`,
    );

    if (connectionAttempts < MAX_RETRY_ATTEMPTS) {
      console.error(`[Redis] Will retry in ${RETRY_DELAY_MS}ms...`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      isConnecting = false;
      return connectRedis();
    }

    console.error(
      "[Redis] Giving up after max retries, falling back to in-memory",
    );
    return null;
  } finally {
    isConnecting = false;
  }
}

/**
 * Check if Redis is configured
 */
export function isRedisConfigured(): boolean {
  return !!appConfig.redis.url;
}

/**
 * Check if Redis is connected and healthy
 */
export function isRedisConnected(): boolean {
  return redisClient?.isOpen ?? false;
}

/**
 * Ping Redis to check health
 */
export async function pingRedis(): Promise<boolean> {
  try {
    const client = await getRedisClient();
    if (!client) return false;
    const result = await client.ping();
    return result === "PONG";
  } catch {
    return false;
  }
}

/**
 * Gracefully close Redis connection
 */
export async function closeRedisConnection(): Promise<void> {
  if (redisClient?.isOpen) {
    try {
      await redisClient.quit();
      console.error("[Redis] Connection closed gracefully");
    } catch (err) {
      console.error("[Redis] Error closing connection:", err);
      // Force disconnect if graceful quit fails
      redisClient.disconnect();
    }
  }
  redisClient = null;
  connectionPromise = null;
  connectionAttempts = 0;
}
