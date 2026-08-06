#!/usr/bin/env pwsh
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
  Write-Error 'bun was not found on PATH. Install it from https://bun.sh and retry.'
  exit 1
}

& bun scripts/runner.ts start @args
exit $LASTEXITCODE
