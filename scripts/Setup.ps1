param(
  [string]$StateDir=([IO.Path]::Combine([Environment]::GetFolderPath('UserProfile'), '.agentdock-bridge')),
  [string[]]$Roots=@('D:\Projects'),
  [string]$Origin='https://bridge.example.test'
)
$ErrorActionPreference='Stop'
. ([IO.Path]::Combine($PSScriptRoot, 'State-Safety.ps1'))
$configFile=Join-Path $StateDir 'config.json'
if(Test-Path -LiteralPath $configFile){throw 'Existing local configuration found; inspect it before changing it.'}
$allowed=@()
foreach($candidate in $Roots){
  $resolved=(Resolve-Path -LiteralPath $candidate -ErrorAction Stop).Path
  if(-not(Test-Path -LiteralPath $resolved -PathType Container)){throw 'Each allowed root must be a directory.'}
  $allowed+=$resolved
}
& (Join-Path $PSScriptRoot 'Secrets.ps1') -Action Create -StateDir $StateDir
$config=@{origin=$Origin;roots=$allowed;defaultCwd=$allowed[0];allowExec=$false;requireLocalApproval=$true;sourceRoot=(Split-Path -Parent $PSScriptRoot);sandbox=@{enabled=$false}}
[IO.File]::WriteAllText($configFile,($config|ConvertTo-Json -Depth 4),[Text.UTF8Encoding]::new($false))
'Credentials initialized. Build the isolated image and run Install-Hardened.ps1 before starting.'
