param([string]$StateDir=([IO.Path]::Combine([Environment]::GetFolderPath('UserProfile'), '.agentdock-bridge')))
$ErrorActionPreference='Stop'
. ([IO.Path]::Combine($PSScriptRoot, 'State-Safety.ps1'))
$null=Assert-PrivateState $StateDir
$config=Get-Content -LiteralPath (Join-Path $StateDir 'config.json') -Raw | ConvertFrom-Json
if(-not $config.nodePath -or -not [IO.Path]::IsPathRooted($config.nodePath)){throw 'The protected Node runtime is not configured.'}
$runtime=Split-Path -Parent $PSScriptRoot
if([IO.Path]::GetFullPath($runtime).TrimEnd('\') -ne [IO.Path]::GetFullPath($config.sourceRoot).TrimEnd('\')){throw 'Open Approve.cmd from the protected AgentDockBridge state directory.'}
$null=Assert-PinnedNode $config $StateDir
Clear-NodeOverrides
& $config.nodePath (Join-Path $runtime 'local\approval-cli.mjs') $StateDir
if($LASTEXITCODE -ne 0){throw 'Local approval did not complete.'}
