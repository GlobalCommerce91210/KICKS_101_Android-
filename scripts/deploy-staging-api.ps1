param(
  [Parameter(Mandatory=$true)][string]$RepoRoot,
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
$service = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'"
if (-not $service) { throw "Windows service $ServiceName was not found." }
Write-Host "Service command: $($service.PathName)"
Write-Host "Service state before deploy: $($service.State)"

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

try {
  Restart-Service -Name $ServiceName -Force
  $svc = Get-Service -Name $ServiceName
  if ($svc.Status -ne "Running") { throw "$ServiceName is not running." }

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
  git checkout --detach $previous
  npm ci
  Restart-Service -Name $ServiceName -Force
  throw
}
