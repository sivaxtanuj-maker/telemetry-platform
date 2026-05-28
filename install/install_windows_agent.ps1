param(
    [Parameter(Mandatory=$true)]
    [string]$EnrollmentToken,

    [string]$GatewayUrl = "http://localhost:8000",

    [string]$InstallDir = "$env:USERPROFILE\.aether-agent",

    [string]$AgentSourceUrl = "https://raw.githubusercontent.com/sivaxtanuj-maker/telemetry-platform/main/agent/agent.py",

    [switch]$UseLocalSource
)

$ErrorActionPreference = "Stop"

Write-Host "=========================================="
Write-Host "AETHER Windows Agent Installer"
Write-Host "=========================================="

if ($GatewayUrl -notlike "*/api/v1/telemetry") {
    $GatewayUrl = $GatewayUrl.TrimEnd("/") + "/api/v1/telemetry"
}

Write-Host "Gateway URL: $GatewayUrl"
Write-Host "Install Dir: $InstallDir"

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

$AgentPath = Join-Path $InstallDir "agent.py"
$VenvPath = Join-Path $InstallDir "venv"
$RunScriptPath = Join-Path $InstallDir "run_agent.ps1"

if ($UseLocalSource) {
    $LocalAgentPath = Resolve-Path "$PSScriptRoot\..\agent\agent.py"
    Write-Host "Copying local agent from $LocalAgentPath"
    Copy-Item $LocalAgentPath $AgentPath -Force
} else {
    Write-Host "Downloading agent from GitHub..."
    Invoke-WebRequest -Uri $AgentSourceUrl -OutFile $AgentPath
}

if (!(Test-Path $VenvPath)) {
    Write-Host "Creating Python virtual environment..."

    if (Get-Command py -ErrorAction SilentlyContinue) {
        py -3 -m venv $VenvPath
    } elseif (Get-Command python -ErrorAction SilentlyContinue) {
        python -m venv $VenvPath
    } else {
        throw "Python was not found. Install Python 3 and try again."
    }
}

$PythonExe = Join-Path $VenvPath "Scripts\python.exe"

Write-Host "Installing Python dependencies..."
& $PythonExe -m pip install --upgrade pip
& $PythonExe -m pip install httpx psutil

$RunLines = @(
    '$ErrorActionPreference = "Stop"',
    "cd `"$InstallDir`"",
    "& `"$PythonExe`" `"$AgentPath`""
)

$RunLines | Set-Content $RunScriptPath

Write-Host "Registering device using enrollment token..."

$env:AETHER_ENROLLMENT_TOKEN = $EnrollmentToken
$env:AETHER_GATEWAY_URL = $GatewayUrl

& $PythonExe $AgentPath
