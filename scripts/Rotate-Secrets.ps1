param(
  [string]$StateDir=([IO.Path]::Combine([Environment]::GetFolderPath('UserProfile'), '.agentdock-bridge')),
  [string]$Wrangler=([IO.Path]::Combine([IO.Path]::GetDirectoryName($PSScriptRoot), 'node_modules\.bin\wrangler.cmd')),
  [string]$WranglerConfig=([IO.Path]::Combine([IO.Path]::GetDirectoryName($PSScriptRoot), 'wrangler.jsonc'))
)
$ErrorActionPreference='Stop'
. ([IO.Path]::Combine($PSScriptRoot, 'State-Safety.ps1'))
$null=Assert-PrivateState $StateDir
Assert-ConnectorStopped $StateDir
Add-Type -AssemblyName System.Security
$entropy=[Text.Encoding]::UTF8.GetBytes('cbnv.agentdock-bridge.secrets.v1')
$pending=Join-Path $StateDir 'secrets.next.dpapi'
$current=Join-Path $StateDir 'secrets.dpapi'
if(-not(Test-Path -LiteralPath $current)){throw 'Current protected credentials are missing.'}
function RandomUrl([int]$count){
  $bytes=New-Object byte[] $count
  $rng=[Security.Cryptography.RandomNumberGenerator]::Create()
  try{$rng.GetBytes($bytes)}finally{$rng.Dispose()}
  return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
}
if(-not(Test-Path -LiteralPath $pending)){
  $password=RandomUrl 24
  $saltString=RandomUrl 16
  $padded=$saltString.Replace('-','+').Replace('_','/')+'=='
  $salt=[Convert]::FromBase64String($padded)
  $derive=[Security.Cryptography.Rfc2898DeriveBytes]::new($password,$salt,100000,[Security.Cryptography.HashAlgorithmName]::SHA256)
  try{$hash='pbkdf2-sha256$100000$'+$saltString+'$'+[Convert]::ToBase64String($derive.GetBytes(32)).TrimEnd('=').Replace('+','-').Replace('/','_')}finally{$derive.Dispose()}
  $data=@{bridgeToken=(RandomUrl 32);ownerPassword=$password;ownerPasswordHash=$hash}
  $plain=[Text.Encoding]::UTF8.GetBytes(($data|ConvertTo-Json -Compress))
  try{
    $cipher=[Security.Cryptography.ProtectedData]::Protect($plain,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
    [IO.File]::WriteAllText($pending,[Convert]::ToBase64String($cipher),[Text.UTF8Encoding]::new($false))
  }finally{[Array]::Clear($plain,0,$plain.Length);$data=$null;$password=$null}
}
$plain=[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String([IO.File]::ReadAllText($pending)),$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
try{
  $data=[Text.Encoding]::UTF8.GetString($plain)|ConvertFrom-Json
  $upload=@{BRIDGE_TOKEN=$data.bridgeToken;OWNER_PASSWORD_HASH=$data.ownerPasswordHash}|ConvertTo-Json -Compress
  $upload | & $Wrangler secret bulk --config $WranglerConfig
  if($LASTEXITCODE -ne 0){throw 'Cloud secret update did not complete. Connector must remain stopped; retry this script using the protected pending credentials.'}
  Copy-Item -LiteralPath $current -Destination (Join-Path $StateDir ('secrets-retired-'+[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')+'.dpapi'))
  Move-Item -LiteralPath $pending -Destination $current -Force
}finally{[Array]::Clear($plain,0,$plain.Length);$data=$null;$upload=$null}
'Project connection credentials rotated. Reconnect MCP clients with the new locally displayed password.'
