import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const refusal = 'Atomic replacement cannot preserve custom Windows file permissions. Use a local Windows editor for this file.';
// Fixed code only: the requested paths are JSON data, never PowerShell source.
// This process only reads path attributes and security descriptors, not contents.
const checkScript = `
$ErrorActionPreference='Stop'
$request=$env:AGENTDOCK_ACL_REQUEST | ConvertFrom-Json
$root=[IO.Path]::GetFullPath($request.root).TrimEnd('\\')
$target=[IO.Path]::GetFullPath($request.target)
if(-not $target.StartsWith($root+'\\',[StringComparison]::OrdinalIgnoreCase)){throw 'Outside workspace'}
$relative=$target.Substring($root.Length+1)
foreach($part in $relative.Split('\\')) {
  if(-not $part -or $part -match '[\\x00-\\x1f:*?"<>|]' -or $part.EndsWith('.') -or $part.EndsWith(' ')){throw 'Ambiguous path'}
}
$cursor=$target
$first=$true
$exists=$true
while($cursor) {
  try {$item=Get-Item -LiteralPath $cursor -Force -ErrorAction Stop}
  catch [System.Management.Automation.ItemNotFoundException] {
    if(-not $first){throw}
    $exists=$false; $item=$null
  }
  if($item) {
    if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Reparse path'}
    if($first -and $item.PSIsContainer){throw 'Not a regular file'}
    if(-not $first -and -not $item.PSIsContainer){throw 'Not a directory'}
  }
  $first=$false
  $parent=[IO.Path]::GetDirectoryName($cursor)
  if(-not $parent -or $parent -eq $cursor){break}
  $cursor=$parent
}
$allowed=$true
if($exists) {
  $acl=Get-Acl -LiteralPath $target -ErrorAction Stop
  $rules=@($acl.Access)
  $owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
  $user=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $allowed=-not $acl.AreAccessRulesProtected -and $acl.AreAccessRulesCanonical -and $rules.Count -gt 0 -and @($rules | Where-Object {-not $_.IsInherited}).Count -eq 0 -and $owner -eq $user
}
@{allowed=[bool]$allowed;exists=[bool]$exists} | ConvertTo-Json -Compress
`;

export async function createWindowsReplacementGuard(root) {
  if (process.platform !== 'win32') return async () => {};
  if (!path.isAbsolute(root) || root.startsWith('\\\\')) throw new Error('A local Windows workspace is required.');
  const systemRoot = process.env.SystemRoot || process.env.WINDIR;
  if (!systemRoot || !path.isAbsolute(systemRoot)) throw new Error('Cannot locate the Windows ACL verifier.');
  const requested = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const executable = await fs.realpath(requested);
  const executableInfo = await fs.lstat(executable);
  const relativeExecutable = path.relative(root.toLowerCase(), executable.toLowerCase());
  // Windows servicing normally hard-links system executables into WinSxS.
  // Trust the canonical OS location, but never one inside the project mount.
  if (executable.toLowerCase() !== requested.toLowerCase() || !executableInfo.isFile() || (!path.isAbsolute(relativeExecutable) && relativeExecutable !== '..' && !relativeExecutable.startsWith(`..${path.sep}`))) throw new Error('Windows ACL verifier is not a trusted executable.');
  const encoded = Buffer.from(checkScript, 'utf16le').toString('base64');
  return async containerPath => {
    if (typeof containerPath !== 'string' || !containerPath.startsWith('/workspace/') || containerPath.length > 32700) throw new Error('Cannot verify Windows file permissions.');
    const relative = containerPath.slice('/workspace/'.length);
    const components = relative.split('/');
    if (components.some(value => !value || value === '.' || value === '..' || /[\x00-\x1f:*?"<>|\\]/.test(value) || /[. ]$/.test(value))) throw new Error('Cannot verify ambiguous Windows file paths.');
    const target = path.join(root, ...components);
    let before;
    try {
      before = await fs.lstat(target).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
      if (before && (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1)) throw new Error('Unsafe file identity.');
      const env = { SystemRoot: systemRoot, WINDIR: systemRoot, PSModulePath: path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules'), AGENTDOCK_ACL_REQUEST: JSON.stringify({ root, target }) };
      const { stdout } = await exec(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { env, windowsHide: true, timeout: 10000, maxBuffer: 4096 });
      const response = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
      if (response.allowed === false) throw new Error(refusal);
      if (response.allowed !== true || response.exists !== Boolean(before)) throw new Error('Unverified file permissions.');
      const after = await fs.lstat(target).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
      if (Boolean(before) !== Boolean(after) || (after && (!after.isFile() || after.isSymbolicLink() || after.nlink !== 1 || before.dev !== after.dev || before.ino !== after.ino || before.ctimeMs !== after.ctimeMs))) throw new Error('File identity changed.');
    } catch (error) {
      // Shell diagnostics can contain attacker-controlled paths; do not relay them.
      if (error.message === refusal) throw error;
      throw new Error('Cannot verify Windows file permissions; replacement was refused.');
    }
  };
}
