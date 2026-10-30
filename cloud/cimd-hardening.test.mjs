import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, pbkdf2Sync, randomBytes, randomUUID, sign } from 'node:crypto';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const origin = 'https://audit.invalid';
const metadataUrl = 'https://client.audit.invalid/metadata.json';
const redirect = 'http://127.0.0.1:49173/callback';
const broad = 'computer:read computer:write computer:execute offline_access';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function fixture(t, { legacyGeneration = false, clientUrl = metadataUrl, privateKeyClient = false } = {}) {
  const { outputFiles } = await build({ entryPoints: ['cloud/index.mjs'], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', external: ['cloudflare:workers'] });
  const currentCode = outputFiles[0].text;
  assert.ok(currentCode.includes('owner-v2-'));
  const password = randomBytes(24).toString('base64url'), salt = randomBytes(16);
  const hash = `pbkdf2-sha256$100000$${salt.toString('base64url')}$${pbkdf2Sync(password,salt,100000,32,'sha256').toString('base64url')}`;
  const keys = privateKeyClient ? generateKeyPairSync('ec', { namedCurve: 'P-256' }) : null;
  const jwks = keys ? { keys: [{ ...keys.publicKey.export({ format: 'jwk' }), kid: 'fixture', alg: 'ES256', use: 'sig' }] } : undefined;
  const control = { calls: 0, gate: null, entered: null, metadata: { client_id: clientUrl, client_name: 'Disposable metadata client', redirect_uris: [redirect], token_endpoint_auth_method: privateKeyClient ? 'private_key_jwt' : 'none', jwks, grant_types: ['authorization_code','refresh_token'], response_types: ['code'] } };
  const settings = { name: 'audit', modules: [{ type:'ESModule', path:'index.mjs', contents: legacyGeneration ? currentCode.replaceAll('owner-v2-', 'owner-') : currentCode }], compatibilityDate: '2026-10-28', compatibilityFlags: ['nodejs_compat','global_fetch_strictly_public'], durableObjects: { RELAY: {className:'BridgeRelay',useSQLite:true}, AUTH: {className:'AuthCoordinator',useSQLite:true} }, bindings: {PUBLIC_ORIGIN:origin,BRIDGE_TOKEN:randomBytes(32).toString('base64url'),OWNER_PASSWORD_HASH:hash}, outboundService: async request => {
    assert.equal(request.url, new URL(clientUrl).href);
    control.calls++; control.entered?.resolve();
    if (control.gate) await control.gate.promise;
    return Response.json(control.metadata, { headers: {'cache-control':'no-store'} });
  } };
  const instance = new Miniflare(convertV4MiniflareOptions(settings));
  t.after(() => instance.dispose());
  const req = (pathname, init) => instance.dispatchFetch(origin + pathname, {...init,redirect:'manual'});
  const form = values => {
    const parameters = { ...values };
    if (keys) {
      // Deliberately omit client_id: the verified assertion supplies identity.
      delete parameters.client_id;
      const now = Math.floor(Date.now() / 1000);
      const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: 'fixture' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({ iss: clientUrl, sub: clientUrl, aud: origin, iat: now, exp: now + 120, jti: randomUUID() })).toString('base64url');
      const signed = `${header}.${payload}`;
      const signature = sign('sha256', Buffer.from(signed), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
      parameters.client_assertion_type = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';
      parameters.client_assertion = `${signed}.${signature}`;
    }
    return req('/oauth/token', {method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(parameters).toString()});
  };
  const access = token => req('/mcp', {method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'ping'})});
  const register = async () => {
    const response = await req('/register', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...control.metadata,client_id:undefined})});
    assert.equal(response.status,201); return (await response.json()).client_id;
  };
  const parameters = (clientId, scope = broad) => {
    const verifier = randomBytes(32).toString('base64url');
    return { verifier, params: new URLSearchParams({client_id:clientId,redirect_uri:redirect,response_type:'code',scope,state:'audit',resource:origin+'/mcp',code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')}) };
  };
  const begin = async (clientId, scope = broad) => {
    const {verifier,params} = parameters(clientId,scope);
    const consent = await req('/authorize?'+params); assert.equal(consent.status,200);
    const handle = (await consent.text()).match(/name="handle" value="([^"]+)"/)[1];
    const cookie = consent.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
    return {verifier,params,handle,cookie,clientId};
  };
  const approve = flow => req('/authorize', {method:'POST',headers:{origin,cookie:flow.cookie,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({handle:flow.handle,password,decision:'approve'}).toString()});
  const codeFor = async (clientId,scope = broad) => {
    const flow = await begin(clientId,scope), response = await approve(flow);
    assert.equal(response.status,303);
    return {grant_type:'authorization_code',client_id:clientId,redirect_uri:redirect,code:new URL(response.headers.get('location')).searchParams.get('code'),code_verifier:flow.verifier,resource:origin+'/mcp'};
  };
  const authorize = async (clientId,scope = broad) => {
    const response = await form(await codeFor(clientId,scope)); assert.equal(response.status,200); return response.json();
  };
  const refresh = (clientId, token) => form({grant_type:'refresh_token',client_id:clientId,refresh_token:token,resource:origin+'/mcp'});
  const reload = async () => { settings.modules[0].contents = currentCode; await instance.setOptions(convertV4MiniflareOptions(settings)); };
  return {req,form,access,register,parameters,begin,approve,codeFor,authorize,refresh,reload,control};
}

test('CIMD and registered reauthorization to read-only retire prior access and refresh grants', {timeout:30000}, async t => {
  const f = await fixture(t);
  for (const clientId of [await f.register(),metadataUrl]) {
    const first = await f.authorize(clientId);
    assert.equal((await f.access(first.access_token)).status,503);
    const second = await f.authorize(clientId,'computer:read');
    assert.equal(second.scope,'computer:read'); assert.equal(second.refresh_token,undefined);
    assert.equal((await f.access(first.access_token)).status,401);
    assert.equal((await f.refresh(clientId,first.refresh_token)).status,400);
    assert.equal((await f.access(second.access_token)).status,503);
  }
});

test('slow anonymous CIMD preparation does not delay an already authenticated MCP request', {timeout:30000}, async t => {
  const f = await fixture(t);
  const tokens = await f.authorize(await f.register());
  f.control.gate = deferred(); f.control.entered = deferred();
  const pending = f.req('/authorize?'+f.parameters(metadataUrl).params);
  await f.control.entered.promise;
  try {
    const result = await Promise.race([f.access(tokens.access_token),new Promise((_,reject)=>setTimeout(()=>reject(new Error('MCP was held behind client metadata')),2000))]);
    assert.equal(result.status,503);
    assert.match((await result.json()).error,/Computer is offline/);
  } finally { f.control.gate.resolve(); }
  assert.equal((await pending).status,200);
});

test('changed CIMD callback metadata is revalidated before code issuance, and mismatched identity is rejected', {timeout:30000}, async t => {
  const f = await fixture(t);
  const flow = await f.begin(metadataUrl);
  f.control.metadata.redirect_uris = ['https://client.audit.invalid/different'];
  const rejected = await f.approve(flow);
  assert.notEqual(rejected.status,303); assert.equal(rejected.headers.get('location'),null);
  f.control.metadata.redirect_uris = [redirect];
  f.control.metadata.client_id = 'https://another.audit.invalid/metadata.json';
  assert.equal((await f.req('/authorize?'+f.parameters(metadataUrl).params)).status,400);
});

test('simultaneous code exchange has one winner and simultaneous refresh cannot revive a reused family', {timeout:30000}, async t => {
  const f = await fixture(t), clientId = await f.register();
  const exchange = await f.codeFor(clientId);
  const codes = await Promise.all([f.form(exchange),f.form(exchange)]);
  assert.deepEqual(codes.map(value=>value.status).sort(),[200,400]);
  const tokens = await codes.find(value=>value.status===200).json();
  const refreshes = await Promise.all([f.refresh(clientId,tokens.refresh_token),f.refresh(clientId,tokens.refresh_token)]);
  assert.deepEqual(refreshes.map(value=>value.status).sort(),[200,400]);
  const rotated = await refreshes.find(value=>value.status===200).json();
  assert.equal((await f.access(rotated.access_token)).status,401);
  assert.equal((await f.refresh(clientId,rotated.refresh_token)).status,400);
});

test('v2 authorization generation retires old deployed grants and remains stable across ordinary restarts', {timeout:30000}, async t => {
  const f = await fixture(t,{legacyGeneration:true});
  const oldClient = await f.register(), oldTokens = await f.authorize(oldClient);
  await f.reload();
  assert.equal((await f.access(oldTokens.access_token)).status,401);
  assert.equal((await f.refresh(oldClient,oldTokens.refresh_token)).status,400);
  const currentClient = await f.register(), currentTokens = await f.authorize(currentClient);
  await f.reload();
  assert.equal((await f.access(currentTokens.access_token)).status,503);
  assert.equal((await f.refresh(currentClient,currentTokens.refresh_token)).status,200);
});

for (const [label, clientUrl] of [['ASCII', metadataUrl], ['Unicode', 'https://client.audit.invalid/客户端🙂.json']]) {
  test(`${label} private-key client revokes current access and refresh via a rotated token without client_id`, { timeout: 30000 }, async t => {
    const f = await fixture(t, { clientUrl, privateKeyClient: true });
    const first = await f.authorize(clientUrl);
    const refreshed = await f.refresh(clientUrl, first.refresh_token);
    assert.equal(refreshed.status, 200);
    const current = await refreshed.json();
    assert.equal((await f.access(current.access_token)).status, 503);
    const revoked = await f.form({ token: first.refresh_token, token_type_hint: 'refresh_token' });
    assert.equal(revoked.status, 200);
    assert.equal((await f.access(current.access_token)).status, 401);
    assert.equal((await f.refresh(clientUrl, current.refresh_token)).status, 400);
  });
}
