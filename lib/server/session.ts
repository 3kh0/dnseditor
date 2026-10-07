import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "./env";
import { httpError, type Ctx } from "./http";

export const SESSION_COOKIE = "dnseditor_session";
export const OAUTH_STATE_COOKIE = "dnseditor_oauth_state";
const MAX_AGE = 60 * 60 * 24 * 180;

export interface SessionData {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  issuedAt?: number;
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

function sessionKey(): Buffer {
  const secret = env(
    "NUXT_SESSION_SECRET",
    "SESSION_SECRET",
    "NUXT_GITHUB_APP_CLIENT_SECRET",
    "GITHUB_APP_CLIENT_SECRET",
  );

  if (!secret) {
    throw httpError({
      statusCode: 500,
      message: "Missing SESSION_SECRET / GITHUB_APP_CLIENT_SECRET for session encryption",
    });
  }
  return createHash("sha256").update(secret).digest();
}

export function sealAppSession(data: SessionData): string {
  const key = sessionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const pt = Buffer.from(JSON.stringify(data), "utf8");
  const enc = Buffer.concat([cipher.update(pt), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64url");
}

export function unsealAppSession(token: string): SessionData | null {
  try {
    const key = sessionKey();
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

export function setAppSessionCookie(ctx: Ctx, data: SessionData) {
  const next = { ...data, issuedAt: Date.now() };
  ctx.setCookie(SESSION_COOKIE, sealAppSession(next), cookieOpts(MAX_AGE));
  return next;
}

export function touchAppSessionCookie(ctx: Ctx, data: SessionData): SessionData {
  if (data.issuedAt && Date.now() - data.issuedAt < 60 * 60 * 24 * 1000) return data;
  return setAppSessionCookie(ctx, data);
}

export function clearAppSessionCookie(ctx: Ctx) {
  ctx.deleteCookie(SESSION_COOKIE);
}

export function getAppSession(ctx: Ctx): SessionData | null {
  const raw = ctx.getCookie(SESSION_COOKIE);
  return raw ? unsealAppSession(raw) : null;
}

export function setOAuthStateCookie(ctx: Ctx, payload: OAuthStatePayload) {
  const sealed = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  ctx.setCookie(OAUTH_STATE_COOKIE, sealed, cookieOpts(60 * 10));
  return sealed;
}

export function consumeOAuthStateCookie(ctx: Ctx): OAuthStatePayload | null {
  const raw = ctx.getCookie(OAUTH_STATE_COOKIE);
  ctx.deleteCookie(OAUTH_STATE_COOKIE);
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
