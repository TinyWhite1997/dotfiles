import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const refreshMarginMs = 5 * 60_000;

export function validateConfig(config) {
  if (!/^[a-z0-9-]+\.[a-z0-9]+$/i.test(config.tunnelId ?? '')) {
    throw new Error('tunnelId must include its cluster, e.g. hindsight-name.asse');
  }
  const url = new URL(config.url);
  const [, cluster] = config.tunnelId.split('.');
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      url.search || url.hash ||
      // A friendly tunnel name resolves to an opaque hostname printed by `devtunnel host`.
      !new RegExp(`^[a-z0-9-]+-[0-9]+\\.${cluster}\\.devtunnels\\.ms$`, 'i').test(url.hostname) ||
      !/^\/mcp\/[a-zA-Z0-9_-]+\/$/.test(url.pathname)) {
    throw new Error('url must be the HTTPS single-bank endpoint printed by devtunnel host, in the same cluster');
  }
  return url;
}

export async function issueToken(tunnelId) {
  try {
    const { stdout } = await exec('devtunnel', ['token', tunnelId, '--scope', 'connect', '--json'], {
      timeout: 45_000, windowsHide: true, maxBuffer: 1024 * 1024,
    });
    return JSON.parse(stdout).token;
  } catch {
    // Never expose CLI stdout/stderr: it may contain a credential.
    throw new Error('Cannot obtain tunnel token. Run devtunnel user login and check tunnel ownership.');
  }
}

export function createTokenSource(tunnelId, { issue = issueToken, now = Date.now } = {}) {
  let cached;
  let pending;
  return {
    invalidate(token) {
      // A concurrent request may already have refreshed it.
      if (cached?.token === token) cached = undefined;
    },
    async get() {
      if (cached && cached.expiresAt - now() > refreshMarginMs) return cached.token;
      if (!pending) {
        pending = (async () => {
          const token = await issue(tunnelId);
          let exp;
          try {
            if (typeof token !== 'string' || token.split('.').length !== 3) throw new Error();
            ({ exp } = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()));
          } catch {
            throw new Error('Dev Tunnels returned an invalid token.');
          }
          // Decode only for scheduling; Dev Tunnels verifies the signature/permissions.
          if (!Number.isFinite(exp) || exp * 1000 - now() <= refreshMarginMs) {
            throw new Error('Dev Tunnels returned an expired or near-expiry token.');
          }
          cached = { token, expiresAt: exp * 1000 };
          return token;
        })().finally(() => { pending = undefined; });
      }
      return pending;
    },
  };
}

export function createTunnelFetch(url, tokens, { fetchImpl = fetch, apiKey } = {}) {
  return async (input, init = {}) => {
    // SDK requests must stay at the configured endpoint. Never forward tokens on redirects.
    if (String(input) !== String(url)) throw new Error('Refusing credentials for another URL.');
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await tokens.get();
      const headers = new Headers(init.headers);
      headers.set('X-Tunnel-Authorization', `tunnel ${token}`);
      headers.set('X-Tunnel-Skip-AntiPhishing-Page', 'true');
      if (apiKey) headers.set('Authorization', `Bearer ${apiKey}`);
      const response = await fetchImpl(input, { ...init, headers, redirect: 'manual' });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        throw new Error('Tunnel redirected instead of accepting authentication; refusing to follow.');
      }
      if (![401, 403].includes(response.status)) return response;
      await response.body?.cancel();
      tokens.invalidate(token);
      if (attempt === 1) throw new Error('Tunnel or Hindsight denied access after token refresh.');
      // Only replay an explicit auth rejection, never a timeout/5xx/ambiguous write failure.
    }
  };
}
