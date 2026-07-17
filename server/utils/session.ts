import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { H3Event } from "h3";

export const SESSION_COOKIE = "dnseditor_session";
export const OAUTH_STATE_COOKIE = "dnseditor_oauth_state";
const MAX_AGE = 60 * 60 * 24 * 30;

export interface SessionData {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  login: string;
  name?: string | null;
  avatarUrl?: string | null;
}

export interface OAuthStatePayload {
  n: string;
  r: string;
  v: string;
}

const cookieOpts = (maxAge: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge,
});

function sessionKey(event: H3Event): Buffer {
  const c = useRuntimeConfig(event);
  const secret =
    (typeof c.sessionSecret === "string" && c.sessionSecret) ||
    process.env.NUXT_SESSION_SECRET ||
    process.env.SESSION_SECRET ||
    (typeof c.githubAppClientSecret === "string" && c.githubAppClientSecret) ||
    process.env.NUXT_GITHUB_APP_CLIENT_SECRET ||
    process.env.GITHUB_APP_CLIENT_SECRET ||
    "";

  if (!secret) {
    throw createError({
      statusCode: 500,
      message: "Missing SESSION_SECRET / GITHUB_APP_CLIENT_SECRET for session encryption",
    });
  }
  return createHash("sha256").update(secret).digest();
}

export function sealAppSession(event: H3Event, data: SessionData): string {
  const key = sessionKey(event);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const pt = Buffer.from(JSON.stringify(data), "utf8");
  const enc = Buffer.concat([cipher.update(pt), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64url");
}

export function unsealAppSession(event: H3Event, token: string): SessionData | null {
  try {
    const key = sessionKey(event);
    const buf = Buffer.from(token, "base64url");
    if (buf.length < 28) return null;

    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const data = JSON.parse(
      Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8"),
    ) as SessionData;

    return data?.accessToken && data?.login ? data : null;
  } catch {
    return null;
  }
}

export function setAppSessionCookie(event: H3Event, data: SessionData) {
  setCookie(event, SESSION_COOKIE, sealAppSession(event, data), cookieOpts(MAX_AGE));
}

export function clearAppSessionCookie(event: H3Event) {
  deleteCookie(event, SESSION_COOKIE, { path: "/" });
}

export function getAppSession(event: H3Event): SessionData | null {
  const raw = getCookie(event, SESSION_COOKIE);
  return raw ? unsealAppSession(event, raw) : null;
}

export function setOAuthStateCookie(event: H3Event, payload: OAuthStatePayload) {
  const sealed = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  setCookie(event, OAUTH_STATE_COOKIE, sealed, cookieOpts(60 * 10));
  return sealed;
}

export function consumeOAuthStateCookie(event: H3Event): OAuthStatePayload | null {
  const raw = getCookie(event, OAUTH_STATE_COOKIE);
  deleteCookie(event, OAUTH_STATE_COOKIE, { path: "/" });
  if (!raw) return null;
  try {
    const p = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as OAuthStatePayload;
    if (!p?.n || !p?.v) return null;
    if (typeof p.r !== "string") p.r = "/";
    return p;
  } catch {
    return null;
  }
}

/** Safe in-app return path (path-only, no open redirect). */
export function sanitizeReturnTo(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("://")
  ) {
    return "/";
  }
  return value.slice(0, 512);
}
