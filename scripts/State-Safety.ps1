# Shared installation checks. This module never reads or prints secret values.
# A launcher can inherit PowerShell 7's PSModulePath while running Windows
# PowerShell 5.1. Pin core modules to this executable's own installation.
foreach($moduleName in @('Microsoft.PowerShell.Management','Microsoft.PowerShell.Utility','Microsoft.PowerShell.Security')) {
  Import-Module -Name "$PSHOME\Modules\$moduleName\$moduleName.psd1" -ErrorAction Stop
}

function Assert-PlainLocalPath([string]$LiteralPath) {
  if(-not [IO.Path]::IsPathRooted($LiteralPath) -or $LiteralPath.StartsWith('\\')){throw 'A local absolute path is required.'}
  $resolved=[IO.Path]::GetFullPath($LiteralPath).TrimEnd('\')
  $cursor=$resolved
  while($cursor){
    $item=Get-Item -LiteralPath $cursor -Force -ErrorAction Stop
    if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Control paths must not contain symbolic links or junctions.'}
    $parent=[IO.Path]::GetDirectoryName($cursor)
    if(-not $parent -or $parent -eq $cursor){break}
    $cursor=$parent
  }
  return $resolved
}

function Assert-PrivateState([string]$StateDir) {
  $resolved=Assert-PlainLocalPath $StateDir
  if(-not (Get-Item -LiteralPath $resolved -Force).PSIsContainer){throw 'Private state must be a directory.'}
  # Restrict the entire control path, not just the final directory ACL. A
  # writable ancestor can allow replacement of an otherwise private runtime.
  Assert-WriteProtectedPath $resolved
  $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $unexpected=@((Get-Acl -LiteralPath $resolved).Access | Where-Object {
    $_.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin @($sid,'S-1-5-18')
  })
  if($unexpected.Count){throw 'Private state allows another principal. Installation or rotation stopped.'}
  return $resolved
}

function Assert-ConnectorStopped([string]$StateDir) {
  foreach($name in @('supervisor.json','connector-process.json')) {
    $file=Join-Path $StateDir $name
    if(-not(Test-Path -LiteralPath $file)){continue}
    $record=Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
    $process=Get-Process -Id $record.pid -ErrorAction SilentlyContinue
    if($process -and $process.Path -ieq $record.executable -and $process.StartTime.ToUniversalTime().Ticks.ToString() -ceq $record.startTime){throw 'Stop the current connector before installing or rotating credentials.'}
  }
}

function Assert-TrustedBinary([string]$LiteralPath,[string]$Workspace) {
  $resolved=Assert-PlainLocalPath $LiteralPath
  $work=[IO.Path]::GetFullPath($Workspace).TrimEnd('\')
  if($resolved -ieq $work -or $resolved.StartsWith($work+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Control executables must be outside the mounted workspace.'}
  if(-not('AgentDockFileIdentity' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class AgentDockFileIdentity {
  [StructLayout(LayoutKind.Sequential)] struct Info {
    public uint attributes; public System.Runtime.InteropServices.ComTypes.FILETIME creation, access, write;
    public uint volume, sizeHigh, sizeLow, links, indexHigh, indexLow;
  }
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle file, out Info info);
  public static uint Links(string path) {
    using(var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete)) {
      Info info; if(!GetFileInformationByHandle(file.SafeFileHandle, out info)) throw new IOException("Cannot verify executable identity");
      return info.links;
    }
  }
}
'@
  }
  if([AgentDockFileIdentity]::Links($resolved) -ne 1){throw 'Control executables must not have hard-link aliases.'}
  Assert-WriteProtectedPath $resolved
  return $resolved
}

function Assert-WriteProtectedPath([string]$LiteralPath) {
  $cursor=Assert-PlainLocalPath $LiteralPath
  $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $trusted=@($sid,'S-1-5-18','S-1-5-32-544','S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')
  $level=0
  while($cursor) {
    $acl=Get-Acl -LiteralPath $cursor
    if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $trusted){throw 'A control path has an untrusted owner.'}
    # The binary and its directory must also reject file creation/DLL planting.
    # Higher ancestors may allow creating unrelated directories, but never
    # changing/deleting our existing path or changing its security descriptor.
    $mask=if($level -le 1){[long]0x000D0156}else{[long]0x000D0150}
    foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
      if($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly)){continue}
      if($rule.IdentityReference.Value -in $trusted){continue}
      $rights=([long]$rule.FileSystemRights -band [long]4294967295)
      if(($rights -band $mask) -or ($rights -band [long]0x50000000)){throw 'A control executable or parent directory is writable by an untrusted principal.'}
    }
    $parent=[IO.Path]::GetDirectoryName($cursor)
    if(-not $parent -or $parent -eq $cursor){break}
    $cursor=$parent; $level++
  }
}

function Assert-PinnedNode($Config,[string]$StateDir) {
  $private=Assert-PrivateState $StateDir
  if($Config.nodeRoot){$private=Assert-PrivateState $Config.nodeRoot}
  $node=Assert-TrustedBinary $Config.nodePath $Config.roots[0]
  if(-not $node.StartsWith($private+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Node must be installed inside its private runtime directory.'}
  if($Config.nodeSha256 -notmatch '^[a-f0-9]{64}$' -or (Get-FileHash -LiteralPath $node -Algorithm SHA256).Hash -ine $Config.nodeSha256){throw 'Pinned Node integrity check failed.'}
  return $node
}

function Clear-NodeOverrides {
  foreach($name in @('NODE_OPTIONS','NODE_PATH','NODE_TLS_REJECT_UNAUTHORIZED','NODE_EXTRA_CA_CERTS')) {
    [Environment]::SetEnvironmentVariable($name,$null,'Process')
  }
}
