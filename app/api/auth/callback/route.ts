import {
  exchangeOAuthCode,
  fetchGitHubUser,
  getAppBaseUrl,
  getGitHubAppConfig,
} from "@/lib/server/github";
import { redirect, route } from "@/lib/server/http";
import {
  consumeOAuthStateCookie,
  sanitizeReturnTo,
  setAppSessionCookie,
  type OAuthStatePayload,
} from "@/lib/server/session";

export const GET = route(async (ctx) => {
  const code = ctx.query("code") ?? "";
  const state = ctx.query("state") ?? "";
  const oauthError = ctx.query("error") ?? "";

  const base = getAppBaseUrl(ctx);
  const expected = consumeOAuthStateCookie(ctx);
  const returnTo = sanitizeReturnTo(expected?.r);
  const fail = (msg: string) => redirect(`${base}/?authError=${encodeURIComponent(msg)}`);

  if (oauthError) {
    return fail(ctx.query("error_description") ?? "GitHub authorization was denied");
  }

  if (!code || !state || !expected || !oauthStateMatches(state, expected)) {
    return fail("Invalid OAuth state. Try signing in again.");
  }

  try {
    getGitHubAppConfig();
    const tokens = await exchangeOAuthCode(ctx, code, expected.v);
    const user = await fetchGitHubUser(tokens.accessToken);

    setAppSessionCookie(ctx, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresIn ? Date.now() + tokens.expiresIn * 1000 : undefined,
      login: user.login,
      name: user.name,
      avatarUrl: user.avatarUrl,
    });

    return redirect(`${base}${returnTo}`);
  } catch (e) {
    const msg =
      e && typeof e === "object" && "message" in e
        ? String((e as { message: unknown }).message)
        : "Sign-in failed";
    return fail(msg);
  }
});

function oauthStateMatches(state: string, expected: OAuthStatePayload): boolean {
  const resealed = Buffer.from(
    JSON.stringify({ n: expected.n, r: expected.r, v: expected.v }),
    "utf8",
  ).toString("base64url");
  if (state === resealed) return true;

  try {
    const from = JSON.parse(Buffer.from(state, "base64url").toString("utf8")) as {
      n?: string;
      v?: string;
    };
    return from.n === expected.n && from.v === expected.v;
  } catch {
    return false;
  }
}
