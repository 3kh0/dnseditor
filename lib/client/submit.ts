import { ApiError } from "./api";

type SubmitEvent<T> =
  | { type: "progress"; message: string }
  | { type: "result"; data: T }
  | {
      type: "error";
      statusCode: number;
      message: string;
      data?: Record<string, unknown>;
    };

export async function readSubmitProgress<T>(
  response: Response,
  onProgress: (message: string) => void,
): Promise<T> {
  if (!response.ok) {
    throw new ApiError(response.status, await response.json().catch(() => null));
  }
  if (!response.body) throw new Error("The submission response was empty. Please try again.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const handleLine = (line: string) => {
    const event = JSON.parse(line) as SubmitEvent<T>;
    if (event.type === "progress") onProgress(event.message);
    if (event.type === "error") throw new ApiError(event.statusCode, event);
    return event;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop()!;
      if (done && buffer.trim()) {
        lines.push(buffer);
        buffer = "";
      }
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = handleLine(line);
        if (event.type === "result") return event.data;
      }
      if (done)
        throw new Error(
          "Lost connection while submitting. Check your fork on GitHub before retrying.",
        );
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function submitWithProgress<T>(
  body: unknown,
  onProgress: (message: string) => void,
): Promise<T> {
  const request = async (refresh: boolean) => {
    const response = await fetch(`/api/submit${refresh ? "?refresh=1" : ""}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/x-ndjson",
      },
      body: JSON.stringify(body),
    });
    return readSubmitProgress<T>(response, onProgress);
  };
  try {
    return await request(false);
  } catch (error) {
    if (error instanceof ApiError && error.data?.data?.code === "SUBMIT_REFRESH_REQUIRED") {
      onProgress("Refreshing GitHub access…");
      return request(true);
    }
    throw error;
  }
}
