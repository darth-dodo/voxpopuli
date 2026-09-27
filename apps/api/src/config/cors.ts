/** Special `FRONTEND_URL` value that allows any Render subdomain (used by PR previews). */
const RENDER_WILDCARD = 'onrender.com';

/** Origin setting accepted by Nest's `enableCors({ origin })`. */
export type CorsOrigin = string | RegExp | (string | RegExp)[];

/**
 * Turn the `FRONTEND_URL` env value into a CORS origin setting.
 *
 * Accepts a single origin, a comma-separated list of origins (e.g. when the
 * frontend is reachable on more than one host), or the literal `onrender.com`
 * to allow any `*.onrender.com` origin. Trailing slashes are removed because
 * browsers send the `Origin` header without them.
 *
 * @param frontendUrl - Raw `FRONTEND_URL` value
 * @returns Origin setting for `app.enableCors()`
 */
export function resolveCorsOrigin(frontendUrl: string): CorsOrigin {
  const origins = frontendUrl
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean)
    .map((origin) => (origin === RENDER_WILDCARD ? /\.onrender\.com$/ : origin));

  return origins.length === 1 ? origins[0] : origins;
}
