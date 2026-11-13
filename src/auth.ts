import { createHash } from "crypto";
import { Access } from "./access.js";
import { SashidoApiError, SashidoClient, TokenInfo } from "./client/sashido.js";

// sashido_pat_<30 random><6 checksum> (sashido-api lib/accessTokens/format.ts)
const ACCESS_TOKEN_PATTERN = /^sashido_pat_[0-9A-Za-z]{36}$/;

// how long what the API said about a token is reused; a revoked token keeps
// working here at most this long (the API refuses it right away)
const TOKEN_INFO_TTL_MS = 60 * 1000;
const MAX_CACHED_TOKENS = 10000;

export class AuthError extends Error {
  constructor(
    message: string,
    public statusCode: number = 401,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export function isAccessToken(value: string): boolean {
  return ACCESS_TOKEN_PATTERN.test(value);
}

/** The token of an `Authorization: Bearer` header. */
export function bearerToken(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(value || "");
  if (!match || !isAccessToken(match[1]!)) {
    throw new AuthError(
      "Send a SashiDo personal access token as Authorization: Bearer sashido_pat_... " +
        "Create one in the dashboard: Account > Access Tokens.",
    );
  }
  return match[1]!;
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const cache = new Map<string, { info: TokenInfo; expiresAt: number }>();

/** What the API says about the token (scopes, apps), briefly cached. */
export async function getTokenInfo(
  token: string,
  apiUrl?: string,
): Promise<TokenInfo> {
  const key = tokenHash(token);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.info;
  }

  let info: TokenInfo;
  try {
    info = await new SashidoClient(token, apiUrl).getTokenInfo();
  } catch (e) {
    // SashidoClient turns API errors into SashidoApiError with the status
    if (e instanceof SashidoApiError && (e.statusCode === 401 || e.statusCode === 403)) {
      throw new AuthError("The access token is invalid, expired or revoked.");
    }
    throw e;
  }

  if (cache.size >= MAX_CACHED_TOKENS) {
    cache.clear();
  }
  cache.set(key, { info, expiresAt: Date.now() + TOKEN_INFO_TTL_MS });
  return info;
}

/** The access a token gives, before any options narrow it. */
export function accessFromTokenInfo(info: TokenInfo, local: boolean): Access {
  return {
    scopes: info.scopes,
    appIds: info.appIds,
    readOnly: false,
    groups: null,
    local,
  };
}

/** For tests */
export function clearTokenInfoCache(): void {
  cache.clear();
}
