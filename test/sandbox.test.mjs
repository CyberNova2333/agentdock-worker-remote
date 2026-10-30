import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const exec = promisify(execFile);
const docker = process.platform === 'win32' ? 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe' : '/usr/bin/docker';

test('Docker workspace provides tools while isolating host credentials, runtime, processes and network', { timeout: 300000, skip: process.env.AGENTDOCK_DOCKER_TEST !== '1' }, async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdock-sandbox-test-'));
  const workspace = path.join(base, 'workspace'), state = path.join(base, 'state'), runtime = path.join(base, 'runtime');
  for (const dir of [workspace, state, runtime]) await fs.mkdir(dir);
  for (const file of ['sandbox.mjs', 'tools.mjs']) await fs.copyFile(new URL(`../local/${file}`, import.meta.url), path.join(runtime, file));
  const fileModules = await fs.readdir(new URL('../local/', import.meta.url));
  for (const file of fileModules) if (file.endsWith('.mjs') && !['sandbox.mjs', 'tools.mjs'].includes(file)) await fs.copyFile(new URL(`../local/${file}`, import.meta.url), path.join(runtime, file));
  const { createSandboxRuntime } = await import(pathToFileURL(path.join(runtime, 'sandbox.mjs')).href);
  const image = (await exec(docker, ['image', 'inspect', process.env.AGENTDOCK_TEST_IMAGE || 'agentdock-dev:2026-10-28', '--format', '{{.Id}}'])).stdout.trim();
  await fs.writeFile(path.join(base, 'host-private-canary.txt'), 'host-private-canary');
  const gateway = await createSandboxRuntime({ roots: [workspace], stateDir: state, allowExec: true, sandbox: { enabled: true, image, dockerPath: docker, context: 'desktop-linux', allowOutbound: true } });
  t.after(async () => { await gateway.close(); if (base.startsWith(path.join(os.tmpdir(), 'agentdock-sandbox-test-'))) await fs.rm(base, { recursive: true, force: true }); });
  let id = 0;
  const call = async (name, args = {}, options = {}) => {
    const response = await gateway.handleRpc({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }, options);
    assert.notEqual(response.result.isError, true, response.result.content?.[0]?.text);
    return response.result.structuredContent;
  };
  const factsProgram = `const fs=require('fs'),os=require('os');const status=fs.readFileSync('/proc/self/status','utf8');let controlPipe=false,imageWritable=false;try{const fd=fs.openSync('/proc/1/fd/0','r');fs.closeSync(fd);controlPipe=true}catch{}try{fs.writeFileSync('/opt/bridge/probe','x');imageWritable=true}catch{}fs.writeFileSync('/workspace/probe.txt','workspace-ok');console.log(JSON.stringify({uid:process.getuid(),gid:process.getgid(),groups:process.getgroups(),capabilities:status.match(/^CapEff:\\s*(.+)$/m)[1],noNewPrivileges:status.match(/^NoNewPrivs:\\s*(.+)$/m)[1],controlPipe,imageWritable,dockerSocket:fs.existsSync('/var/run/docker.sock'),hostPath:fs.existsSync('/host'),privateCanary:fs.existsSync('/workspace/../host-private-canary.txt'),secrets:Object.keys(process.env).some(k=>/^(BRIDGE_TOKEN|OWNER_PASSWORD|[A-Z][A-Z0-9_]*_TOKEN)$/.test(k)),interfaces:Object.keys(os.networkInterfaces())}));`;
  const quote = value => "'" + value.replaceAll("'", "'\"'\"'") + "'";
  const command = await call('exec_command', { cmd: `set -eu; for tool in git python3 go rustc javac gcc cmake gh wrangler pnpm tsc; do command -v "$tool" >/dev/null; done; node -e ${quote(factsProgram)}`, timeout_ms: 20000 });
  assert.equal(command.exit_code, 0, command.stderr);
  const facts = JSON.parse(command.stdout);
  assert.equal(facts.uid, 1000); assert.equal(facts.gid, 1000);
  assert.ok(facts.groups.every(group => group === 1000));
  assert.match(facts.capabilities, /^0+$/); assert.equal(facts.noNewPrivileges, '1');
  for (const field of ['controlPipe', 'imageWritable', 'dockerSocket', 'hostPath', 'privateCanary', 'secrets']) assert.equal(facts[field], false, field);
  assert.deepEqual(facts.interfaces, ['lo']);
  assert.equal(await fs.readFile(path.join(workspace, 'probe.txt'), 'utf8'), 'workspace-ok');
  const read = await call('read_file', { path: '/workspace/probe.txt' });
  assert.equal(read.content ?? read.text, 'workspace-ok');
  await call('write_file', { path: '/workspace/created.txt', content: 'safe-write' });
  assert.equal(await fs.readFile(path.join(workspace, 'created.txt'), 'utf8'), 'safe-write');
  // The broker must reject text before serializing a command or path to Docker.
  for (const [name, args] of [
    ['exec_command', { cmd: 'touch /workspace/unicode-command.txt #\ud800' }],
    ['exec_command', { cmd: 'touch /workspace/unicode-cwd.txt', cwd: '/workspace/\udc00' }],
    ['write_file', { path: '/workspace/unicode-broker.txt', content: '\ud800' }],
    ['delete_file', { path: '/workspace/\ud800.txt' }],
  ]) {
    const denied = await gateway.handleRpc({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } });
    assert.equal(denied.result.isError, true);
    assert.match(denied.result.content[0].text, /Invalid Unicode/);
  }
  for (const file of ['unicode-command.txt', 'unicode-cwd.txt', 'unicode-broker.txt']) assert.equal(await fs.access(path.join(workspace, file)).then(() => true, () => false), false);
  // Check the baked file runtime independently of the broker's earlier rejection.
  const unicodeProgram = `import assert from 'node:assert/strict'; import fs from 'node:fs/promises'; import {createToolRuntime} from '/opt/bridge/local/tools.mjs'; const runtime=await createToolRuntime({roots:['/workspace'],stateDir:'/opt/private',sourceRoot:'/opt/bridge'}); let id=0; const call=(name,args)=>runtime.handleRpc({jsonrpc:'2.0',id:++id,method:'tools/call',params:{name,arguments:args}}); const bad=String.fromCharCode(0xd800); const valid='中文🙂 literal '+String.fromCodePoint(65533); await fs.writeFile('/workspace/unicode-original.txt',valid); for (const [name,args] of [['write_file',{path:'/workspace/unicode-image.txt',content:bad}],['edit_file',{path:'/workspace/unicode-original.txt',old_text:'中文',new_text:bad}],['read_file',{path:'/workspace/'+bad+'.txt'}]]) { const answer=await call(name,args); assert.equal(answer.result.isError,true); assert.match(answer.result.content[0].text,/Invalid Unicode/); } assert.equal(await fs.readFile('/workspace/unicode-original.txt','utf8'),valid); assert.equal(await fs.access('/workspace/unicode-image.txt').then(()=>true,()=>false),false); const accepted=await call('write_file',{path:'/workspace/unicode-valid.txt',content:valid}); assert.notEqual(accepted.result.isError,true); assert.equal(await fs.readFile('/workspace/unicode-valid.txt','utf8'),valid); await runtime.close(); console.log('unicode-policy-ok');`;
  const unicode = await call('exec_command', { cmd: `node --input-type=module -e ${quote(unicodeProgram)}`, timeout_ms: 10000 });
  assert.equal(unicode.exit_code, 0, unicode.stderr);
  assert.equal(unicode.stdout.trim(), 'unicode-policy-ok');
  const expected = createHash('sha256').update('safe-write').digest('hex');
  const updates = await Promise.all(['first', 'second'].map(content => gateway.handleRpc({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name: 'write_file', arguments: { path: '/workspace/created.txt', overwrite: true, expected_sha256: expected, content } } })));
  assert.equal(updates.filter(value => value.result.isError !== true).length, 1);
  assert.equal(updates.filter(value => value.result.isError === true).length, 1);
  const outside = await gateway.handleRpc({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name: 'read_file', arguments: { path: '/etc/passwd' } } });
  assert.equal(outside.result.isError, true);
  const timed = await call('exec_command', { cmd: 'sleep 10; touch /workspace/late.txt', timeout_ms: 500 });
  assert.equal(timed.running, false); assert.equal(timed.timed_out, true);
  const detached = await call('exec_command', { cmd: '(sleep 3; touch /workspace/orphan.txt) >/dev/null 2>&1 & exit 0', timeout_ms: 10000 });
  assert.equal(detached.running, false);
  await new Promise(resolve => setTimeout(resolve, 3500));
  assert.equal(await fs.access(path.join(workspace, 'orphan.txt')).then(() => true, () => false), false);
  assert.equal(await fs.access(path.join(workspace, 'late.txt')).then(() => true, () => false), false);
  const large = await call('exec_command', { cmd: `node -e ${quote("process.stdout.write('x'.repeat(8*1024*1024))")}`, max_output_bytes: 1024, timeout_ms: 10000 });
  assert.equal(large.exit_code, 0); assert.equal(large.truncated, true); assert.equal(Buffer.byteLength(large.stdout) + Buffer.byteLength(large.stderr), 1024);
  const clientA = { authorization: { clientId: 'isolated-test-client-a' } }, clientB = { authorization: { clientId: 'isolated-test-client-b' } };
  const background = await call('exec_command', { cmd: 'sleep 20', mode: 'background', timeout_ms: 25000 }, clientA);
  assert.equal(background.running, true);
  const otherClient = await gateway.handleRpc({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name: 'command_status', arguments: { command_id: background.command_id } } }, clientB);
  assert.equal(otherClient.result.isError, true);
  const stopped = await call('stop_command', { command_id: background.command_id }, clientA);
  assert.equal(stopped.running, false);
  assert.equal(stopped.cleanup_confirmed, true);
  const controller = new AbortController();
  const cancelled = gateway.handleRpc({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name: 'exec_command', arguments: { cmd: 'touch /workspace/cancelled-before-start.txt', timeout_ms: 10000 } } }, { signal: controller.signal });
  controller.abort();
  const cancelledResult = (await cancelled).result;
  assert.notEqual(cancelledResult.structuredContent?.running, true);
  assert.equal(await fs.access(path.join(workspace, 'cancelled-before-start.txt')).then(() => true, () => false), false);
  await gateway.close();
  const label = createHash('sha256').update(state.toLowerCase()).digest('hex').slice(0, 24);
  const remaining = await exec(docker, ['ps', '-aq', '--filter', `label=cbnv.agentdock.install=${label}`]);
  assert.equal(remaining.stdout.trim(), '');
});
