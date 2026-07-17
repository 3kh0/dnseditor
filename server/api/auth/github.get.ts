import { createHash, randomBytes } from "node:crypto";
import { getAppBaseUrl, getGitHubAppConfig } from "../../utils/github";
import { sanitizeReturnTo, setOAuthStateCookie } from "../../utils/session";

export default defineEventHandler((event) => {
  const { clientId } = getGitHubAppConfig(event);
  const returnTo = sanitizeReturnTo(getQuery(event).returnTo);

  const codeVerifier = randomBytes(32).toString("base64url");
  const stateParam = setOAuthStateCookie(event, {
    n: randomBytes(24).toString("hex"),
    r: returnTo,
    v: codeVerifier,
  });

  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", `${getAppBaseUrl(event)}/api/auth/callback`);
  url.searchParams.set("state", stateParam);
  url.searchParams.set(
    "code_challenge",
    createHash("sha256").update(codeVerifier).digest("base64url"),
  );
  url.searchParams.set("code_challenge_method", "S256");

  return sendRedirect(event, url.toString(), 302);
});
