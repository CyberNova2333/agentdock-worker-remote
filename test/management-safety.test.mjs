import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const exec = promisify(execFile);
const shell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const quoted = value => `'${value.replaceAll("'", "''")}'`;
const helper = fileURLToPath(new URL('../scripts/State-Safety.ps1', import.meta.url));
const ps = script => exec(shell, ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference='Stop'; . ${quoted(helper)}; ${script}`], { windowsHide: true, timeout: 15000, maxBuffer: 65536 });
const protect = (file, directory = true) => ps(`
  $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User;
  $acl=[Security.AccessControl.${directory ? 'DirectorySecurity' : 'FileSecurity'}]::new();
  $acl.SetAccessRuleProtection($true,$false); $acl.SetOwner($sid);
  foreach($principal in @($sid,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'))){
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($principal,'FullControl','${directory ? 'ContainerInherit,ObjectInherit' : 'None'}','None','Allow'));
  }
  [IO.${directory ? 'Directory' : 'File'}]::SetAccessControl(${quoted(file)},$acl);`);
const grantModify = file => ps(`$acl=Get-Acl -LiteralPath ${quoted(file)}; $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-11'),'Modify','Allow')); Set-Acl -LiteralPath ${quoted(file)} -AclObject $acl;`);

async function privateFixture(t) {
  const base = await fs.mkdtemp(path.join(os.homedir(), '.agentdock-management-test-'));
  t.after(async () => {
    assert.equal(path.dirname(base), os.homedir());
    assert.ok(path.basename(base).startsWith('.agentdock-management-test-'));
    await fs.rm(base, { recursive: true, force: true });
  });
  await protect(base);
  const root = path.join(base, 'project'), state = path.join(base, 'state'), bin = path.join(state, 'bin');
  await fs.mkdir(root); await fs.mkdir(state); await fs.mkdir(bin);
  const binary = path.join(bin, 'node.exe');
  await fs.writeFile(binary, 'fake Node canary; never executed');
  return { base, root, state, bin, binary };
}

test('installation rejects linked control files and active recorded processes', { skip: process.platform !== 'win32' }, async t => {
  const base = await fs.mkdtemp(path.join(os.homedir(), '.agentdock-management-test-'));
  await protect(base);
  const root = path.join(base, 'project'), control = path.join(base, 'control');
  await fs.mkdir(root); await fs.mkdir(control);
  const binary = path.join(control, 'launcher.txt');
  await fs.writeFile(binary, 'fake launcher, never executed');
  t.after(async () => { assert.equal(path.dirname(base), os.homedir()); assert.ok(path.basename(base).startsWith('.agentdock-management-test-')); await fs.rm(base, { recursive: true, force: true }); });
  assert.match((await ps(`Assert-TrustedBinary ${quoted(binary)} ${quoted(root)}`)).stdout, /launcher\.txt/);
  const alias = path.join(root, 'alias.txt');
  await fs.link(binary, alias);
  await assert.rejects(ps(`Assert-TrustedBinary ${quoted(binary)} ${quoted(root)}`), /hard-link/);
  await fs.unlink(alias);
  const junction = path.join(base, 'junction');
  await fs.symlink(control, junction, 'junction');
  await assert.rejects(ps(`Assert-PlainLocalPath ${quoted(path.join(junction, 'launcher.txt'))}`), /junctions/);
  await fs.unlink(junction);
  const state = path.join(base, 'state'); await fs.mkdir(state);
  const outcome = await ps(`$p=Get-Process -Id $PID; @{pid=$p.Id;executable=$p.Path;startTime=$p.StartTime.ToUniversalTime().Ticks.ToString()} | ConvertTo-Json | Set-Content -LiteralPath ${quoted(path.join(state, 'supervisor.json'))}; try { Assert-ConnectorStopped ${quoted(state)}; 'UNEXPECTED' } catch { 'BLOCKED_ACTIVE_PROCESS' }`);
  assert.match(outcome.stdout, /BLOCKED_ACTIVE_PROCESS/);
  assert.doesNotMatch(outcome.stdout, /UNEXPECTED/);
});

test('control binaries reject writable files and parents even when the other layer is protected', { skip: process.platform !== 'win32' }, async t => {
  const { base, root, bin, binary } = await privateFixture(t);
  assert.match((await ps(`Assert-TrustedBinary ${quoted(binary)} ${quoted(root)}`)).stdout, /node\.exe/);
  await grantModify(binary);
  await assert.rejects(ps(`Assert-TrustedBinary ${quoted(binary)} ${quoted(root)}`), /writ|permission|untrusted|ACL/i);
  await protect(binary, false);
  await grantModify(bin);
  await assert.rejects(ps(`Assert-TrustedBinary ${quoted(binary)} ${quoted(root)}`), /writ|permission|untrusted|ACL/i);
  await protect(bin);
  assert.match((await ps(`Assert-TrustedBinary ${quoted(binary)} ${quoted(root)}`)).stdout, /node\.exe/);
  await ps(`$acl=[Security.AccessControl.DirectorySecurity]::new(${quoted(base)},[Security.AccessControl.AccessControlSections]::Access); $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-11'),'DeleteSubdirectoriesAndFiles','Allow')); [IO.Directory]::SetAccessControl(${quoted(base)},$acl);`);
  await assert.rejects(ps(`Assert-TrustedBinary ${quoted(binary)} ${quoted(root)}`), /writ|permission|untrusted|ACL/i);
  await protect(base);
  // Creating unrelated children higher in the tree must not be confused with
  // permission to replace an existing protected ancestor or executable.
  await ps(`$acl=[Security.AccessControl.DirectorySecurity]::new(${quoted(base)},[Security.AccessControl.AccessControlSections]::Access); $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-11'),'CreateDirectories','Allow')); [IO.Directory]::SetAccessControl(${quoted(base)},$acl);`);
  assert.match((await ps(`Assert-TrustedBinary ${quoted(binary)} ${quoted(root)}`)).stdout, /node\.exe/);
});

test('private Node checks require the configured checksum and a private-state path', { skip: process.platform !== 'win32' }, async t => {
  const { base, root, state, binary } = await privateFixture(t);
  const pinnedHash = createHash('sha256').update(await fs.readFile(binary)).digest('hex');
  const configuration = `$config=@{nodePath=${quoted(binary)}; nodeSha256=${quoted(pinnedHash)}; roots=@(${quoted(root)})};`;
  assert.match((await ps(`${configuration} $null=Assert-PinnedNode $config ${quoted(state)}; 'PINNED_NODE_OK'`)).stdout, /PINNED_NODE_OK/);
  await assert.rejects(ps(`${configuration} $config.nodeSha256='0'*64; Assert-PinnedNode $config ${quoted(state)}`), /hash|checksum|integrity|match/i);
  await assert.rejects(ps(`${configuration} $config.nodeSha256='invalid'; Assert-PinnedNode $config ${quoted(state)}`), /hash|checksum|integrity|invalid|missing/i);
  const external = path.join(base, 'outside-node.exe');
  await fs.writeFile(external, 'outside fake Node; never executed');
  await assert.rejects(ps(`${configuration} $config.nodePath=${quoted(external)}; $config.nodeSha256=(Get-FileHash -LiteralPath ${quoted(external)} -Algorithm SHA256).Hash.ToLowerInvariant(); Assert-PinnedNode $config ${quoted(state)}`), /private|state|outside/i);
  await fs.writeFile(binary, 'modified fake Node; never executed');
  const mismatch = await ps(`${configuration} try {$null=Assert-PinnedNode $config ${quoted(state)}; 'UNEXPECTED'} catch {'CHANGED_BINARY_BLOCKED'}`);
  assert.match(mismatch.stdout, /CHANGED_BINARY_BLOCKED/);
  assert.doesNotMatch(mismatch.stdout, /UNEXPECTED/);
});

test('private Node can use an independently protected toolchain root and rejects unrelated files', { skip: process.platform !== 'win32' }, async t => {
  const { base, root, state } = await privateFixture(t);
  const nodeRoot = path.join(base, 'toolchains');
  await fs.mkdir(nodeRoot);
  const binary = path.join(nodeRoot, 'node.exe');
  await fs.writeFile(binary, 'fake isolated toolchain; never executed');
  const configuration = `$config=@{nodePath=${quoted(binary)};nodeRoot=${quoted(nodeRoot)};nodeSha256=(Get-FileHash -LiteralPath ${quoted(binary)} -Algorithm SHA256).Hash.ToLowerInvariant();roots=@(${quoted(root)})};`;
  assert.match((await ps(`${configuration} $null=Assert-PinnedNode $config ${quoted(state)}; 'TOOLCHAIN_OK'`)).stdout, /TOOLCHAIN_OK/);
  const other = path.join(base, 'other-node.exe'); await fs.writeFile(other, 'unrelated fake executable');
  await assert.rejects(ps(`${configuration} $config.nodePath=${quoted(other)}; $config.nodeSha256=(Get-FileHash -LiteralPath ${quoted(other)} -Algorithm SHA256).Hash.ToLowerInvariant(); Assert-PinnedNode $config ${quoted(state)}`), /private|toolchain|outside|inside/i);
});

test('host Node launch clears ambient runtime and TLS overrides', { skip: process.platform !== 'win32' }, async () => {
  const names = ['NODE_OPTIONS', 'NODE_PATH', 'NODE_TLS_REJECT_UNAUTHORIZED', 'NODE_EXTRA_CA_CERTS'];
  const variables = names.map(quoted).join(',');
  const outcome = await ps(`$names=@(${variables}); foreach($name in $names){[Environment]::SetEnvironmentVariable($name,'fake-test-override','Process')}; Clear-NodeOverrides; foreach($name in $names){if([Environment]::GetEnvironmentVariable($name,'Process')){throw 'Override survived'}}; 'NODE_OVERRIDES_CLEARED'`);
  assert.match(outcome.stdout, /NODE_OVERRIDES_CLEARED/);
});

test('private-state validation checks directory type and the full ancestor trust chain', { skip: process.platform !== 'win32' }, async t => {
  const { state, binary } = await privateFixture(t);
  assert.match((await ps(`Assert-PrivateState ${quoted(state)}`)).stdout, /state/);
  await assert.rejects(ps(`Assert-PrivateState ${quoted(binary)}`), /directory/i);
  // Inspect a synthetic untrusted ancestor descriptor through the real walker;
  // never grant another principal permissions on the machine to test rejection.
  const script = `$target=${quoted(state)};
    function Get-Acl {
      param([string]$LiteralPath)
      $actual=Microsoft.PowerShell.Security\\Get-Acl -LiteralPath $LiteralPath;
      if($LiteralPath -eq [IO.Path]::GetDirectoryName($target)) {
        $descriptor=[Security.AccessControl.DirectorySecurity]::new();
        $descriptor.SetOwner([Security.Principal.WindowsIdentity]::GetCurrent().User);
        $descriptor.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-11'),'DeleteSubdirectoriesAndFiles','Allow'));
        return $descriptor;
      }
      return $actual;
    }
    Assert-PrivateState $target;`;
  await assert.rejects(ps(script), /writable|untrusted/i);
});

test('private-state checks load the Windows core module instead of an inherited module shadow', { skip: process.platform !== 'win32' }, async t => {
  const base = await fs.mkdtemp(path.join(os.homedir(), '.agentdock-management-test-'));
  t.after(async () => {
    assert.equal(path.dirname(base), os.homedir());
    assert.ok(path.basename(base).startsWith('.agentdock-management-test-'));
    await fs.rm(base, { recursive: true, force: true });
  });
  await protect(base);
  const state = path.join(base, 'state');
  const modules = path.join(base, 'shadow-modules');
  const shadow = path.join(modules, 'Microsoft.PowerShell.Security');
  const marker = path.join(base, 'shadow-loaded.txt');
  await fs.mkdir(state);
  await fs.mkdir(shadow, { recursive: true });
  await fs.writeFile(path.join(shadow, 'Microsoft.PowerShell.Security.psd1'), "@{ RootModule='Microsoft.PowerShell.Security.psm1'; ModuleVersion='99.0.0'; FunctionsToExport=@('Get-Acl'); CmdletsToExport=@() }");
  await fs.writeFile(path.join(shadow, 'Microsoft.PowerShell.Security.psm1'), `[IO.File]::WriteAllText(${quoted(marker)},'untrusted module loaded'); throw 'SHADOW_MODULE_MUST_NOT_LOAD'; function Get-Acl { throw 'SHADOW_MODULE_MUST_NOT_LOAD' }`);
  // Confirm this fixture really poisons automatic discovery; otherwise a pass
  // would not exercise the inherited-module regression.
  const poisoned = `$ErrorActionPreference='Stop'; Remove-Module Microsoft.PowerShell.Security -ErrorAction SilentlyContinue; $env:PSModulePath=${quoted(modules)}+';'+$env:PSModulePath; Get-Acl -LiteralPath ${quoted(state)}`;
  await assert.rejects(exec(shell, ['-NoProfile', '-NonInteractive', '-Command', poisoned], { windowsHide: true, timeout: 15000, maxBuffer: 65536 }));
  assert.equal(await fs.readFile(marker, 'utf8'), 'untrusted module loaded');
  await fs.unlink(marker);
  const script = `$ErrorActionPreference='Stop';
    $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User;
    $acl=[Security.AccessControl.DirectorySecurity]::new();
    $acl.SetAccessRuleProtection($true,$false);
    $acl.SetOwner($sid);
    foreach($principal in @($sid,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'))){
      $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($principal,'FullControl','ContainerInherit,ObjectInherit','None','Allow'));
    }
    [IO.Directory]::SetAccessControl(${quoted(state)},$acl);
    Remove-Module Microsoft.PowerShell.Security -ErrorAction SilentlyContinue;
    $env:PSModulePath=${quoted(modules)}+';'+$env:PSModulePath;
    . ${quoted(helper)};
    $null=Assert-PrivateState ${quoted(state)};
    [Console]::Write('SAFE_STATE');`;
  const outcome = await exec(shell, ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 15000, maxBuffer: 65536 });
  assert.equal(outcome.stdout.trim(), 'SAFE_STATE');
  assert.equal(await fs.access(marker).then(() => true, () => false), false, 'The shadow module must never execute');
});
