[CmdletBinding()]
param(
  [switch]$Rebuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$EnvPath = Join-Path $RepoRoot ".env"
$EnvExamplePath = Join-Path $RepoRoot ".env.example"

function Invoke-NativeCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,

    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
  }
}

function Test-RequiredTooling {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker is not available in PATH. Install Docker Desktop and try again."
  }

  Invoke-NativeCommand -FilePath "docker" -Arguments @("--version")
  Invoke-NativeCommand -FilePath "docker" -Arguments @("compose", "version")
}

function Assert-EnvFile {
  if (Test-Path -LiteralPath $EnvPath) {
    return
  }

  $message = if (Test-Path -LiteralPath $EnvExamplePath) {
    "Missing .env. Please fill it in manually from .env.example, then rerun scripts/start.ps1."
  } else {
    "Missing .env. Create it manually, then rerun scripts/start.ps1."
  }

  throw $message
}

function Get-EnvSettingValue {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Key
  )

  foreach ($rawLine in [System.IO.File]::ReadAllLines($EnvPath)) {
    $line = $rawLine.Trim()
    if (-not $line -or $line.StartsWith("#")) {
      continue
    }

    $parts = $line.Split("=", 2)
    if ($parts.Length -ne 2) {
      continue
    }

    if ($parts[0].Trim() -eq $Key) {
      return $parts[1].Trim()
    }
  }

  return $null
}

function Assert-ComposeEnvSettings {
  $databaseUrl = Get-EnvSettingValue -Key "DATABASE_URL"
  if ([string]::IsNullOrWhiteSpace($databaseUrl) -or $databaseUrl -notmatch "@postgres(?::|/)") {
    throw "Compose-style .env required: DATABASE_URL must use the postgres service hostname."
  }

  $redisUrl = Get-EnvSettingValue -Key "REDIS_URL"
  if ([string]::IsNullOrWhiteSpace($redisUrl) -or $redisUrl -notmatch "^redis://redis(?::|/|$)") {
    throw "Compose-style .env required: REDIS_URL must use the redis service hostname."
  }
}

function Invoke-Compose {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  $composeArguments = @("compose") + $Arguments
  Invoke-NativeCommand -FilePath "docker" -Arguments $composeArguments
}

$StartupArguments = @("up", "-d")
if ($Rebuild) {
  $StartupArguments += "--build"
}

Push-Location $RepoRoot

try {
  Write-Host "Checking Docker..."
  Test-RequiredTooling

  Write-Host "Checking .env..."
  Assert-EnvFile
  Assert-ComposeEnvSettings

  Write-Host "Starting LAN Studio..."
  Invoke-Compose -Arguments $StartupArguments

  Write-Host "Current compose status:"
  Invoke-Compose -Arguments @("ps")
} finally {
  Pop-Location
}
