param(
  [ValidateSet('Start','Stop','Status','Run','Password')][string]$Action='Status',
  [string]$StateDir=([IO.Path]::Combine([Environment]::GetFolderPath('UserProfile'), '.agentdock-bridge'))
)
$ErrorActionPreference='Stop'
. ([IO.Path]::Combine($PSScriptRoot, 'State-Safety.ps1'))
$null=Assert-PrivateState $StateDir
$root=Split-Path -Parent $PSScriptRoot
$connector=Join-Path $root 'local\connector.mjs'
$self=$PSCommandPath
$processFile=Join-Path $StateDir 'supervisor.json'
$childFile=Join-Path $StateDir 'connector-process.json'
$stopFile=Join-Path $StateDir 'stop.request'
function SaveProcess($file,$process,$marker){
  # The protected record is written immediately after we create the process.
  [IO.File]::WriteAllText($file,(@{pid=$process.Id;startTime=$process.StartTime.ToUniversalTime().Ticks.ToString();executable=$process.Path;source=$marker}|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
}
function OwnedProcess($file,$marker){
  if(-not(Test-Path -LiteralPath $file)){return $null}
  try {
    $record=Get-Content -LiteralPath $file -Raw|ConvertFrom-Json
    $process=Get-Process -Id $record.pid -ErrorAction Stop
    # PID plus the exact creation time prevents a stale file from matching a
    # recycled PID. Check our recorded source and actual executable as well.
    # Avoid WMI queries here: they can stall for tens of seconds on this host.
    if($record.source -ieq $marker -and $process.Path -ieq $record.executable -and $process.StartTime.ToUniversalTime().Ticks.ToString() -ceq $record.startTime){return $process}
  } catch {}
  return $null
}
if($Action -eq 'Password') {& (Join-Path $PSScriptRoot 'Secrets.ps1') -Action ShowPassword -StateDir $StateDir;exit}
if($Action -eq 'Status') {
  $supervisor=OwnedProcess $processFile $self
  $child=OwnedProcess $childFile $connector
  [pscustomobject]@{supervisorAlive=[bool]$supervisor;connectorAlive=[bool]$child;stateDirectory=$StateDir}|ConvertTo-Json
  $status=Join-Path $StateDir 'connector-status.json'
  if(Test-Path -LiteralPath $status){Get-Content -LiteralPath $status -Raw}
  $configFile=Join-Path $StateDir 'config.json'
  if(Test-Path -LiteralPath $configFile){
    $origin=(Get-Content -LiteralPath $configFile -Raw|ConvertFrom-Json).origin
    try {Invoke-RestMethod ($origin.TrimEnd('/')+'/healthz') -TimeoutSec 15|ConvertTo-Json}catch{'Public health request failed.'}
  } else {'No configuration found; health probe skipped.'}
  exit
}
if($Action -eq 'Stop') {
  [IO.File]::WriteAllText($stopFile,'stop')
  $process=OwnedProcess $processFile $self
  if($process){$null=$process.WaitForExit(20000)}
  if(OwnedProcess $processFile $self){throw 'Supervisor is still running. Inspect its status.'}
  $child=OwnedProcess $childFile $connector
  if($child){throw 'Connector is still stopping. Inspect its status before forcing termination.'}
  'Stopped this connector and its supervisor.'
  exit
}
if($Action -eq 'Start') {
  $config=Get-Content -LiteralPath (Join-Path $StateDir 'config.json') -Raw | ConvertFrom-Json
  if(-not $config.sandbox.enabled -or -not $config.requireLocalApproval){throw 'Install the hardened runtime and local approval policy first.'}
  if($config.sourceRoot -ine $root){throw 'Start using the protected Start.cmd in the private AgentDockBridge directory.'}
  $null=Assert-PinnedNode $config $StateDir
  Clear-NodeOverrides
  if(OwnedProcess $processFile $self){'Already running.';exit}
  if(Test-Path -LiteralPath $stopFile){Remove-Item -LiteralPath $stopFile}
  $powershell=Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $arguments='-NoProfile -ExecutionPolicy RemoteSigned -File "'+$self+'" -Action Run -StateDir "'+$StateDir+'"'
  Start-Process -FilePath $powershell -ArgumentList $arguments -WorkingDirectory $root -WindowStyle Hidden | Out-Null
  'Start requested. Use Status.cmd to verify the public connection.'
  exit
}
$digest=[Security.Cryptography.SHA256]::Create()
try{$identifier=([BitConverter]::ToString($digest.ComputeHash([Text.Encoding]::UTF8.GetBytes($StateDir.ToLowerInvariant())))).Replace('-','')}finally{$digest.Dispose()}
$mutex=[Threading.Mutex]::new($false,'Local\CbnvComputerBridge-'+$identifier)
$owns=$false
try{$owns=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$owns=$true}
if(-not $owns){$mutex.Dispose();exit}
SaveProcess $processFile (Get-Process -Id $PID) $self
$config=Get-Content -LiteralPath (Join-Path $StateDir 'config.json') -Raw | ConvertFrom-Json
if(-not $config.sandbox.enabled -or -not $config.requireLocalApproval -or $config.sourceRoot -ine $root){throw 'Untrusted or incomplete runtime configuration.'}
$node=$config.nodePath
if(-not [IO.Path]::IsPathRooted($node) -or -not(Test-Path -LiteralPath $node -PathType Leaf)){throw 'Pinned Node executable is missing.'}
$null=Assert-PinnedNode $config $StateDir
Clear-NodeOverrides
try {
  while(-not(Test-Path -LiteralPath $stopFile)) {
    $child=OwnedProcess $childFile $connector
    if(-not $child) {
      $null=Assert-PinnedNode $config $StateDir
      $arguments='"'+$connector+'" "'+$StateDir+'"'
      $child=Start-Process -FilePath $node -ArgumentList $arguments -WorkingDirectory $root -WindowStyle Hidden -PassThru
      SaveProcess $childFile $child $connector
    }
    Start-Sleep -Seconds 2
  }
  $child=OwnedProcess $childFile $connector
  if($child){$null=$child.WaitForExit(12000)}
} finally {$mutex.ReleaseMutex();$mutex.Dispose()}
