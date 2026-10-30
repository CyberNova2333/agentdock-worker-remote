import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, pbkdf2Sync, randomBytes } from 'node:crypto';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

async function fixture(t, { scope = 'computer:read computer:write computer:execute offline_access', registrationMetadata = {} } = {}) {
  const { outputFiles } = await build({ entryPoints: ['cloud/index.mjs'], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', external: ['cloudflare:workers'] });
  const origin = 'https://audit.invalid';
  const password = randomBytes(24).toString('base64url');
  const salt = randomBytes(16);
  const hash = `pbkdf2-sha256$100000$${salt.toString('base64url')}$${pbkdf2Sync(password,salt,100000,32,'sha256').toString('base64url')}`;
  const settings = { name:'audit', modules:[{type:'ESModule',path:'index.mjs',contents:outputFiles[0].text}], compatibilityDate:'2026-10-28',compatibilityFlags:['nodejs_compat','global_fetch_strictly_public'],kvNamespaces:['OAUTH_KV'],durableObjects:{RELAY:{className:'BridgeRelay',useSQLite:true},AUTH:{className:'AuthCoordinator',useSQLite:true}},bindings:{PUBLIC_ORIGIN:origin,BRIDGE_TOKEN:randomBytes(32).toString('base64url'),OWNER_PASSWORD_HASH:hash}};
  const instance = new Miniflare(convertV4MiniflareOptions(settings));
  t.after(()=>instance.dispose());
  const req=(path,init)=>instance.dispatchFetch(origin+path,{...init,redirect:'manual'});
  let client;
  const form=(values,extra={})=>{
    const params = {...values};
    const headers = {'content-type':'application/x-www-form-urlencoded',...extra};
    if (client?.token_endpoint_auth_method === 'client_secret_basic') {
      delete params.client_id;
      headers.authorization = 'basic ' + Buffer.from(`${encodeURIComponent(client.client_id)}:${encodeURIComponent(client.client_secret)}`).toString('base64');
    }
    return req('/oauth/token',{method:'POST',headers,body:new URLSearchParams(params).toString()});
  };
  const registration=await req('/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({client_name:'Audit fixture',redirect_uris:['http://127.0.0.1:49173/callback'],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code'],...registrationMetadata})});
  assert.equal(registration.status,201);client=await registration.json();
  const verifier=randomBytes(32).toString('base64url');
  const params=new URLSearchParams({client_id:client.client_id,redirect_uri:'http://127.0.0.1:49173/callback',response_type:'code',code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url'),scope,resource:origin+'/mcp',state:'audit'});
  const consent=await req('/authorize?'+params);assert.equal(consent.status,200);
  const consentText=await consent.text();
  const handle=consentText.match(/name="handle" value="([^"]+)"/)[1];
  const cookie=consent.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  const approved=await req('/authorize',{method:'POST',headers:{origin,cookie,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({handle,password,decision:'approve'}).toString()});
  assert.equal(approved.status,303);
  const code=new URL(approved.headers.get('location')).searchParams.get('code');
  const exchanged=await form({grant_type:'authorization_code',client_id:client.client_id,code,code_verifier:verifier,redirect_uri:params.get('redirect_uri'),resource:origin+'/mcp'});assert.equal(exchanged.status,200);
  const tokens=await exchanged.json();
  const refresh=(token,extra)=>form({grant_type:'refresh_token',client_id:client.client_id,refresh_token:token,resource:origin+'/mcp'},extra);
  const access=token=>req('/mcp',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'ping'})});
  const reload = async (rotate = false) => {
    if (rotate) {
      const nextPassword = randomBytes(24).toString('base64url');
      settings.bindings.OWNER_PASSWORD_HASH = `pbkdf2-sha256$100000$${salt.toString('base64url')}$${pbkdf2Sync(nextPassword,salt,100000,32,'sha256').toString('base64url')}`;
    }
    await instance.setOptions(convertV4MiniflareOptions(settings));
  };
  return {req,form,refresh,tokens,client,access,consentText,reload};
}

test('refresh rotation rejects a spent token and revokes the entire token family', {timeout:30000}, async t => {
  const f = await fixture(t);
  const first = await f.refresh(f.tokens.refresh_token);
  assert.equal(first.status, 200);
  const rotated = await first.json();
  assert.equal((await f.access(rotated.access_token)).status, 503);
  assert.equal((await f.refresh(f.tokens.refresh_token)).status, 400);
  assert.equal((await f.access(rotated.access_token)).status, 401);
  assert.equal((await f.access(f.tokens.access_token)).status, 401);
  assert.equal((await f.refresh(rotated.refresh_token)).status, 400);
});

test('simultaneous refresh and revocation cannot resurrect authorization', {timeout:30000}, async t => {
  const f = await fixture(t);
  const [refresh, revoked] = await Promise.all([
    f.refresh(f.tokens.refresh_token),
    f.form({token:f.tokens.refresh_token,token_type_hint:'refresh_token',client_id:f.client.client_id}),
  ]);
  assert.equal(revoked.status, 200);
  assert.ok([200,400].includes(refresh.status));
  assert.equal((await f.access(f.tokens.access_token)).status, 401);
  if (refresh.status === 200) {
    const rotated = await refresh.json();
    assert.equal((await f.access(rotated.access_token)).status, 401);
    assert.equal((await f.refresh(rotated.refresh_token)).status, 400);
  }
  assert.equal((await f.refresh(f.tokens.refresh_token)).status, 400);
});

test('offline access is granted only when explicitly approved', {timeout:30000}, async t => {
  const f = await fixture(t, {scope:'computer:read'});
  assert.equal(f.consentText.includes('允许客户端通过刷新令牌保持连接'), false);
  assert.equal(f.tokens.scope, 'computer:read');
  assert.equal(f.tokens.refresh_token, undefined);
  assert.equal((await f.access(f.tokens.access_token)).status, 503);
});

test('unknown refresh credentials and broadened scopes cannot alter a valid grant', {timeout:30000}, async t => {
  const f = await fixture(t, {scope:'computer:read offline_access'});
  assert.equal((await f.refresh(randomBytes(32).toString('base64url'))).status, 400);
  assert.equal((await f.access(f.tokens.access_token)).status, 503);
  const response = await f.form({grant_type:'refresh_token',client_id:f.client.client_id,refresh_token:f.tokens.refresh_token,resource:'https://audit.invalid/mcp',scope:'computer:read computer:write computer:execute offline_access'});
  assert.equal(response.status, 200);
  assert.equal((await response.json()).scope, 'computer:read offline_access');
});

test('revocation using any known rotated refresh token revokes current credentials', {timeout:30000}, async t => {
  const f = await fixture(t);
  const second = await (await f.refresh(f.tokens.refresh_token)).json();
  const third = await (await f.refresh(second.refresh_token)).json();
  assert.equal((await f.access(third.access_token)).status, 503);
  const response = await f.form({token:f.tokens.refresh_token,token_type_hint:'refresh_token',client_id:f.client.client_id});
  assert.equal(response.status, 200);
  assert.equal((await f.access(third.access_token)).status, 401);
  assert.equal((await f.refresh(third.refresh_token)).status, 400);
});

test('rotated token revocation also supports authenticated Basic clients', {timeout:30000}, async t => {
  const f = await fixture(t, {registrationMetadata:{token_endpoint_auth_method:'client_secret_basic'}});
  const second = await (await f.refresh(f.tokens.refresh_token)).json();
  const third = await (await f.refresh(second.refresh_token)).json();
  assert.equal((await f.access(third.access_token)).status, 503);
  assert.equal((await f.form({token:f.tokens.refresh_token,client_id:f.client.client_id})).status, 200);
  assert.equal((await f.access(third.access_token)).status, 401);
});

test('refresh narrowing without offline_access ends persistence and retains only the new scoped access', {timeout:30000}, async t => {
  const f = await fixture(t);
  const response = await f.form({grant_type:'refresh_token',client_id:f.client.client_id,refresh_token:f.tokens.refresh_token,scope:'computer:read',resource:'https://audit.invalid/mcp'});
  assert.equal(response.status, 200);
  const scoped = await response.json();
  assert.equal(scoped.scope, 'computer:read');
  assert.equal(scoped.refresh_token, undefined);
  assert.equal((await f.access(f.tokens.access_token)).status, 401);
  assert.equal((await f.access(scoped.access_token)).status, 503);
  assert.equal((await f.refresh(f.tokens.refresh_token)).status, 400);
  assert.equal((await f.access(scoped.access_token)).status, 401, 'Reusing a spent token revokes the remaining session');
});

test('rotating the owner credential invalidates existing access, refresh and client registrations', {timeout:30000}, async t => {
  const f = await fixture(t);
  assert.equal((await f.access(f.tokens.access_token)).status, 503);
  await f.reload();
  assert.equal((await f.access(f.tokens.access_token)).status, 503, 'Ordinary restart must retain authorization');
  await f.reload(true);
  assert.equal((await f.access(f.tokens.access_token)).status, 401);
  assert.equal((await f.refresh(f.tokens.refresh_token)).status, 400);
});

test('a slow authorization form cannot hold the shared authorization transaction queue', {timeout:30000}, async t => {
  const f = await fixture(t);
  let stream;
  const body = new ReadableStream({ start(controller) { stream = controller; controller.enqueue(new TextEncoder().encode('handle=')); } });
  const slow = f.req('/authorize', {method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body,duplex:'half'});
  await new Promise(resolve => setTimeout(resolve, 100));
  let timer;
  try {
    const access = await Promise.race([
      f.access(f.tokens.access_token),
      new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('An incomplete form blocked token authentication')), 1500); }),
    ]);
    assert.equal(access.status, 503, 'The token was authenticated while the form body was still incomplete');
  } finally { clearTimeout(timer); stream.close(); await slow; }
});
