import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createWindowsReplacementGuard } from '../local/windows-acl.mjs';
import { createSandboxRuntime } from '../local/sandbox.mjs';

const exec = promisify(execFile);
const shell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const quoted = value => `'${value.replaceAll("'", "''")}'`;
const ps = async script => (await exec(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(`$ErrorActionPreference='Stop'; ${script}`, 'utf16le').toString('base64')], { env: { ...process.env, PSModulePath: path.join(path.dirname(shell), 'Modules') }, windowsHide: true, timeout: 15000, maxBuffer: 8192 })).stdout.trim();
const descriptor = file => ps(`(Get-Acl -LiteralPath ${quoted(file)}).Sddl`);
async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdock-acl-test-'));
  const workspace = path.join(base, 'workspace'); await fs.mkdir(workspace);
  t.after(async () => { assert.ok(base.startsWith(path.join(os.tmpdir(), 'agentdock-acl-test-'))); await fs.rm(base, { recursive: true, force: true }); });
  const ordinary = path.join(workspace, 'ordinary.txt'), protectedFile = path.join(workspace, 'private.txt'), explicitFile = path.join(workspace, 'explicit.txt');
  for (const file of [ordinary, protectedFile, explicitFile]) await fs.writeFile(file, 'canary-original');
  await ps(`$a=Get-Acl -LiteralPath ${quoted(protectedFile)}; $a.SetAccessRuleProtection($true,$true); Set-Acl -LiteralPath ${quoted(protectedFile)} -AclObject $a; $b=Get-Acl -LiteralPath ${quoted(explicitFile)}; $user=[Security.Principal.WindowsIdentity]::GetCurrent().User; $rule=[Security.AccessControl.FileSystemAccessRule]::new($user,[Security.AccessControl.FileSystemRights]::Read,[Security.AccessControl.AccessControlType]::Allow); $b.AddAccessRule($rule); Set-Acl -LiteralPath ${quoted(explicitFile)} -AclObject $b`);
  return { base, workspace, ordinary, protectedFile, explicitFile };
}

test('Windows replacement preflight rejects custom ACLs and aliases without changing files', { skip: process.platform !== 'win32', timeout: 45000 }, async t => {
  const { base, workspace, ordinary, protectedFile, explicitFile } = await fixture(t);
  const guard = await createWindowsReplacementGuard(workspace);
  await guard('/workspace/ordinary.txt');
  await guard('/workspace/new-file.txt');
  for (const file of [protectedFile, explicitFile]) {
    const before = await descriptor(file);
    await assert.rejects(guard(`/workspace/${path.basename(file)}`), /custom Windows file permissions/);
    assert.equal(await descriptor(file), before);
    assert.equal(await fs.readFile(file, 'utf8'), 'canary-original');
  }
  await assert.rejects(guard('/workspace/ordinary.txt:stream'), /ambiguous Windows file paths/);
  await assert.rejects(guard('/workspace/ordinary.txt.'), /ambiguous Windows file paths/);
  await assert.rejects(guard('/workspace/missing-parent/new.txt'), /replacement was refused/);
  await fs.link(ordinary, path.join(workspace, 'hardlink.txt'));
  await assert.rejects(guard('/workspace/hardlink.txt'), /replacement was refused/);
  await fs.unlink(path.join(workspace, 'hardlink.txt'));
  const outside = path.join(base, 'outside'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'canary.txt'), 'outside-canary');
  await fs.symlink(outside, path.join(workspace, 'junction'), 'junction');
  await assert.rejects(guard('/workspace/junction/canary.txt'), /replacement was refused/);
  await fs.unlink(path.join(workspace, 'junction'));
});

test('Docker file editing preserves custom NTFS ACLs by refusing replacement, while inherited files stay editable', { skip: process.platform !== 'win32' || process.env.AGENTDOCK_DOCKER_TEST !== '1', timeout: 240000 }, async t => {
  const { base, workspace, ordinary, protectedFile } = await fixture(t);
  const state = path.join(base, 'state'); await fs.mkdir(state);
  const dockerPath = 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe';
  const image = (await exec(dockerPath, ['image', 'inspect', process.env.AGENTDOCK_TEST_IMAGE || 'agentdock-dev:2026-10-28', '--format', '{{.Id}}'], { timeout: 15000 })).stdout.trim();
  const runtime = await createSandboxRuntime({ roots: [workspace], stateDir: state, allowExec: true, sandbox: { enabled: true, image, dockerPath, context: 'desktop-linux', allowOutbound: false } });
  try {
    let id = 0;
    const call = (name, args) => runtime.handleRpc({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } });
    const before = await descriptor(protectedFile);
    for (const [name, args] of [['edit_file', { old_text: 'canary-original', new_text: 'canary-edited' }], ['write_file', { overwrite: true, content: 'canary-replaced' }]]) {
      const response = await call(name, { path: '/workspace/private.txt', ...args });
      assert.equal(response.result.isError, true);
      assert.match(response.result.content[0].text, /custom Windows file permissions/);
      assert.equal(await fs.readFile(protectedFile, 'utf8'), 'canary-original');
      assert.equal(await descriptor(protectedFile), before);
    }
    const edited = await call('edit_file', { path: '/workspace/ordinary.txt', old_text: 'canary-original', new_text: 'canary-edited' });
    assert.notEqual(edited.result.isError, true, edited.result.content[0].text);
    assert.equal(await fs.readFile(ordinary, 'utf8'), 'canary-edited');
  } finally { await runtime.close(); }
});
