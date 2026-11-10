param(
  [ValidateSet('Create','Export','ShowPassword','Upload')][string]$Action,
  [string]$StateDir=([IO.Path]::Combine([Environment]::GetFolderPath('UserProfile'),'.agentdock-bridge'))
)
$ErrorActionPreference='Stop'
# Bind core cmdlets before invoking any automatically discovered module. This is
# also required for direct use: imports in a parent PowerShell do not cross into
# the connector's fresh credential-export process.
. ([IO.Path]::Combine($PSScriptRoot,'State-Safety.ps1'))
Add-Type -AssemblyName System.Security
$file=Join-Path $StateDir 'secrets.dpapi'
$entropy=[Text.Encoding]::UTF8.GetBytes('cbnv.agentdock-bridge.secrets.v1')
if($Action -eq 'Create') {
  Assert-WriteProtectedPath ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($StateDir)))
  if(Test-Path -LiteralPath $StateDir){Assert-WriteProtectedPath $StateDir}
  if(Test-Path -LiteralPath $file){throw 'Secrets already exist; preserve them.'}
  if((Test-Path -LiteralPath $StateDir) -and @(Get-ChildItem -LiteralPath $StateDir -Force).Count -gt 0){throw 'Credential directory is not empty; inspect it before setup.'}
  New-Item -ItemType Directory -Path $StateDir -Force | Out-Null
  $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  & ([IO.Path]::Combine([Environment]::SystemDirectory,'icacls.exe')) $StateDir /inheritance:r /grant:r "*$($sid):(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
  if($LASTEXITCODE -ne 0){throw 'Cannot protect the credential directory.'}
  $unexpected=@((Get-Acl -LiteralPath $StateDir).Access | Where-Object {$_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin @($sid,'S-1-5-18')})
  if($unexpected.Count -gt 0){throw 'Credential directory has other explicit access rules; no secrets were saved.'}
  $null=Assert-PrivateState $StateDir
  function RandomBytes([int]$count) {
    $b=New-Object byte[] $count
    $rng=[Security.Cryptography.RandomNumberGenerator]::Create()
    try{$rng.GetBytes($b)}finally{$rng.Dispose()}
    return ,$b
  }
  function Url64([byte[]]$b){return [Convert]::ToBase64String($b).TrimEnd('=').Replace('+','-').Replace('/','_')}
  $password=Url64 (RandomBytes 24)
  $salt=RandomBytes 16
  $derive=[Security.Cryptography.Rfc2898DeriveBytes]::new($password,$salt,100000,[Security.Cryptography.HashAlgorithmName]::SHA256)
  try{$hash='pbkdf2-sha256$100000$'+(Url64 $salt)+'$'+(Url64 $derive.GetBytes(32))}finally{$derive.Dispose()}
  $data=@{bridgeToken=(Url64 (RandomBytes 32));ownerPassword=$password;ownerPasswordHash=$hash}
  $plain=[Text.Encoding]::UTF8.GetBytes(($data|ConvertTo-Json -Compress))
  try {
    $cipher=[Security.Cryptography.ProtectedData]::Protect($plain,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
    [IO.File]::WriteAllText($file,[Convert]::ToBase64String($cipher),[Text.UTF8Encoding]::new($false))
  } finally {[Array]::Clear($plain,0,$plain.Length);$data=$null;$password=$null}
  'Credentials created and encrypted for the current Windows user.'
  exit 0
}
$null=Assert-PrivateState $StateDir
$cipher=[Convert]::FromBase64String(([IO.File]::ReadAllText($file)).Trim())
$plain=[Security.Cryptography.ProtectedData]::Unprotect($cipher,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
try {
  $data=[Text.Encoding]::UTF8.GetString($plain)|ConvertFrom-Json
  if($Action -eq 'Export') {
    # Only consumed through an in-memory pipe by the connector/acceptance script.
    [Console]::Write(($data|ConvertTo-Json -Compress))
  } elseif($Action -eq 'ShowPassword') {
    Add-Type -AssemblyName System.Windows.Forms
    $configFile=Join-Path $StateDir 'config.json'
    $site=if(Test-Path -LiteralPath $configFile){(Get-Content -LiteralPath $configFile -Raw|ConvertFrom-Json).origin}else{'your bridge origin'}
    [Windows.Forms.MessageBox]::Show($data.ownerPassword,"$site - login password (do not share)") | Out-Null
  } elseif($Action -eq 'Upload') {
    $root=Split-Path -Parent $PSScriptRoot
    $wrangler=Join-Path $root 'node_modules\.bin\wrangler.cmd'
    $json=@{BRIDGE_TOKEN=$data.bridgeToken;OWNER_PASSWORD_HASH=$data.ownerPasswordHash}|ConvertTo-Json -Compress
    $json | & $wrangler secret bulk --config (Join-Path $root 'wrangler.jsonc')
    if($LASTEXITCODE -ne 0){throw 'Cloud secret upload failed.'}
  }
} finally {[Array]::Clear($plain,0,$plain.Length);$data=$null;$json=$null}
