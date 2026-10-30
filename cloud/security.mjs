/** Shared, side-effect-free checks used at the public trust boundary. */
export const MAX_RPC_BYTES = 1024 * 1024;
export const MAX_REPLY_BYTES = 2 * 1024 * 1024;
export const COMPUTER_SCOPES = ['computer:read', 'computer:write', 'computer:execute'];
export const OAUTH_SCOPES = [...COMPUTER_SCOPES, 'offline_access'];
export const PROTOCOL_VERSIONS = new Set(['2025-03-26', '2025-06-18', '2025-11-25']);
const encoder = new TextEncoder();

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => `&#${character.charCodeAt(0)};`);
}

export function pageHeaders() {
  return new Headers({
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    'x-frame-options': 'DENY',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  });
}

export function json(value, status = 200, extra = {}) {
  return Response.json(value, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra } });
}

export async function readLimited(request, maximum, timeoutMs = 15000) {
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximum)) throw new HttpError(413, 'Request body is too large.');
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  let timer, abort;
  const deadline = new Promise((resolve, reject) => {
    abort = () => {
      reject(new HttpError(408, 'Request body was cancelled or took too long.'));
      // Cancellation of a tee'd request can wait for its other reader; never await it.
      void reader.cancel().catch(() => {});
    };
    timer = setTimeout(abort, timeoutMs);
    request.signal?.addEventListener('abort', abort, { once: true });
    if (request.signal?.aborted) abort();
  });
  try {
    while (true) {
      const part = await Promise.race([reader.read(), deadline]);
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maximum) {
        void reader.cancel().catch(() => {});
        throw new HttpError(413, 'Request body is too large.');
      }
      chunks.push(part.value);
    }
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener('abort', abort);
    try { reader.releaseLock(); } catch { /* A pending cancellation must not mask the bounded failure. */ }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new HttpError(400, 'Body must be valid UTF-8.'); }
}

export async function sha256(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

export function bytesEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

export async function equalSecret(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string' || expected.length < 32 || actual.length > 512) return false;
  return bytesEqual(await sha256(actual), await sha256(expected));
}

export function fromBase64url(text) {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new Error('Invalid base64url.');
  const value = text.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(value + '='.repeat((4 - value.length % 4) % 4)), character => character.charCodeAt(0));
}

export async function verifyOwnerPassword(password, savedHash) {
  if (typeof password !== 'string' || password.length > 1024 || typeof savedHash !== 'string') return false;
  const parts = savedHash.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256' || parts[1] !== '100000') return false;
  let salt, expected;
  try { salt = fromBase64url(parts[2]); expected = fromBase64url(parts[3]); } catch { return false; }
  if (salt.length < 16 || salt.length > 64 || expected.length !== 32) return false;
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const calculated = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', iterations: 100000, salt }, material, 256));
  return bytesEqual(calculated, expected);
}

export function publicOrigin(env) {
  const parsed = new URL(env.PUBLIC_ORIGIN);
  if (parsed.origin !== env.PUBLIC_ORIGIN || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('PUBLIC_ORIGIN must be a canonical origin.');
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) throw new Error('HTTPS is required.');
  return parsed.origin;
}

export function allowedOrigin(value, origin) {
  return !value || [origin, 'https://chatgpt.com', 'https://chat.openai.com'].includes(value);
}

export function validateRpc(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || body.jsonrpc !== '2.0' || typeof body.method !== 'string' || body.method.length > 100) throw new HttpError(400, 'A single JSON-RPC 2.0 request is required.');
  if ('id' in body && body.id !== null && typeof body.id !== 'string' && !(typeof body.id === 'number' && Number.isFinite(body.id))) throw new HttpError(400, 'Invalid JSON-RPC id.');
  if (typeof body.id === 'string' && body.id.length > 256) throw new HttpError(400, 'JSON-RPC id is too long.');
  if ('params' in body && (!body.params || typeof body.params !== 'object' || Array.isArray(body.params))) throw new HttpError(400, 'JSON-RPC params must be an object.');
  return body;
}
