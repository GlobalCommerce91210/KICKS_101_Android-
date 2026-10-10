param(
  [Parameter(Mandatory=$true)][string]$RepoRoot,
  [string]$Branch = "implementation/consumer-onboarding-20261010",
  [string]$ServiceName = "DataStormKicksStagingApi",
  [string]$LocalOrigin = "http://127.0.0.1:3000",
  [string]$PublicOrigin = "https://staging-api.datastorminc.live"
)

$ErrorActionPreference = "Stop"

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
  Assert-HttpStatus "$PublicOrigin/health" 200

  Write-Host "Staging API deployment verified at $candidate"
} catch {
  Write-Warning "Deployment verification failed. Rolling back to $previous"
  git checkout --detach $previous
  npm ci
  Restart-Service -Name $ServiceName -Force
  throw
}
