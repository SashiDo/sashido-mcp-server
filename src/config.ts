import { config } from "dotenv";
import { z } from "zod";

config();

const list = (value?: string) =>
  (value || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

const envSchema = z.object({
  SASHIDO_API_URL: z.string().url().default("https://api.sashido.io"),
  // stdio only: the personal access token of the local user. Over HTTP
  // every request brings its own token and nothing else is used.
  SASHIDO_ACCESS_TOKEN: z.string().optional(),
  // stdio only: narrow what the token allows, like the URL options over HTTP
  SASHIDO_READ_ONLY: z.string().optional(),
  SASHIDO_APPS: z.string().optional(),
  SASHIDO_FEATURES: z.string().optional(),

  // HTTP: listen on localhost unless a deployment says otherwise
  HOST: z.string().default("127.0.0.1"),
  // PORT is the standard env var for container platforms (S2I, Heroku, etc.)
  PORT: z.coerce.number().optional(),
  MCP_SERVER_PORT: z.coerce.number().default(3100),
  // browser origins allowed to call the server (CORS and the DNS rebinding
  // check); clients that aren't browsers send no Origin
  ALLOWED_ORIGINS: z.string().optional(),
  // behind a load balancer: trust X-Forwarded-For for the client IP
  TRUST_PROXY: z.string().optional(),
  // requests per minute per client IP
  RATE_LIMIT_PER_MINUTE: z.coerce.number().default(300),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  // Redis lets SSE connections on one instance receive the messages posted
  // to another (optional - falls back to in-memory for a single instance)
  REDIS_URL: z.string().url().optional(),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.coerce.number().min(0).max(15).default(0),
  SESSION_TTL_SECONDS: z.coerce.number().default(3600),
});

const parseResult = envSchema.safeParse(process.env);

if (!parseResult.success) {
  console.error("Invalid environment configuration:");
  console.error(parseResult.error.format());
  process.exit(1);
}

const env = parseResult.data;

export const appConfig = {
  sashido: {
    apiUrl: env.SASHIDO_API_URL,
  },
  stdio: {
    accessToken: env.SASHIDO_ACCESS_TOKEN,
    readOnly: env.SASHIDO_READ_ONLY,
    apps: env.SASHIDO_APPS,
    features: env.SASHIDO_FEATURES,
  },
  server: {
    host: env.HOST,
    // PORT takes precedence (standard for S2I/containers), fallback to MCP_SERVER_PORT
    port: env.PORT ?? env.MCP_SERVER_PORT,
    allowedOrigins: list(env.ALLOWED_ORIGINS),
    trustProxy: env.TRUST_PROXY === "true" || env.TRUST_PROXY === "1",
    rateLimitPerMinute: env.RATE_LIMIT_PER_MINUTE,
  },
  redis: {
    url: env.REDIS_URL,
    password: env.REDIS_PASSWORD,
    db: env.REDIS_DB,
    sessionTtlSeconds: env.SESSION_TTL_SECONDS,
  },
  logLevel: env.LOG_LEVEL,
} as const;

export type AppConfig = typeof appConfig;
