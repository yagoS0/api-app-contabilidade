param([ValidateSet('start','stop','status','shell')][string]$Action = 'status')
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$tools = Join-Path (Split-Path $repo -Parent) '.tools'
$node = Join-Path $tools 'node-v20.20.2-win-x64/node.exe'
$pg = Join-Path $tools 'postgresql16/pgsql/bin/pg_ctl.exe'
$state = Join-Path $repo '.local'
$data = Join-Path $state 'postgres-data'
$env:Path = (Split-Path $node) + ';' + $env:Path
$services = @(
  @{ Name='api'; Exe=$node; Dir='apps/api'; Args=@('--openssl-legacy-provider', ('"' + (Join-Path $repo 'apps/api/src/server.js') + '"')) },
  @{ Name='web'; Exe=$node; Dir='apps/web'; Args=@(('"' + (Join-Path $repo 'node_modules/vite/bin/vite.js') + '"'),'--host','127.0.0.1','--port','5173','--strictPort') },
  @{ Name='portal'; Exe=$node; Dir='apps/portal-cliente-web'; Args=@(('"' + (Join-Path $repo 'node_modules/vite/bin/vite.js') + '"'),'--host','127.0.0.1','--port','5174','--strictPort') },
  @{ Name='pdf'; Exe=(Join-Path $repo 'apps/pdf-reader/.venv/Scripts/python.exe'); Dir='apps/pdf-reader'; Args=@('-m','uvicorn','app.main:app','--host','127.0.0.1','--port','8000') }
)
function OwnedProcess($service) {
  $file = Join-Path $state ($service.Name + '.pid')
  if (!(Test-Path -LiteralPath $file)) { return $null }
  $savedId = [int](Get-Content -LiteralPath $file)
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $savedId" -ErrorAction SilentlyContinue
  if ($process -and $process.ExecutablePath -ieq $service.Exe) {
    if ($service.Name -eq 'pdf' -or $process.CommandLine.Contains($repo)) { return $process }
  }
  return $null
}
if ($Action -eq 'shell') { Set-Location $repo; Write-Host 'Node/npm disponiveis nesta sessao. Use dot-source: . ./scripts/dev-windows.ps1 shell'; return }
if ($Action -eq 'start') {
  & $pg status -D $data *> $null
  if ($LASTEXITCODE -ne 0) {
    & $pg start -D $data -l (Join-Path $state 'postgres.log') -w
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL nao iniciou.' }
  }
  foreach ($service in $services) {
    if (OwnedProcess $service) { continue }
    $process = Start-Process -FilePath $service.Exe -ArgumentList $service.Args -WorkingDirectory (Join-Path $repo $service.Dir) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $state ($service.Name + '.log')) -RedirectStandardError (Join-Path $state ($service.Name + '.error.log'))
    $process.Id | Set-Content (Join-Path $state ($service.Name + '.pid'))
  }
  Write-Host 'Contador: http://127.0.0.1:5173 | Portal mock: http://127.0.0.1:5174'
  Write-Host 'API: http://127.0.0.1:3000/healthz | PDF: http://127.0.0.1:8000/health'
}
if ($Action -eq 'stop') {
  foreach ($service in $services) {
    $process = OwnedProcess $service
    if ($process) { Stop-Process -Id $process.ProcessId }
  }
  & $pg stop -D $data -m fast -w
}
if ($Action -eq 'status') {
  & $pg status -D $data
  foreach ($service in $services) {
    $process = OwnedProcess $service
    Write-Host ($service.Name + ': ' + $(if ($process) { 'PID ' + $process.ProcessId } else { 'parado' }))
  }
}
