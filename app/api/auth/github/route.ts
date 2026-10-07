import { createHash, randomBytes } from "node:crypto";
import { getAppBaseUrl, getGitHubAppConfig } from "@/lib/server/github";
import { redirect, route } from "@/lib/server/http";
import { sanitizeReturnTo, setOAuthStateCookie } from "@/lib/server/session";

export const GET = route((ctx) => {
  const { clientId } = getGitHubAppConfig();
  const returnTo = sanitizeReturnTo(ctx.query("returnTo"));

  const codeVerifier = randomBytes(32).toString("base64url");
  const stateParam = setOAuthStateCookie(ctx, {
    n: randomBytes(24).toString("hex"),
    r: returnTo,
    v: codeVerifier,
  });

  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", `${getAppBaseUrl(ctx)}/api/auth/callback`);
  url.searchParams.set("state", stateParam);
  url.searchParams.set(
    "code_challenge",
    createHash("sha256").update(codeVerifier).digest("base64url"),
  );
  url.searchParams.set("code_challenge_method", "S256");

  return redirect(url.toString());
});
