$ErrorActionPreference = "Stop"

Write-Host "Starting AETHER Windows Agent..."

cd $PSScriptRoot

if (!(Test-Path "..\.venv\Scripts\Activate.ps1")) {
    Write-Host "Virtual environment not found at ..\.venv"
    exit 1
}

..\.venv\Scripts\Activate.ps1

python .\agent.py
