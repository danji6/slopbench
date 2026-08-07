#!/usr/bin/env pwsh
$ErrorActionPreference = 'Stop'

& (Join-Path $PSScriptRoot 'scripts/bootstrap.ps1') start @args
exit $LASTEXITCODE