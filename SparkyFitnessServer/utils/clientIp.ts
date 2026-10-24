import type { Request, Response, NextFunction } from 'express';
import net from 'node:net';

/**
 * Real client IP, for rate limiting and audit logs.
 *
 * `req.ip` alone is unreliable once more than one proxy sits in front of the
 * app. Express resolves it from `X-Forwarded-For` using the `trust proxy` hop
 * count (see SPARKY_FITNESS_TRUSTED_PROXY_HOPS); if the real chain is longer
 * than that count, `req.ip` lands on an internal proxy address that every
 * visitor shares — which would put the whole internet in one rate-limit bucket.
 * `X-Real-IP` is no help either, since docker/nginx.conf overwrites it with its
 * own upstream address.
 *
 * Deployments behind a CDN usually have a better source: a header the edge
 * writes and no downstream hop rewrites (`CF-Connecting-IP` on Cloudflare,
 * `True-Client-IP` on Akamai and others). SPARKY_FITNESS_REAL_IP_HEADER names
 * that header, and it takes precedence when present.
 *
 * Naming a header is only safe when the app cannot be reached except through
 * the proxy that sets it — a request arriving directly could otherwise forge it
 * and slip past every per-IP limit. That is why this is opt-in rather than a
 * built-in list of CDN headers.
 */

export function getClientIp(req: Request): string {
  const headerName = process.env.SPARKY_FITNESS_REAL_IP_HEADER?.trim();
  const normalizedHeader = headerName?.toLowerCase();
  // X-Forwarded-For and X-Client-IP cannot be trusted as single edge headers:
  // - X-Forwarded-For must be evaluated through Express's trust-proxy logic.
  // - X-Client-IP is reserved for internal downstream injection and could be client-forged.
  if (
    normalizedHeader &&
    normalizedHeader !== 'x-forwarded-for' &&
    normalizedHeader !== 'x-client-ip'
  ) {
    const value = req.headers[normalizedHeader];
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw === 'string' && raw.trim()) {
      // Most such headers carry a single address, but a few CDNs pass a list.
      // The originating client is always the first entry.
      let ip = raw.split(',')[0].trim();
      // Strip brackets and optional port for IPv6 (e.g. [2001:db8::1]:8080 or [2001:db8::1])
      if (ip.startsWith('[') && ip.includes(']')) {
        ip = ip.replace(/^\[([^\]]+)\].*$/, '$1');
      } else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(ip)) {
        // Strip port for IPv4: e.g. 203.0.113.195:8080 -> 203.0.113.195
        ip = ip.replace(/:\d+$/, '');
      }
      // Ensure the extracted value is actually a valid IPv4 or IPv6 address.
      if (net.isIP(ip)) {
        return ip;
      }
    }
  }
  return req.ip || 'unknown';
}

/**
 * Express middleware that resolves the real client IP and injects it into
 * `req.headers['x-client-ip']` for Better Auth and downstream handlers.
 * Any untrusted client-supplied header is overwritten or deleted to prevent spoofing.
 */
export function clientIpMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const ip = getClientIp(req);
  if (ip && ip !== 'unknown') {
    req.headers['x-client-ip'] = ip;
  } else {
    delete req.headers['x-client-ip'];
  }
  next();
}
