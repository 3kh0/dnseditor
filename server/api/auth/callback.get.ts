import {
  exchangeOAuthCode,
  fetchGitHubUser,
  getAppBaseUrl,
  getGitHubAppConfig,
} from "../../utils/github";
import {
  consumeOAuthStateCookie,
  sanitizeReturnTo,
  setAppSessionCookie,
  type OAuthStatePayload,
} from "../../utils/session";

export default defineEventHandler(async (event) => {
  const q = getQuery(event);
  const code = typeof q.code === "string" ? q.code : "";
  const state = typeof q.state === "string" ? q.state : "";
  const oauthError = typeof q.error === "string" ? q.error : "";

  const base = getAppBaseUrl(event);
  const expected = consumeOAuthStateCookie(event);
  const returnTo = sanitizeReturnTo(expected?.r);
  const fail = (msg: string) =>
    sendRedirect(event, `${base}/?authError=${encodeURIComponent(msg)}`, 302);

  if (oauthError) {
    return fail(
      typeof q.error_description === "string"
        ? q.error_description
        : "GitHub authorization was denied",
    );
  }

  if (!code || !state || !expected || !oauthStateMatches(state, expected)) {
    return fail("Invalid OAuth state. Try signing in again.");
  }

  try {
    getGitHubAppConfig(event);
    const tokens = await exchangeOAuthCode(event, code, expected.v);
    const user = await fetchGitHubUser(tokens.accessToken);

    setAppSessionCookie(event, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresIn ? Date.now() + tokens.expiresIn * 1000 : undefined,
      login: user.login,
      name: user.name,
      avatarUrl: user.avatarUrl,
    });

    return sendRedirect(event, `${base}${returnTo}`, 302);
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
