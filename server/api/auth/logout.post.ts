import { clearAppSessionCookie } from "../../utils/session";

export default defineEventHandler((event) => {
  clearAppSessionCookie(event);
  return { success: true };
});
