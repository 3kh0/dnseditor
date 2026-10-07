import { NextResponse, type NextRequest } from "next/server";

type CookieOptions = Parameters<NextResponse["cookies"]["set"]>[2];

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly data?: Record<string, unknown>,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export const httpError = (opts: {
  statusCode: number;
  message: string;
  data?: Record<string, unknown>;
  cause?: unknown;
}) => new HttpError(opts.statusCode, opts.message, opts.data, { cause: opts.cause });

export const isHttpError = (e: unknown): e is HttpError => e instanceof HttpError;

/**
 * Per-request context: reads come from the request, while cookie writes and extra
 * headers are queued and applied to whatever response the handler ends up returning.
 */
export class Ctx {
  readonly headers = new Headers();
  private readonly cookieOps: Array<
    { name: string; value: string; opts?: CookieOptions } | { name: string; delete: true }
  > = [];
  private readonly jar = new Map<string, string | null>();

  constructor(
    readonly req: NextRequest,
    readonly params: Record<string, string> = {},
  ) {}

  get url() {
    return this.req.nextUrl;
  }

  query(name: string): string | undefined {
    return this.req.nextUrl.searchParams.get(name) ?? undefined;
  }

  getCookie(name: string): string | undefined {
    if (this.jar.has(name)) return this.jar.get(name) ?? undefined;
    return this.req.cookies.get(name)?.value;
  }

  setCookie(name: string, value: string, opts?: CookieOptions) {
    this.jar.set(name, value);
    this.cookieOps.push({ name, value, opts });
  }

  deleteCookie(name: string) {
    this.jar.set(name, null);
    this.cookieOps.push({ name, delete: true });
  }

  apply<T extends Response>(res: T): T {
    this.headers.forEach((v, k) => res.headers.set(k, v));
    if (res instanceof NextResponse) {
      for (const op of this.cookieOps) {
        if ("delete" in op) res.cookies.delete(op.name);
        else res.cookies.set(op.name, op.value, op.opts);
      }
    }
    return res;
  }
}

export function redirect(url: string, status = 302) {
  return NextResponse.redirect(url, status);
}

type Handler = (ctx: Ctx) => Promise<unknown> | unknown;

/** Wraps a handler: plain return values become JSON, thrown errors become `{ statusCode, message, data }`. */
export function route(handler: Handler) {
  return async (req: NextRequest, segment?: { params?: Promise<Record<string, string>> }) => {
    const ctx = new Ctx(req, (await segment?.params) ?? {});
    try {
      const result = await handler(ctx);
      const res = result instanceof Response ? result : NextResponse.json(result ?? null);
      return ctx.apply(res);
    } catch (e) {
      const err = isHttpError(e)
        ? e
        : new HttpError(500, e instanceof Error ? e.message : "Internal server error");
      if (!isHttpError(e)) console.error(e);
      return ctx.apply(
        NextResponse.json(
          { statusCode: err.statusCode, message: err.message, data: err.data },
          { status: err.statusCode },
        ),
      );
    }
  };
}
