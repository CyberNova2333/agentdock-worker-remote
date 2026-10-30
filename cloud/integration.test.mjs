import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, pbkdf2Sync, randomBytes } from 'node:crypto';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

test('Worker enforces OAuth, browser-bound consent, PKCE, scopes and an authenticated computer socket', { timeout: 90000 }, async t => {
  const { outputFiles } = await build({ entryPoints: [new URL('./index.mjs', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', external: ['cloudflare:workers'] });
  const origin = 'https://bridge.example.test';
  const password = randomBytes(24).toString('base64url');
  const secret = randomBytes(32).toString('base64url');
  const salt = randomBytes(16);
  const passwordHash = `pbkdf2-sha256$100000$${salt.toString('base64url')}$${pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('base64url')}`;
  const instance = new Miniflare(convertV4MiniflareOptions({ name: 'gateway',
    modules: [{ type: 'ESModule', path: 'index.mjs', contents: outputFiles[0].text }],
    compatibilityDate: '2026-10-28', compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
    durableObjects: { RELAY: { className: 'BridgeRelay', useSQLite: true }, AUTH: { className: 'AuthCoordinator', useSQLite: true } },
    bindings: { PUBLIC_ORIGIN: origin, BRIDGE_TOKEN: secret, OWNER_PASSWORD_HASH: passwordHash },
  }));
  t.after(() => instance.dispose());
  const request = (path, init) => instance.dispatchFetch(`${origin}${path}`, { ...init, redirect: 'manual' });

  assert.equal((await request('/healthz')).status, 503);
  assert.equal((await request('/mcp', { method: 'POST', body: '{}' })).status, 401);
  assert.equal((await request('/mcp', { method: 'POST', headers: { origin: 'https://evil.example' }, body: '{}' })).status, 403);
  assert.equal((await request('/mcp', { method: 'POST', headers: { 'mcp-protocol-version': '1900-01-01' }, body: '{}' })).status, 400);
  assert.equal((await request('/bridge', { headers: { upgrade: 'websocket' } })).status, 401);
  const metadata = await (await request('/.well-known/oauth-authorization-server')).json();
  assert.equal(metadata.issuer, origin);
  assert.ok(metadata.code_challenge_methods_supported.includes('S256'));
  const resource = await (await request('/.well-known/oauth-protected-resource/mcp')).json();
  assert.equal(resource.resource, `${origin}/mcp`);

  const badRegistration = await request('/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Unsafe', redirect_uris: ['http://evil.example/callback'], token_endpoint_auth_method: 'none' }) });
  assert.equal(badRegistration.status, 400);
  const registered = await request('/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: '<img src=x onerror=alert(1)>', redirect_uris: ['https://chatgpt.com/connector/oauth/test'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }) });
  assert.equal(registered.status, 201);
  const client = await registered.json();
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const parameters = new URLSearchParams({ client_id: client.client_id, redirect_uri: 'https://chatgpt.com/connector/oauth/test', response_type: 'code', code_challenge_method: 'S256', code_challenge: challenge, scope: 'computer:read computer:write computer:execute offline_access', resource: `${origin}/mcp`, state: 'opaque-test-state' });
  const consent = await request(`/authorize?${parameters}`);
  assert.equal(consent.status, 200);
  const policies = consent.headers.get('content-security-policy').split(',').map(value => value.trim());
  const pagePolicy = policies.find(value => value.includes("default-src 'none'"));
  assert.ok(pagePolicy, 'Provider consent headers must not replace the page CSP');
  for (const directive of ["form-action 'self'", "base-uri 'none'", "frame-ancestors 'none'", "style-src 'unsafe-inline'"]) {
    assert.ok(pagePolicy.split(';').map(value => value.trim()).includes(directive), directive);
  }
  assert.ok(policies.includes("frame-ancestors 'none'"), 'The provider CSP remains enforced alongside the page policy');
  assert.equal(consent.headers.get('x-frame-options'), 'DENY');
  assert.equal(consent.headers.get('cache-control'), 'no-store');
  const page = await consent.text();
  assert.ok(!page.includes('<img src=x'));
  assert.ok(page.includes('&#60;img src=x'));
  const handle = page.match(/name="handle" value="([^"]+)"/)?.[1];
  assert.ok(handle);
  const cookie = consent.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const form = new URLSearchParams({ handle, password, decision: 'approve' });
  const noCookie = await request('/authorize', { method: 'POST', headers: { origin, 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString() });
  assert.equal(noCookie.status, 400);
  const authorizations = await Promise.all([0, 1].map(() => request('/authorize', { method: 'POST', headers: { origin, cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString() })));
  assert.deepEqual(authorizations.map(response => response.status).sort(), [303, 400]);
  const authorization = authorizations.find(response => response.status === 303);
  assert.equal(authorization.status, 303);
  const redirect = new URL(authorization.headers.get('location'));
  assert.equal(redirect.origin, 'https://chatgpt.com');
  assert.equal(redirect.searchParams.get('state'), 'opaque-test-state');
  assert.equal(redirect.searchParams.get('iss'), origin);
  const code = redirect.searchParams.get('code');
  assert.ok(code);
  const tokenForm = { grant_type: 'authorization_code', client_id: client.client_id, code, code_verifier: verifier, redirect_uri: parameters.get('redirect_uri'), resource: `${origin}/mcp` };
  const wrongAudience = await request('/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...tokenForm, resource: 'https://evil.example/mcp' }).toString() });
  assert.equal(wrongAudience.status, 400);
  const wrongPkce = await request('/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...tokenForm, code_verifier: randomBytes(32).toString('base64url') }).toString() });
  assert.equal(wrongPkce.status, 400);
  const exchanges = await Promise.all([0, 1].map(() => request('/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(tokenForm).toString() })));
  assert.deepEqual(exchanges.map(response => response.status).sort(), [200, 400]);
  const exchange = exchanges.find(response => response.status === 200);
  assert.equal(exchange.status, 200);
  const tokens = await exchange.json();
  assert.ok(tokens.access_token && tokens.refresh_token);
  const authHeaders = { authorization: `Bearer ${tokens.access_token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  assert.equal((await request('/mcp', { method: 'POST', headers: authHeaders, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })).status, 503);
  const connection = await request('/bridge', { headers: { upgrade: 'websocket', authorization: `Bearer ${secret}` } });
  assert.equal(connection.status, 101);
  const socket = connection.webSocket;
  socket.accept();
  t.after(() => socket.close(1000));
  const heartbeat = new Promise(resolve => {
    const listen = event => { if (event.data === '{"type":"pong"}') { socket.removeEventListener('message', listen); resolve(); } };
    socket.addEventListener('message', listen);
  });
  socket.send('{"type":"ping"}');
  await heartbeat;
  const held = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.body?.method === 'test/hold') { held.push(message); return; }
    if (message.type === 'request') socket.send(JSON.stringify({ type: 'response', id: message.id, body: 'id' in message.body ? { jsonrpc: '2.0', id: message.body.id, result: { tools: [], echo: message.body.method } } : null }));
  });
  assert.equal((await request('/bridge', { headers: { upgrade: 'websocket', authorization: `Bearer ${secret}` } })).status, 409);
  assert.equal((await request('/healthz')).status, 200);
  const rpc = await request('/mcp', { method: 'POST', headers: authHeaders, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) });
  assert.equal(rpc.status, 200);
  assert.equal((await rpc.json()).result.echo, 'tools/list');
  const notification = await request('/mcp', { method: 'POST', headers: authHeaders, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
  assert.equal(notification.status, 202);
  assert.equal(await notification.text(), '');
  const burst = Array.from({ length: 20 }, (_, id) => request('/mcp', { method: 'POST', headers: authHeaders, body: JSON.stringify({ jsonrpc: '2.0', id: `burst-${id}`, method: 'test/hold' }) }));
  const deadline = Date.now() + 5000;
  while (held.length < 16 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(held.length, 16);
  // Let the remaining calls finish admission before releasing the occupied slots.
  await new Promise(resolve => setTimeout(resolve, 50));
  for (const item of held) socket.send(JSON.stringify({ type: 'response', id: item.id, body: { jsonrpc: '2.0', id: item.body.id, result: {} } }));
  const burstResults = await Promise.all(burst);
  assert.equal(burstResults.filter(response => response.status === 200).length, 16);
  assert.equal(burstResults.filter(response => response.status === 429).length, 4);
  const refresh = await request('/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', client_id: client.client_id, refresh_token: tokens.refresh_token, resource: `${origin}/mcp` }).toString() });
  assert.equal(refresh.status, 200);
  const refreshed = await refresh.json();
  assert.ok(refreshed.access_token && refreshed.refresh_token);
  assert.notEqual(refreshed.access_token, tokens.access_token);
  parameters.set('scope', 'computer:read');
  const readonlyConsent = await request(`/authorize?${parameters}`);
  const readonlyPage = await readonlyConsent.text();
  const readonlyHandle = readonlyPage.match(/name="handle" value="([^"]+)"/)?.[1];
  const readonlyCookie = readonlyConsent.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const readonlyAuthorization = await request('/authorize', { method: 'POST', headers: { origin, cookie: readonlyCookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ handle: readonlyHandle, password, decision: 'approve' }).toString() });
  assert.equal(readonlyAuthorization.status, 303);
  const readonlyCode = new URL(readonlyAuthorization.headers.get('location')).searchParams.get('code');
  const readonlyExchange = await request('/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...tokenForm, code: readonlyCode }).toString() });
  assert.equal(readonlyExchange.status, 200);
  const readonlyTokens = await readonlyExchange.json();
  assert.equal(readonlyTokens.refresh_token, undefined);
  const readonlyHeaders = { ...authHeaders, authorization: `Bearer ${readonlyTokens.access_token}` };
  assert.equal((await request('/mcp', { method: 'POST', headers: readonlyHeaders, body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list' }) })).status, 200);
  assert.equal((await request('/mcp', { method: 'POST', headers: readonlyHeaders, body: JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'write_file', arguments: {} } }) })).status, 403);
  assert.equal((await request('/mcp', { method: 'POST', headers: readonlyHeaders, body: JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'exec_command', arguments: {} } }) })).status, 403);
});
