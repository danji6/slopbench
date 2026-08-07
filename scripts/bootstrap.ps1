#!/usr/bin/env pwsh

param(
  [Parameter(Mandatory = $true)][ValidateSet('dev', 'start')][string]$Mode,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$RunnerArgs
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# Windows PowerShell 5.1 still negotiates TLS 1.0 by default, which GitHub drops
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root

function Get-BunVersion([string]$Path) {
  try {
    $version = (& $Path --version 2>$null | Select-Object -First 1)
    return "$version".Trim()
  } catch {
    return ''
  }
}

function Test-VersionAtLeast([string]$Version, [string]$Minimum) {
  $left = [regex]::Match($Version, '^\d+(\.\d+)*')
  $right = [regex]::Match($Minimum, '^\d+(\.\d+)*')
  if (-not $left.Success -or -not $right.Success) { return $false }

  return [version]$left.Value -ge [version]$right.Value
}

# Downloads the pinned Bun into bin/.
function Install-Bun([string]$Version, [string]$Destination, [string]$Suffix = '') {
  $asset = "bun-windows-x64$Suffix"
  $archive = "$asset.zip"
  $base = "https://github.com/oven-sh/bun/releases/download/bun-v$Version"
  $tmp = Join-Path $root ".data\tmp\bun-$PID"

  Write-Host "Downloading Bun $Version ($asset)..."
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path $tmp -Force | Out-Null

  $archivePath = Join-Path $tmp $archive
  Invoke-WebRequest -Uri "$base/$archive" -OutFile $archivePath
  $sums = (Invoke-WebRequest -Uri "$base/SHASUMS256.txt").Content

  $line = $sums -split "`n" |
    Where-Object { (($_ -split '\s+')[1] -replace '^\*', '') -eq $archive } |
    Select-Object -First 1
  if (-not $line) { throw "Bun $Version publishes no checksum for $archive." }
  $expected = ($line -split '\s+')[0]

  $actual = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
  if ($actual -ne $expected.ToUpperInvariant()) { throw "Checksum mismatch for $archive." }

  Expand-Archive -LiteralPath $archivePath -DestinationPath $tmp -Force
  $extracted = Get-ChildItem -LiteralPath $tmp -Recurse -Filter 'bun.exe' | Select-Object -First 1
  if (-not $extracted) { throw 'The Bun download did not contain bun.exe.' }

  New-Item -ItemType Directory -Path (Split-Path -Parent $Destination) -Force | Out-Null
  Copy-Item -LiteralPath $extracted.FullName -Destination $Destination -Force
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue

  if (-not (Get-BunVersion $Destination) -and -not $Suffix) {
    Write-Host 'That build does not run on this CPU; retrying with the baseline build...'
    Install-Bun $Version $Destination '-baseline'
    return
  }

  Write-Host "Saved Bun to $Destination"
}

# Returns the Bun to run, installing the pinned one if nothing usable is around.
function Resolve-Bun {
  if ($env:BUN_BINARY) { return $env:BUN_BINARY }

  $pins = Get-Content -LiteralPath (Join-Path $root 'versions.json') -Raw | ConvertFrom-Json
  if (-not $pins.bun -or -not $pins.bunMinimum) {
    throw 'versions.json is missing the Bun pins.'
  }

  $bundled = Join-Path $root 'bin\bun.exe'
  $system = (Get-Command bun -CommandType Application -ErrorAction SilentlyContinue |
      Select-Object -First 1)

  if ($system -and (Test-VersionAtLeast (Get-BunVersion $system.Source) $pins.bunMinimum)) {
    return $system.Source
  }

  if (-not (Test-Path -LiteralPath $bundled) -or (Get-BunVersion $bundled) -ne $pins.bun) {
    if ($system) {
      Write-Host "Bun $(Get-BunVersion $system.Source) is older than the required $($pins.bunMinimum)."
    }
    Install-Bun $pins.bun $bundled
  }

  return $bundled
}

$bun = Resolve-Bun

& $bun scripts/runner.ts $Mode @RunnerArgs
exit $LASTEXITCODE
