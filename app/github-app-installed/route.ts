import { NextResponse } from "next/server";
import { getAppBaseUrl } from "@/lib/server/github";
import { route } from "@/lib/server/http";

export const GET = route((ctx) => {
  const editorUrl = getAppBaseUrl(ctx);
  const editorOrigin = new URL(editorUrl).origin;
  const serializedUrl = JSON.stringify(editorUrl);
  const serializedOrigin = JSON.stringify(editorOrigin);

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Returning to DNS Editor</title>
  </head>
  <body>
    <p>GitHub App installed. Returning to DNS Editor…</p>
    <script>
      const editorUrl = ${serializedUrl};
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(
          { type: "dns-editor:github-app-installed" },
          ${serializedOrigin},
        );
        window.close();
      }
      setTimeout(() => window.location.replace(editorUrl), 250);
    </script>
  </body>
</html>`;

  return new NextResponse(html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
});
