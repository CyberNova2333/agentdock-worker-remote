param(
  [string]$StateDir=([IO.Path]::Combine([Environment]::GetFolderPath('UserProfile'), '.agentdock-bridge')),
  [string]$Workspace='D:\Projects',
  [string]$Image='agentdock-dev:2026-10-28',
  [string]$Proxy
)
$ErrorActionPreference='Stop'
. ([IO.Path]::Combine($PSScriptRoot, 'State-Safety.ps1'))
$source=Split-Path -Parent $PSScriptRoot
$workspacePath=(Resolve-Path -LiteralPath $Workspace).Path.TrimEnd('\')
$statePath=Assert-PrivateState $StateDir
if($statePath -ieq $workspacePath -or $statePath.StartsWith($workspacePath+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Private runtime must not be inside the mounted workspace.'}
Assert-ConnectorStopped $StateDir
if(-not(Test-Path -LiteralPath (Join-Path $StateDir 'secrets.dpapi'))){throw 'Set up protected credentials before installing the runtime.'}
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$unexpected=@((Get-Acl -LiteralPath $StateDir).Access | Where-Object {$_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin @($sid,'S-1-5-18')})
if($unexpected.Count){throw 'Private state ACL contains other principals; installation stopped.'}
$docker=(Get-Command docker.exe -ErrorAction Stop).Source
$null=Assert-TrustedBinary $docker $workspacePath
$nodeRuntime=& (Join-Path $PSScriptRoot 'Install-NodeRuntime.ps1') -StateDir $StateDir -Workspace $workspacePath -Proxy $Proxy
$node=$nodeRuntime.nodePath
$npm=$nodeRuntime.npmCli
$pnpm=Join-Path $source 'node_modules\pnpm\bin\pnpm.mjs'
if(-not(Test-Path -LiteralPath $pnpm)){throw 'Run pnpm install in the reviewed checkout before installing the runtime.'}
Clear-NodeOverrides
$imageId=(& $docker --context desktop-linux image inspect $Image --format '{{.Id}}').Trim()
if($LASTEXITCODE -ne 0 -or $imageId -notmatch '^sha256:[a-f0-9]{64}$'){throw 'Build and verify the development image first.'}
$release='runtime-'+[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')+'-'+[Guid]::NewGuid().ToString('N').Substring(0,8)
$destination=Join-Path $StateDir $release
New-Item -ItemType Directory -Path $destination | Out-Null
foreach($folder in @('local','scripts')){Copy-Item -LiteralPath (Join-Path $source $folder) -Destination $destination -Recurse}
foreach($file in @('package.json','pnpm-lock.yaml')){Copy-Item -LiteralPath (Join-Path $source $file) -Destination $destination}
Push-Location $destination
try {
  & $node $pnpm install --frozen-lockfile --prod --ignore-scripts
  if($LASTEXITCODE -ne 0){throw 'Protected runtime dependency installation failed.'}
} finally {Pop-Location}
$configFile=Join-Path $StateDir 'config.json'
$old=Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json
Assert-ConnectorStopped $StateDir
Copy-Item -LiteralPath $configFile -Destination (Join-Path $StateDir ('config-before-'+$release+'.json'))
$config=@{
  origin=$old.origin;roots=@($workspacePath);defaultCwd=$workspacePath;allowExec=$true
  sourceRoot=$destination;nodePath=$node;nodeRoot=$nodeRuntime.nodeRoot;nodeSha256=$nodeRuntime.nodeSha256;requireLocalApproval=$true
  sandbox=@{enabled=$true;image=$imageId;dockerPath=$docker;context='desktop-linux';allowOutbound=$true}
}
$temporary=Join-Path $StateDir ('config-'+[Guid]::NewGuid().ToString('N')+'.tmp')
[IO.File]::WriteAllText($temporary,($config|ConvertTo-Json -Depth 6),[Text.UTF8Encoding]::new($false))
Move-Item -LiteralPath $temporary -Destination $configFile -Force
$powershell=Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
foreach($action in @('Start','Stop','Status','Password')) {
  $content='@echo off'+"`r`n"+'setlocal DisableDelayedExpansion'+"`r`n"+'chcp 65001 >nul'+"`r`n"+'"'+$powershell+'" -NoProfile -ExecutionPolicy RemoteSigned -File "'+(Join-Path $destination 'scripts\Manage.ps1').Replace('%','%%')+'" -Action '+$action+' -StateDir "'+$StateDir.Replace('%','%%')+'"'+"`r`n"
  [IO.File]::WriteAllText((Join-Path $StateDir ($action+'.cmd')),$content,[Text.UTF8Encoding]::new($false))
}
if(Test-Path -LiteralPath (Join-Path $destination 'scripts\Approve.ps1')) {
  $approve='@echo off'+"`r`n"+'setlocal DisableDelayedExpansion'+"`r`n"+'chcp 65001 >nul'+"`r`n"+'"'+$powershell+'" -NoProfile -ExecutionPolicy RemoteSigned -File "'+(Join-Path $destination 'scripts\Approve.ps1').Replace('%','%%')+'" -StateDir "'+$StateDir.Replace('%','%%')+'"'+"`r`n"
  [IO.File]::WriteAllText((Join-Path $StateDir 'Approve.cmd'),$approve,[Text.UTF8Encoding]::new($false))
}
$manifest=@{installedAt=[DateTime]::UtcNow.ToString('o');runtime=$destination;workspace=$workspacePath;image=$imageId;sha256=@{}}
Get-ChildItem -LiteralPath $destination -File -Recurse | Where-Object {$_.FullName -notlike '*\node_modules\*'} | ForEach-Object {$manifest.sha256[$_.FullName.Substring($destination.Length+1)]=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}
[IO.File]::WriteAllText((Join-Path $StateDir 'installation.json'),($manifest|ConvertTo-Json -Depth 6),[Text.UTF8Encoding]::new($false))
[pscustomobject]@{runtime=$destination;workspace=$workspacePath;image=$imageId;started=$false}|ConvertTo-Json
