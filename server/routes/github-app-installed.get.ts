import { getAppBaseUrl } from "../utils/github";

export default defineEventHandler((event) => {
  setHeader(event, "content-type", "text/html; charset=utf-8");
  setHeader(event, "cache-control", "no-store");

  const editorUrl = getAppBaseUrl(event);
  const editorOrigin = new URL(editorUrl).origin;
  const serializedUrl = JSON.stringify(editorUrl);
  const serializedOrigin = JSON.stringify(editorOrigin);

  return `<!doctype html>
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
});
