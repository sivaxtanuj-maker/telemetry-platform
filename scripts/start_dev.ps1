$ErrorActionPreference = "Stop"

$Root = Resolve-Path "$PSScriptRoot\.."

Write-Host "Starting AETHER local development stack..."
Write-Host "Project root: $Root"

Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$Root'; docker compose up"

Start-Sleep -Seconds 25

Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$Root\gateway'; ..\.venv\Scripts\Activate.ps1; uvicorn main:app --host 0.0.0.0 --port 8000 --reload"

Start-Sleep -Seconds 3

Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$Root\processor'; ..\.venv\Scripts\Activate.ps1; python streamer.py"

Start-Sleep -Seconds 3

Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$Root\frontend'; npm run dev"

Write-Host "AETHER dev stack launched."
Write-Host "Open the Vite frontend URL shown in the frontend terminal."
Write-Host "Run the agent separately with:"
Write-Host "cd C:\Users\Tanuj\telemetry-platform\agent"
Write-Host ".\run_windows_agent.ps1"
