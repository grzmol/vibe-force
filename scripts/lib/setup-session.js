'use strict';
/**
 * Authenticated Setup hand-off.
 *
 * `sf org open --url-only` returns a single-use frontdoor URI minted by the UI Bridge endpoint
 * `/services/oauth2/singleaccess` (@salesforce/core `Org.getFrontDoorUrl`). The CLI prints a
 * security warning next to it, verbatim: "This command will expose sensitive information that
 * allows for subsequent activity using your current authenticated session." That URL is a
 * credential.
 *
 * Every browser automation tool takes its destination as a plain string argument, so handing the
 * frontdoor URL to one writes a live admin session into the transcript. Two indirections that do
 * not work, both checked against @playwright/mcp 0.0.80:
 *
 *   - A local launcher file. `checkUrlAllowed` throws `Access to "file:" protocol is blocked`
 *     unless `--allow-unrestricted-file-access` is set, and that flag also lifts the
 *     workspace-root restriction on file reads. Too large a relaxation to buy one redirect.
 *   - The `--secrets` dotenv file. `lookupSecret` is consulted only by `browser_fill_form`, for
 *     `textbox` and `slider` values. Navigation never resolves placeholders.
 *
 * So the hand-off is a loopback redirect: bind 127.0.0.1, mint a single-use token, and 302 to the
 * frontdoor URL from inside the process. The browser is pointed at
 * `http://127.0.0.1:<port>/vf-setup/<token>`, which is not a credential, expires, and works once.
 *
 * Pure functions only. `vf-setup.js` owns the socket and the child processes.
 */

/** Anything that carries a session, an access token, or a one-shot login. */
const CREDENTIAL_URL = [
  /\bsid=/i,
  /secur\/frontdoor\.jsp/i,
  /\/services\/oauth2\/singleaccess/i,
  /\bfrontdoor_uri=/i,
  /\baccess_token=/i,
  /\bsessionId=/i,
  /^force:\/\//i
];

function isCredentialUrl(url) {
  const s = String(url || '');
  return CREDENTIAL_URL.some((re) => re.test(s));
}

/**
 * The same URL with every credential-bearing value masked. Safe for a report, a log line, or a
 * denial message, and it keeps the shape so a human can still tell what was opened.
 */
function redactUrl(url) {
  let s = String(url || '');
  if (!s) return '';
  s = s.replace(/\b(sid|access_token|sessionId|refresh_token|frontdoor_uri)=[^&#\s]*/gi, '$1=***');
  s = s.replace(/^(force:\/\/[^:]+:[^:]+:)[^@]+(@)/i, '$1***$2');
  return s;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/** Reject a Host header that is not loopback: the redirect must never be reachable off-box. */
function isLoopbackHost(hostHeader) {
  const host = String(hostHeader || '')
    .trim()
    .toLowerCase();
  if (!host) return false;
  const withoutPort = host.startsWith('[') ? host.replace(/\](:\d+)?$/, ']') : host.replace(/:\d+$/, '');
  return LOOPBACK_HOSTS.has(withoutPort);
}

/** The URL an agent may put in a tool call. Carries no secret, only a one-shot ticket. */
function handoffUrl(port, token) {
  const p = Number(port);
  if (!Number.isInteger(p) || p < 1 || p > 65535) throw new Error(`handoffUrl: bad port ${port}`);
  if (!/^[a-f0-9]{16,64}$/i.test(String(token || ''))) throw new Error('handoffUrl: token must be 16-64 hex chars');
  return `http://127.0.0.1:${p}/vf-setup/${token}`;
}

/** `/vf-setup/<token>` -> token. Anything else is not a hand-off request. */
function parseHandoffPath(pathname) {
  const m = /^\/vf-setup\/([a-f0-9]{16,64})\/?$/i.exec(String(pathname || ''));
  return m ? m[1].toLowerCase() : '';
}

/**
 * Length-independent comparison. The token is short-lived and loopback-only, but a plain `===`
 * on a secret is the kind of thing that gets copied somewhere it matters.
 */
function tokenMatches(expected, received) {
  const a = String(expected || '');
  const b = String(received || '');
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Why a hand-off request was refused, or '' when it is served. Ordered so the cheapest and least
 * informative check runs first: an off-box caller learns nothing about the token.
 */
function handoffRefusal({ method, pathname, host, token, expectedToken, consumed, expiresAt, now }) {
  if (!isLoopbackHost(host)) return 'host';
  if (String(method || '').toUpperCase() !== 'GET') return 'method';
  if (!parseHandoffPath(pathname)) return 'path';
  if (!tokenMatches(expectedToken, token)) return 'token';
  if (consumed) return 'consumed';
  if (Number(expiresAt) && Number(now) > Number(expiresAt)) return 'expired';
  return '';
}

/** 421 for a non-loopback Host: "Misdirected Request" is exactly what that is. */
const REFUSAL_STATUS = {
  host: 421,
  method: 405,
  path: 404,
  token: 404,
  consumed: 410,
  expired: 410
};

const REFUSAL_REASON = {
  host: 'request did not come from loopback',
  method: 'only GET is served',
  path: 'not a hand-off path',
  token: 'token mismatch',
  consumed: 'hand-off already used - frontdoor URLs are single-use',
  expired: 'hand-off expired'
};

module.exports = {
  CREDENTIAL_URL,
  isCredentialUrl,
  redactUrl,
  isLoopbackHost,
  handoffUrl,
  parseHandoffPath,
  tokenMatches,
  handoffRefusal,
  REFUSAL_STATUS,
  REFUSAL_REASON
};
