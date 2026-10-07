/**
 * First non-empty env var among `keys`. The `NUXT_`-prefixed names are still honoured
 * (and win, as they did before) so existing deployments keep their config and sessions.
 */
export const env = (...keys: string[]) => {
  for (const k of keys) {
    const v = process.env[k];
    if (v) return v;
  }
  return "";
};
