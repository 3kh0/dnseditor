import { strict as assert } from "node:assert";
import { test } from "node:test";
import { ApiError, errCode, errInstallUrl } from "./api";
import { readSubmitProgress, submitWithProgress } from "./submit";

function responseFor(events: unknown[]) {
  return new Response(events.map((event) => JSON.stringify(event)).join("\n") + "\n");
}

test("reports progress before completion, including split UTF-8 and combined events", async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
    }),
  );
  const messages: string[] = [];
  let notify!: () => void;
  const progress = new Promise<void>((resolve) => {
    notify = resolve;
  });
  const result = readSubmitProgress(response, (message) => {
    messages.push(message);
    notify();
  });
  const bytes = new TextEncoder().encode(
    JSON.stringify({ type: "progress", message: "Making changes…" }) + "\n",
  );
  const split = bytes.indexOf(0xe2) + 1;
  controller.enqueue(bytes.slice(0, split));
  controller.enqueue(bytes.slice(split));
  await progress;
  assert.deepEqual(messages, ["Making changes…"]);
  controller.enqueue(
    new TextEncoder().encode(
      JSON.stringify({ type: "progress", message: "Opening pull request…" }) +
        "\n" +
        JSON.stringify({
          type: "result",
          data: { prUrl: "https://github.com/example/dns/pull/1" },
        }) +
        "\n",
    ),
  );
  controller.close();
  assert.deepEqual(await result, { prUrl: "https://github.com/example/dns/pull/1" });
  assert.deepEqual(messages, ["Making changes…", "Opening pull request…"]);
});

test("streamed errors retain installation error details", async () => {
  await assert.rejects(
    readSubmitProgress(
      responseFor([
        {
          type: "error",
          statusCode: 403,
          message: "Install the app",
          data: { code: "APP_INSTALL_REQUIRED", installUrl: "https://github.com/apps/example" },
        },
      ]),
      () => {},
    ),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 403);
      assert.equal(errCode(error), "APP_INSTALL_REQUIRED");
      assert.equal(errInstallUrl(error), "https://github.com/apps/example");
      return true;
    },
  );
});

test("JSON errors before streaming preserve authentication errors", async () => {
  await assert.rejects(
    readSubmitProgress(
      new Response(
        JSON.stringify({
          message: "Sign in",
          data: { code: "AUTH_REQUIRED" },
        }),
        { status: 401 },
      ),
      () => {},
    ),
    (error: unknown) => {
      assert.equal(errCode(error), "AUTH_REQUIRED");
      return true;
    },
  );
});

test("an interrupted response cannot be treated as a successful submission", async () => {
  await assert.rejects(
    readSubmitProgress(responseFor([{ type: "progress", message: "Saving changes…" }]), () => {}),
    /Lost connection/,
  );
});

test("refreshes GitHub access once and preserves the request body", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; body: BodyInit | null | undefined }> = [];
  globalThis.fetch = (async (url, init) => {
    requests.push({ url: String(url), body: init?.body });
    return responseFor(
      requests.length === 1
        ? [
            {
              type: "error",
              statusCode: 409,
              message: "Refresh needed",
              data: { code: "SUBMIT_REFRESH_REQUIRED" },
            },
          ]
        : [{ type: "result", data: { success: true } }],
    );
  }) as typeof fetch;
  try {
    const body = { domain: "hackclub.com.yaml", action: "delete" };
    const messages: string[] = [];
    assert.deepEqual(await submitWithProgress(body, (message) => messages.push(message)), {
      success: true,
    });
    assert.deepEqual(requests, [
      { url: "/api/submit", body: JSON.stringify(body) },
      { url: "/api/submit?refresh=1", body: JSON.stringify(body) },
    ]);
    assert.deepEqual(messages, ["Refreshing GitHub access…"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
