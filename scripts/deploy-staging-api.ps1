param(
  [string]$RepoRoot = "",
  [string]$Branch = "implementation/consumer-onboarding-20261010",
  [string]$ServiceName = "DataStormKicksStagingApi",
  [string]$LocalOrigin = "http://127.0.0.1:3000",
  [string]$PublicOrigin = "https://staging-api.datastorminc.live"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Assert-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run this deployment from an elevated PowerShell window."
  }
}

function Assert-HttpStatus {
  param([string]$Url, [int]$Expected)
  $tmp = [System.IO.Path]::GetTempFileName()
  try {
    $status = & curl.exe -sS -o $tmp -w "%{http_code}" --connect-timeout 5 --max-time 15 $Url
    if ([int]$status -ne $Expected) {
      $body = Get-Content -Raw $tmp -ErrorAction SilentlyContinue
      throw "Expected HTTP $Expected from $Url, got $status. Body: $body"
    }
  } finally {
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  }
}

function Import-DotEnvFile {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return $false }
  Write-Host "Loading staging environment from $Path"
  foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }
    $idx = $trimmed.IndexOf("=")
    if ($idx -lt 1) { continue }
    $name = $trimmed.Substring(0, $idx).Trim()
    $value = $trimmed.Substring($idx + 1).Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    if ($name -match "^[A-Za-z_][A-Za-z0-9_]*$" -and -not (Get-Item "Env:$name" -ErrorAction SilentlyContinue)) {
      Set-Item -Path "Env:$name" -Value $value
    }
  }
  return $true
}

function Import-StagingEnvironment {
  param([string]$Root, [string]$PublicUrl)
  $names = @("DATABASE_URL","KICKS_DATABASE_URL","KICKS_ENVIRONMENT","KICKS_PUBLIC_API_URL","KICKS_STAGING_ADMIN_SECRET","KICKS_IOS_PROVISIONING_ENABLED","KICKS_ENGINE_MODE","KICKS_ENGINE_MANUAL_OVERRIDE","KICKS_COMPENSATION_EXECUTION_ENABLED","PORT","HOST")
  foreach ($name in $names) {
    if (-not (Get-Item "Env:$name" -ErrorAction SilentlyContinue)) {
      $value = [Environment]::GetEnvironmentVariable($name, "User")
      if (-not $value) { $value = [Environment]::GetEnvironmentVariable($name, "Machine") }
      if ($value) { Set-Item -Path "Env:$name" -Value $value }
    }
  }

  if (-not $env:DATABASE_URL -and -not $env:KICKS_DATABASE_URL) {
    $candidates = @(
      (Join-Path $Root ".env.staging.local"),
      (Join-Path $Root ".env.staging"),
      (Join-Path $Root "services\api\.env.staging.local"),
      (Join-Path $Root "services\api\.env.staging"),
      "C:\ProgramData\DataStorm\KICKS\.env",
      "C:\ProgramData\DataStorm\KICKS\staging.env",
      "C:\ProgramData\DataStorm\KICKS\api.env"
    )
    $programDataRoot = "C:\ProgramData\DataStorm\KICKS"
    if (Test-Path -LiteralPath $programDataRoot) {
      $discovered = Get-ChildItem -LiteralPath $programDataRoot -File -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.Name -match "(^\.env($|\.)|\.env$|env\.txt$|staging.*env|api.*env)" } | Select-Object -ExpandProperty FullName
      $candidates += $discovered
    }
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
      [void](Import-DotEnvFile -Path $candidate)
      if ($env:DATABASE_URL -or $env:KICKS_DATABASE_URL) { break }
    }
  }

  if (-not $env:DATABASE_URL -and -not $env:KICKS_DATABASE_URL) {
    throw "No DATABASE_URL or KICKS_DATABASE_URL was found in process/User/Machine environment, repo staging env files, or C:\ProgramData\DataStorm\KICKS. Refusing in-memory staging."
  }

  $env:KICKS_ENVIRONMENT = "staging"
  $env:NODE_ENV = "development"
  if (-not $env:KICKS_PUBLIC_API_URL) { $env:KICKS_PUBLIC_API_URL = $PublicUrl }
  if (-not $env:PORT) { $env:PORT = "3000" }
  if (-not $env:HOST) { $env:HOST = "0.0.0.0" }
}

function Resolve-StagingRuntime {
  param([string]$PreferredServiceName)
  $preferred = Get-CimInstance Win32_Service -Filter "Name='$PreferredServiceName'" -ErrorAction SilentlyContinue
  if ($preferred) { return [pscustomobject]@{ Kind="service"; Service=$preferred; Process=$null } }

  $listener = Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
    $ownerService = Get-CimInstance Win32_Service -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($ownerService) { return [pscustomobject]@{ Kind="service"; Service=$ownerService; Process=$process } }
    return [pscustomobject]@{ Kind="process"; Service=$null; Process=$process }
  }

  $candidates = @(Get-CimInstance Win32_Service | Where-Object { $_.Name -match "KICKS|DataStorm|Staging|API" -or $_.DisplayName -match "KICKS|DataStorm|Staging|API" })
  if ($candidates.Count -eq 1) { return [pscustomobject]@{ Kind="service"; Service=$candidates[0]; Process=$null } }
  return [pscustomobject]@{ Kind="none"; Service=$null; Process=$null }
}

Assert-Administrator

if (-not $RepoRoot) {
  try { $RepoRoot = (git rev-parse --show-toplevel).Trim() }
  catch { throw "Run this script from the KICK'S repository or pass -RepoRoot explicitly." }
}
$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
Set-Location -LiteralPath $RepoRoot

$runtime = Resolve-StagingRuntime -PreferredServiceName $ServiceName
if ($runtime.Kind -eq "service") {
  $ServiceName = $runtime.Service.Name
  Write-Host "Resolved staging Windows service: $ServiceName"
  Write-Host "Service command: $($runtime.Service.PathName)"
} elseif ($runtime.Kind -eq "process") {
  Write-Warning "Port 3000 is already owned by non-service PID $($runtime.Process.ProcessId)."
  Write-Host "Process: $($runtime.Process.Name)"
  Write-Host "Command line: $($runtime.Process.CommandLine)"
  throw "Refusing to replace an existing standalone staging process without preserving its launch environment."
} else {
  Write-Warning "No staging runtime is listening on port 3000. A clean staging process will be started after validation."
}

$previous = (git rev-parse HEAD).Trim()
Write-Host "Previous commit: $previous"

git fetch origin $Branch
git checkout $Branch
git reset --hard "origin/$Branch"
$candidate = (git rev-parse HEAD).Trim()
Write-Host "Candidate commit: $candidate"

npm ci
npm run typecheck --workspace @kicks/api
npm run build

$previousNodeEnv = $env:NODE_ENV
try {
  $env:NODE_ENV = "test"
  npm run test --workspace @kicks/api
} finally {
  if ($null -eq $previousNodeEnv) { Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue } else { $env:NODE_ENV = $previousNodeEnv }
}

$startedProcess = $null
$logRoot = Join-Path $RepoRoot ".staging"
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

try {
  if ($runtime.Kind -eq "service") {
    Restart-Service -Name $ServiceName -Force
    $svc = Get-Service -Name $ServiceName
    if ($svc.Status -ne "Running") { throw "$ServiceName is not running." }
  } else {
    Import-StagingEnvironment -Root $RepoRoot -PublicUrl $PublicOrigin
    $stdout = Join-Path $logRoot "api.stdout.log"
    $stderr = Join-Path $logRoot "api.stderr.log"
    Remove-Item $stdout,$stderr -Force -ErrorAction SilentlyContinue
    $startedProcess = Start-Process -FilePath "npm.cmd" -ArgumentList @("run","start","--workspace","@kicks/api") -WorkingDirectory $RepoRoot -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru -WindowStyle Hidden
    Set-Content -LiteralPath (Join-Path $logRoot "api.pid") -Value $startedProcess.Id
    Write-Host "Started staging API PID $($startedProcess.Id)."
    $deadline = (Get-Date).AddSeconds(25)
    $listener = $null
    while (-not $listener -and (Get-Date) -lt $deadline -and -not $startedProcess.HasExited) {
      Start-Sleep -Milliseconds 500
      $listener = Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue | Select-Object -First 1
    }
    if (-not $listener) {
      $err = if (Test-Path -LiteralPath $stderr) { Get-Content -Raw -LiteralPath $stderr } else { "" }
      throw "Staging API did not begin listening on port 3000. $err"
    }
  }

  Assert-HttpStatus "$LocalOrigin/health" 200
  Assert-HttpStatus "$LocalOrigin/core/identity/v1/account" 401
  Assert-HttpStatus "$LocalOrigin/core/consumer/v1/profile" 401
  Assert-HttpStatus "$PublicOrigin/health" 200
  Assert-HttpStatus "$PublicOrigin/core/identity/v1/account" 401
  Assert-HttpStatus "$PublicOrigin/core/consumer/v1/profile" 401

  $tmp = [System.IO.Path]::GetTempFileName()
  try {
    $status = & curl.exe -sS -o $tmp -w "%{http_code}" --connect-timeout 5 --max-time 15 -X POST "$PublicOrigin/core/identity/v1/account" -H "content-type: application/json" -H "idempotency-key: beelink-deploy-probe-20261011-0001" --data "{}"
    if ([int]$status -ne 422) {
      $body = Get-Content -Raw $tmp -ErrorAction SilentlyContinue
      throw "Expected HTTP 422 from registration validation probe, got $status. Body: $body"
    }
  } finally {
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  }

  Write-Host "Staging API deployment and public onboarding boundary verified at $candidate"
} catch {
  Write-Warning "Deployment verification failed. Rolling back source to $previous."
  if ($startedProcess -and -not $startedProcess.HasExited) { Stop-Process -Id $startedProcess.Id -Force -ErrorAction SilentlyContinue }
  git checkout --detach $previous
  npm ci
  if ($runtime.Kind -eq "service") { Restart-Service -Name $ServiceName -Force }
  throw
}
