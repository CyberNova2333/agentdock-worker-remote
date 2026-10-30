import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { loadSecrets, proxyCandidates } from '../local/connector.mjs';

const exec = promisify(execFile);
const windows = process.platform === 'win32';
const systemRoot = process.env.SystemRoot || 'C:\\Windows';
const shellHome = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0');
const shell = path.join(shellHome, 'powershell.exe');
const secretScript = fileURLToPath(new URL('../scripts/Secrets.ps1', import.meta.url));
const safetyScript = fileURLToPath(new URL('../scripts/State-Safety.ps1', import.meta.url));
const quoted = value => `'${value.replaceAll("'", "''")}'`;
const safeEnv = { SystemRoot: systemRoot, WINDIR: systemRoot, USERPROFILE: os.homedir(),
  PATH: path.join(systemRoot, 'System32'), PSModulePath: path.join(shellHome, 'Modules') };
const ps = (code, env = safeEnv) => exec(shell, ['-NoProfile', '-NonInteractive', '-Command', code], {
  env, cwd: shellHome, windowsHide: true, timeout: 20000, maxBuffer: 65536,
});

async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.homedir(), '.agentdock-secret-test-'));
  t.after(async () => {
    assert.equal(path.dirname(base), os.homedir());
    assert.ok(path.basename(base).startsWith('.agentdock-secret-test-'));
    await fs.rm(base, { recursive: true, force: true });
  });
  await ps(`$ErrorActionPreference='Stop'; . ${quoted(safetyScript)};
    $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User;
    $acl=[Security.AccessControl.DirectorySecurity]::new();
    $acl.SetAccessRuleProtection($true,$false); $acl.SetOwner($sid);
    foreach($principal in @($sid,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'))){
      $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($principal,'FullControl','ContainerInherit,ObjectInherit','None','Allow'));
    }
    [IO.Directory]::SetAccessControl(${quoted(base)},$acl);`);
  const state = path.join(base, 'state');
  await fs.mkdir(state);
  // Synthetic values only; this fixture never reads the installed state directory.
  const expected = { bridgeToken: 'disposable-bridge-canary', ownerPassword: 'disposable-password-canary', ownerPasswordHash: 'disposable-hash-canary' };
  const payload = Buffer.from(JSON.stringify(expected), 'utf8').toString('base64');
  await ps(`$ErrorActionPreference='Stop'; . ${quoted(safetyScript)};
    Add-Type -AssemblyName System.Security;
    $plain=[Convert]::FromBase64String(${quoted(payload)});
    $entropy=[Text.Encoding]::UTF8.GetBytes('cbnv.agentdock-bridge.secrets.v1');
    try {
      $cipher=[Security.Cryptography.ProtectedData]::Protect($plain,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser);
      [IO.File]::WriteAllText(${quoted(path.join(state, 'secrets.dpapi'))},[Convert]::ToBase64String($cipher));
    } finally {[Array]::Clear($plain,0,$plain.Length)}`);
  const moduleRoot = path.join(base, 'modules');
  const markers = [];
  for (const [module, command] of [['Microsoft.PowerShell.Utility', 'Add-Type'], ['Microsoft.PowerShell.Management', 'Get-ItemProperty']]) {
    const directory = path.join(moduleRoot, module);
    await fs.mkdir(directory, { recursive: true });
    const marker = path.join(base, `${command}-loaded.txt`);
    markers.push(marker);
    await fs.writeFile(path.join(directory, `${module}.psd1`), `@{ RootModule='${module}.psm1'; ModuleVersion='99.0.0'; FunctionsToExport=@('${command}'); CmdletsToExport=@() }`);
    await fs.writeFile(path.join(directory, `${module}.psm1`), `[IO.File]::WriteAllText(${quoted(marker)},'synthetic module loaded'); function ${command} { throw 'SYNTHETIC_UNTRUSTED_MODULE' }`);
  }
  const poisonedEnv = { ...process.env, PSModulePath: `${moduleRoot};${safeEnv.PSModulePath}` };
  return { base, state, expected, markers, poisonedEnv };
}

test('credential subprocess and proxy discovery ignore inherited module paths', { skip: !windows, timeout: 80000 }, async t => {
  const { state, expected, markers, poisonedEnv } = await fixture(t);
  // The control proves that the fake module is discoverable without the fix.
  await assert.rejects(ps("$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security", poisonedEnv), /SYNTHETIC_UNTRUSTED_MODULE/);
  assert.equal(await fs.readFile(markers[0], 'utf8'), 'synthetic module loaded');
  await fs.unlink(markers[0]);
  const previous = process.env.PSModulePath;
  process.env.PSModulePath = poisonedEnv.PSModulePath;
  try {
    assert.deepEqual(loadSecrets(state), expected);
    assert.ok(Array.isArray(proxyCandidates()));
  } finally {
    if (previous === undefined) delete process.env.PSModulePath;
    else process.env.PSModulePath = previous;
  }
  for (const marker of markers) assert.equal(await fs.access(marker).then(() => true, () => false), false, 'No untrusted module may run');
});

test('direct credential export binds system modules before loading DPAPI data', { skip: !windows, timeout: 80000 }, async t => {
  const { state, expected, markers, poisonedEnv } = await fixture(t);
  const { stdout, stderr } = await exec(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', secretScript,
    '-Action', 'Export', '-StateDir', state], { env: poisonedEnv, windowsHide: true, timeout: 20000, maxBuffer: 65536 });
  assert.equal(stderr, '');
  assert.deepEqual(JSON.parse(stdout), expected);
  for (const marker of markers) assert.equal(await fs.access(marker).then(() => true, () => false), false);
});

test('credential failures expose neither captured shell streams nor raw parse errors', { skip: !windows, timeout: 60000 }, async t => {
  const { state } = await fixture(t);
  await fs.writeFile(path.join(state, 'secrets.dpapi'), 'synthetic-invalid-DPAPI');
  assert.throws(() => loadSecrets(state), error => {
    assert.equal(error.message, 'Protected credential loading failed. Check the trusted local installation.');
    for (const field of ['stdout', 'stderr', 'output', 'cause', 'cmd']) assert.equal(field in error, false);
    return true;
  });
});

test('credential creation protects the destination and refuses a linked state path', { skip: !windows, timeout: 80000 }, async t => {
  const { base, markers, poisonedEnv } = await fixture(t);
  const state = path.join(base, 'new-state');
  const runCreate = directory => exec(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', secretScript,
    '-Action', 'Create', '-StateDir', directory], { env: poisonedEnv, windowsHide: true, timeout: 20000, maxBuffer: 65536 });
  const created = await runCreate(state);
  assert.equal(created.stderr, '');
  assert.ok((await fs.stat(path.join(state, 'secrets.dpapi'))).size > 0);
  await ps(`$ErrorActionPreference='Stop'; . ${quoted(safetyScript)}; $null=Assert-PrivateState ${quoted(state)}`);
  for (const marker of markers) assert.equal(await fs.access(marker).then(() => true, () => false), false);
  const target = path.join(base, 'empty-target'), link = path.join(base, 'linked-state');
  await fs.mkdir(target);
  const permission = async () => (await ps(`$ErrorActionPreference='Stop'; . ${quoted(safetyScript)}; (Get-Acl -LiteralPath ${quoted(target)}).Sddl`)).stdout.trim();
  const beforePermission = await permission();
  await fs.symlink(target, link, 'junction');
  try { await assert.rejects(runCreate(link), /symbolic links|junctions/); }
  finally { await fs.unlink(link); }
  assert.deepEqual(await fs.readdir(target), []);
  assert.equal(await permission(), beforePermission, 'Rejected linked paths must preserve target permissions');
});
