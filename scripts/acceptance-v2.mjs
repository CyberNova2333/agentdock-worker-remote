import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import { randomBytes, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { defaultStateDirectory, loadSecrets, proxyCandidates } from '../local/connector.mjs';
import { approveRequest } from '../local/approval-cli.mjs';

const stateDir = process.argv[2] || defaultStateDirectory();
const config = JSON.parse(await fs.readFile(path.join(stateDir, 'config.json'), 'utf8'));
const origin = config.origin;
const secrets = loadSecrets(stateDir);
const checks = [];
const pass = name => { checks.push({ check: name, passed: true }); console.log(`PASS ${name}`); };
let selectedProxy;

async function request(target, { method = 'GET', headers = {}, body } = {}) {
  const payload = body === undefined ? undefined : Buffer.from(body);
  return new Promise((resolve, reject) => {
    const req = https.request(new URL(target, origin), {
      method, headers: { ...headers, ...(payload ? { 'content-length': payload.length } : {}) },
      agent: selectedProxy ? new HttpsProxyAgent(selectedProxy) : undefined,
      timeout: 100000,
    }, res => {
      const chunks = [];
      let bytes = 0;
      res.on('data', chunk => { bytes += chunk.length; if (bytes > 3 * 1024 * 1024) req.destroy(new Error('Acceptance reply is too large')); else chunks.push(chunk); });
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) });
      });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Acceptance request timed out')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

let counter = 0;
let token;
async function rpc(method, params = {}, approvedRetry = false) {
  const response = await request('/mcp', {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++counter, method, params }),
  });
  assert.equal(response.status, 200, `MCP ${method} HTTP status ${response.status}`);
  const value = response.json();
  if (value.error?.data?.code === 'LOCAL_APPROVAL_REQUIRED' && !approvedRetry) {
    // This local verifier can approve ONLY its own disposable canary operations.
    // No externally supplied command or project operation is approved here.
    const fileProbe = ['write_file', 'read_file', 'edit_file', 'delete_file'].includes(params.name) && probe && params.arguments?.path === probe;
    const echoProbe = params.name === 'exec_command' && params.arguments?.cmd === "printf %s Bridge-acceptance-ok" && params.arguments?.network === 'none';
    assert.ok(fileProbe || echoProbe, 'Only this verifier canary may be locally approved');
    const approvalId = value.error.data.approval_id;
    assert.match(approvalId, /^[a-f0-9-]{36}$/);
    const directory = path.join(stateDir, 'approvals');
    const pending = JSON.parse(await fs.readFile(path.join(directory, `${approvalId}.request.json`), 'utf8'));
    assert.equal(pending.request.origin, origin);
    assert.equal(pending.request.authorization.clientId, client.client_id);
    assert.deepEqual(pending.request.params, params);
    if (params.name === 'write_file') assert.equal(await fs.access(probe).then(() => true, () => false), false, 'Unapproved write must not run');
    await approveRequest(directory, pending);
    return rpc(method, params, true);
  }
  assert.equal(value.error, undefined, `MCP ${method} JSON-RPC error`);
  assert.notEqual(value.result?.isError, true, `MCP ${method} tool error`);
  return value.result;
}
async function call(name, args = {}) { const result = await rpc('tools/call', { name, arguments: args }); return result.structuredContent || JSON.parse(result.content[0].text); }
async function oauthForm(endpoint, values) {
  return request(endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(values).toString() });
}

let tokens;
let client;
let metadata;
let probe;
let success = false;
try {
  let reachable = false;
  // Honor the user's existing explicit HTTP proxy when available. Direct requests
  // can intermittently reset on this network even while a persistent socket works.
  const routes = proxyCandidates().sort((a, b) => Number(Boolean(b)) - Number(Boolean(a)));
  for (const proxy of routes) {
    selectedProxy = proxy;
    try { const response = await request('/healthz'); assert.equal(response.status, 200); assert.equal(response.json().connectorOnline, true); reachable = true; break; } catch { /* Only this read-only reachability probe may try another route. */ }
  }
  assert.equal(reachable, true, 'Public connector health');
  pass('PUBLIC_CONNECTOR_ONLINE');
  const anonymous = await request('/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(anonymous.status, 401);
  assert.match(anonymous.headers['www-authenticate'], /resource_metadata/);
  assert.equal((await request('/mcp', { method: 'POST', headers: { origin: 'https://untrusted.example' }, body: '{}' })).status, 403);
  pass('ANONYMOUS_DENIED_AND_ORIGIN_CHECKED');
  metadata = (await request('/.well-known/oauth-authorization-server')).json();
  const resource = (await request('/.well-known/oauth-protected-resource/mcp')).json();
  assert.equal(metadata.issuer, origin);
  assert.equal(resource.resource, `${origin}/mcp`);
  for (const key of ['authorization_endpoint', 'token_endpoint', 'registration_endpoint']) assert.equal(new URL(metadata[key]).origin, origin);
  pass('OAUTH_DISCOVERY_AND_RESOURCE_ORIGIN');
  const redirectUri = 'http://127.0.0.1:49173/callback';
  const registration = await request(metadata.registration_endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'Local deployment verification (temporary)', redirect_uris: [redirectUri], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }),
  });
  assert.equal(registration.status, 201);
  client = registration.json();
  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(20).toString('hex');
  const parameters = new URLSearchParams({ client_id: client.client_id, redirect_uri: redirectUri, response_type: 'code', code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url'), scope: 'computer:read computer:write computer:execute offline_access', resource: `${origin}/mcp`, state });
  const consent = await request(`${metadata.authorization_endpoint}?${parameters}`);
  assert.equal(consent.status, 200);
  const handle = consent.text.match(/name="handle" value="([^"]+)"/)?.[1];
  assert.ok(handle, 'Browser consent form handle');
  const cookie = (consent.headers['set-cookie'] || []).map(value => value.split(';')[0]).join('; ');
  const authorization = await request('/authorize', { method: 'POST', headers: { origin, cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ handle, password: secrets.ownerPassword, decision: 'approve' }).toString() });
  assert.equal(authorization.status, 303);
  const callback = new URL(authorization.headers.location);
  assert.equal(callback.origin, new URL(redirectUri).origin);
  assert.equal(callback.searchParams.get('state'), state);
  assert.equal(callback.searchParams.get('iss'), origin);
  // The callback is parsed locally and never visited. No authorization code is sent to a third party.
  const exchange = await oauthForm(metadata.token_endpoint, { grant_type: 'authorization_code', client_id: client.client_id, code: callback.searchParams.get('code'), code_verifier: verifier, redirect_uri: redirectUri, resource: `${origin}/mcp` });
  assert.equal(exchange.status, 200);
  tokens = exchange.json();
  assert.ok(tokens.access_token && tokens.refresh_token);
  token = tokens.access_token;
  pass('OAUTH_DCR_CONSENT_PASSWORD_AND_PKCE');
  const init = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'deployment-verifier', version: '1.0.0' } });
  assert.equal(init.protocolVersion, '2025-11-25');
  const notification = await request('/mcp', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
  assert.equal(notification.status, 202);
  const tools = await rpc('tools/list');
  assert.equal(tools.tools.length, 10);
  const context = await call('computer_context');
  assert.ok(context);
  pass('MCP_INITIALIZE_NOTIFICATION_LIST_AND_CONTEXT');
  const acceptanceDirectory = path.resolve(import.meta.dirname, '..', 'artifacts', 'acceptance');
  await fs.mkdir(acceptanceDirectory, { recursive: true });
  probe = path.join(acceptanceDirectory, `probe-${randomBytes(12).toString('hex')}.txt`);
  const content = `Independent bridge round-trip ${randomBytes(12).toString('hex')}\n中文验证\n`;
  await call('write_file', { path: probe, content });
  const read = await call('read_file', { path: probe });
  assert.equal(read.content, content);
  assert.equal(await fs.readFile(probe, 'utf8'), content);
  await call('edit_file', { path: probe, old_text: '中文验证', new_text: '编辑验证' });
  assert.equal(await fs.readFile(probe, 'utf8'), content.replace('中文验证', '编辑验证'));
  await call('delete_file', { path: probe });
  assert.equal(await fs.access(probe).then(() => true, () => false), false);
  probe = undefined;
  pass('PUBLIC_FILE_CREATE_READ_EDIT_DELETE_AND_DISK_MATCH');
  const echo = await call('exec_command', { cmd: "printf %s Bridge-acceptance-ok", cwd: acceptanceDirectory, mode: 'sync', network: 'none', timeout_ms: 10000, max_output_bytes: 2048 });
  assert.equal(echo.exit_code, 0);
  assert.equal(echo.stdout, 'Bridge-acceptance-ok');
  pass('PUBLIC_COMMAND_EXIT_AND_OUTPUT');
  const refreshed = await oauthForm(metadata.token_endpoint, { grant_type: 'refresh_token', client_id: client.client_id, refresh_token: tokens.refresh_token, resource: `${origin}/mcp` });
  assert.equal(refreshed.status, 200);
  tokens = refreshed.json();
  token = tokens.access_token;
  await rpc('ping');
  pass('OAUTH_REFRESH_AND_REFRESHED_TOKEN_CALL');
  success = true;
} catch (error) {
  // Never log response bodies, cookies, codes, tokens, passwords or exception objects.
  checks.push({ check: 'ACCEPTANCE_COMPLETE', passed: false, reason: error.code === 'ERR_ASSERTION' ? error.message.split('\n')[0] : 'Network or local verification failure' });
  console.error(`FAIL ${checks.at(-1).reason}`);
  process.exitCode = 1;
} finally {
  if (probe) await fs.unlink(probe).catch(() => {});
  if (tokens && client && metadata) {
    try {
      const endpoint = metadata.revocation_endpoint || `${metadata.token_endpoint}/revoke`;
      const revoked = await oauthForm(endpoint, { token: tokens.refresh_token, token_type_hint: 'refresh_token', client_id: client.client_id });
      assert.equal(revoked.status, 200);
      const denied = await request('/mcp', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 100, method: 'ping' }) });
      assert.equal(denied.status, 401);
      pass('TEMPORARY_OAUTH_GRANT_REVOKED');
    } catch { checks.push({ check: 'TEMPORARY_OAUTH_GRANT_REVOKED', passed: false }); process.exitCode = 1; success = false; }
  }
  secrets.ownerPassword = undefined; secrets.ownerPasswordHash = undefined; secrets.bridgeToken = undefined;
  token = undefined; tokens = undefined;
  const output = path.resolve(import.meta.dirname, '..', 'artifacts', 'acceptance-v2-result.json');
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify({ time: new Date().toISOString(), origin, success, checks, chatgptClientConnection: 'not_tested' }, null, 2));
}
