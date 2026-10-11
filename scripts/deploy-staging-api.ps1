param(
  [string]$RepoRoot = "",
  [string]$Branch = "implementation/consumer-onboarding-20261010",
  [string]$ServiceName = "DataStormKicksStagingApi",
  [string]$LocalOrigin = "http://127.0.0.1:3000",
  [string]$PublicOrigin = "https://staging-api.datastorminc.live"
)

$ErrorActionPreference = "Stop"

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

Assert-Administrator
if (-not $RepoRoot) {
  try { $RepoRoot = (git rev-parse --show-toplevel).Trim() }
  catch { throw "Run this script from the KICK'S repository or pass -RepoRoot explicitly." }
}
$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path

function Resolve-StagingRuntime {
  param([string]$PreferredServiceName)

  $preferred = Get-CimInstance Win32_Service -Filter "Name='$PreferredServiceName'" -ErrorAction SilentlyContinue
  if ($preferred) {
    return [pscustomobject]@{ Kind='service'; Service=$preferred; Process=$null; Tasks=@() }
  }

  $listener = Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
    $ownerService = Get-CimInstance Win32_Service -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($ownerService) {
      return [pscustomobject]@{ Kind='service'; Service=$ownerService; Process=$process; Tasks=@() }
    }

    $tasks = @(Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object {
      $_.TaskName -match 'KICKS|DataStorm|Staging|API' -or $_.TaskPath -match 'KICKS|DataStorm'
    })
    return [pscustomobject]@{ Kind='process'; Service=$null; Process=$process; Tasks=$tasks }
  }

  $candidateServices = @(Get-CimInstance Win32_Service | Where-Object {
    $_.Name -match 'KICKS|DataStorm|Staging|API' -or $_.DisplayName -match 'KICKS|DataStorm|Staging|API'
  })
  if ($candidateServices.Count -eq 1) {
    return [pscustomobject]@{ Kind='service'; Service=$candidateServices[0]; Process=$null; Tasks=@() }
  }

  return [pscustomobject]@{ Kind='unknown'; Service=$null; Process=$null; Tasks=@(); CandidateServices=$candidateServices }
}

$runtime = Resolve-StagingRuntime -PreferredServiceName $ServiceName
if ($runtime.Kind -eq 'service') {
  $service = $runtime.Service
  $ServiceName = $service.Name
  Write-Host "Resolved staging Windows service: $ServiceName"
  Write-Host "Service command: $($service.PathName)"
  Write-Host "Service state before deploy: $($service.State)"
} elseif ($runtime.Kind -eq 'process') {
  Write-Warning "Port 3000 is owned by PID $($runtime.Process.ProcessId), but that PID is not registered as a Windows service."
  Write-Host "Process: $($runtime.Process.Name)"
  Write-Host "Command line: $($runtime.Process.CommandLine)"
  if ($runtime.Tasks.Count -gt 0) {
    Write-Host "Related scheduled tasks:"
    $runtime.Tasks | Select-Object TaskName,TaskPath,State | Format-Table -AutoSize
  }
  throw "Staging is running as a standalone process or scheduled task. Refusing to kill/recreate it without preserving its launch environment."
} else {
  if ($runtime.CandidateServices -and $runtime.CandidateServices.Count -gt 0) {
    Write-Host "Possible staging services:"
    $runtime.CandidateServices | Select-Object Name,DisplayName,State,PathName | Format-Table -AutoSize
  }
  Write-Warning "No staging runtime is currently listening on port 3000. A clean staging process will be started from this checkout after validation."
}
Write-Host "Repository root: $RepoRoot"

$nssmKey = $null
$previousNssmDirectory = $null
$serviceDirectoryChanged = $false
if ($runtime.Kind -eq 'service' -and $service.PathName -match 'nssm') {
  $nssmKey = "HKLM:\SYSTEM\CurrentControlSet\Services\$ServiceName\Parameters"
  if (Test-Path $nssmKey) {
    $nssm = Get-ItemProperty $nssmKey
    Write-Host "NSSM application: $($nssm.Application)"
    Write-Host "NSSM app directory: $($nssm.AppDirectory)"
    $previousNssmDirectory = $nssm.AppDirectory
    if ($nssm.AppDirectory) {
      $resolvedServiceRoot = (Resolve-Path -LiteralPath $nssm.AppDirectory).Path
      if ($resolvedServiceRoot -ne $RepoRoot) {
        Write-Warning "NSSM service points at stale checkout $resolvedServiceRoot. Repointing to $RepoRoot."
        Set-ItemProperty -LiteralPath $nssmKey -Name AppDirectory -Value $RepoRoot
        $serviceDirectoryChanged = $true
      }
    }
  }
}

Set-Location -LiteralPath $RepoRoot
$previous = (git rev-parse HEAD).Trim()
Write-Host "Previous commit: $previous"

git fetch origin $Branch
git checkout $Branch
git reset --hard "origin/$Branch"
$candidate = (git rev-parse HEAD).Trim()
Write-Host "Candidate commit: $candidate"

npm ci
npm run typecheck --workspace @kicks/api
npm run test --workspace @kicks/api

$startedProcess = $null
$logRoot = Join-Path $RepoRoot ".staging"
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

function Import-StagingEnvironment {
  $names = @(
    'DATABASE_URL','KICKS_DATABASE_URL','KICKS_ENVIRONMENT','KICKS_PUBLIC_API_URL',
    'KICKS_STAGING_ADMIN_SECRET','KICKS_IOS_PROVISIONING_ENABLED','KICKS_ENGINE_MODE',
    'KICKS_ENGINE_MANUAL_OVERRIDE','KICKS_COMPENSATION_EXECUTION_ENABLED','PORT','HOST'
  )
  foreach ($name in $names) {
    if (-not (Get-Item "Env:$name" -ErrorAction SilentlyContinue)) {
      $value = [Environment]::GetEnvironmentVariable($name, 'User')
      if (-not $value) { $value = [Environment]::GetEnvironmentVariable($name, 'Machine') }
      if ($value) { Set-Item -Path "Env:$name" -Value $value }
    }
  }
  if (-not $env:DATABASE_URL -and -not $env:KICKS_DATABASE_URL) {
    throw "No DATABASE_URL or KICKS_DATABASE_URL is available to the elevated staging process. Refusing to start with in-memory durability."
  }
  $env:KICKS_ENVIRONMENT = 'staging'
  $env:NODE_ENV = 'development'
  if (-not $env:KICKS_PUBLIC_API_URL) { $env:KICKS_PUBLIC_API_URL = $PublicOrigin }
  if (-not $env:PORT) { $env:PORT = '3000' }
  if (-not $env:HOST) { $env:HOST = '0.0.0.0' }
}

try {
  if ($runtime.Kind -eq 'service') {
    Restart-Service -Name $ServiceName -Force
    $svc = Get-Service -Name $ServiceName
    if ($svc.Status -ne "Running") { throw "$ServiceName is not running." }
  } elseif ($runtime.Kind -eq 'unknown') {
    Import-StagingEnvironment
    $stdout = Join-Path $logRoot "api.stdout.log"
    $stderr = Join-Path $logRoot "api.stderr.log"
    Remove-Item $stdout,$stderr -Force -ErrorAction SilentlyContinue
    $startedProcess = Start-Process -FilePath "npm.cmd" -ArgumentList @("run","start","--workspace","@kicks/api") -WorkingDirectory $RepoRoot -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru -WindowStyle Hidden
    Set-Content -LiteralPath (Join-Path $logRoot "api.pid") -Value $startedProcess.Id
    Write-Host "Started staging API process PID $($startedProcess.Id). Logs: $stdout ; $stderr"
    $deadline = (Get-Date).AddSeconds(20)
    do {
      Start-Sleep -Milliseconds 500
      $listener = Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue | Select-Object -First 1
    } until ($listener -or (Get-Date) -ge $deadline -or $startedProcess.HasExited)
    if (-not $listener) {
      $err = if (Test-Path $stderr) { Get-Content -Raw $stderr } else { "" }
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
    $status = & curl.exe -sS -o $tmp -w "%{http_code}" --connect-timeout 5 --max-time 15 `
      -X POST "$PublicOrigin/core/identity/v1/account" `
      -H "content-type: application/json" `
      -H "idempotency-key: beelink-deploy-probe-20261010-0001" `
      --data "{}"
    if ([int]$status -ne 422) {
      $body = Get-Content -Raw $tmp -ErrorAction SilentlyContinue
      throw "Expected HTTP 422 from public registration validation probe, got $status. Body: $body"
    }
  } finally {
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  }

  Write-Host "Staging API deployment and public onboarding boundary verified at $candidate"
} catch {
  Write-Warning "Deployment verification failed. Rolling back to $previous"
  if ($startedProcess -and -not $startedProcess.HasExited) {
    Stop-Process -Id $startedProcess.Id -Force -ErrorAction SilentlyContinue
  }
  git checkout --detach $previous
  npm ci
  if ($serviceDirectoryChanged -and $nssmKey -and $previousNssmDirectory) {
    Write-Warning "Restoring previous NSSM AppDirectory: $previousNssmDirectory"
    Set-ItemProperty -LiteralPath $nssmKey -Name AppDirectory -Value $previousNssmDirectory
  }
  if ($runtime.Kind -eq 'service') {
    Restart-Service -Name $ServiceName -Force
  }
  throw
}
