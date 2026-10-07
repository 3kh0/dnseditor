import { route } from "@/lib/server/http";
import { clearAppSessionCookie } from "@/lib/server/session";

export const POST = route((ctx) => {
  clearAppSessionCookie(ctx);
  return { success: true };
});
