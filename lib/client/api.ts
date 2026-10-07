/** Error thrown for non-2xx API responses; `data` is the parsed `{ statusCode, message, data }` body. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly data: { message?: string; data?: Record<string, unknown> } | null,
  ) {
    super(data?.message || `Request failed with status ${status}`);
  }
}

export async function api<T>(
  url: string,
  init?: Omit<RequestInit, "body"> & { body?: unknown },
): Promise<T> {
  const { body, ...rest } = init ?? {};
  const res = await fetch(url, {
    ...rest,
    headers: body === undefined ? rest.headers : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

export const errCode = (err: unknown) =>
  err instanceof ApiError && typeof err.data?.data?.code === "string" ? err.data.data.code : null;

export const errInstallUrl = (err: unknown) =>
  err instanceof ApiError && typeof err.data?.data?.installUrl === "string"
    ? err.data.data.installUrl
    : null;
