# Free a TCP port, then start the full SousChef FastAPI app from backend/.
#
# Default port is 8001 so dev does not fight a stuck/orphan listener on 8000 (Windows).
# Override:  -Port 8000
# Or set in backend/.env:  SOUSCHEF_UVICORN_PORT=8000
#
# Usage (from repo root):
#   powershell -ExecutionPolicy Bypass -File .\backend\scripts\start-uvicorn.ps1

param(
    [int] $Port = 0
)

$ErrorActionPreference = "Stop"
$backendDir = Split-Path -Parent $PSScriptRoot
Set-Location $backendDir

$resolvedPort = 8001
if ($Port -gt 0) {
    $resolvedPort = $Port
} else {
    $envFile = Join-Path $backendDir ".env"
    if (Test-Path $envFile) {
        $line = Get-Content $envFile -ErrorAction SilentlyContinue |
            Where-Object { $_ -match '^\s*SOUSCHEF_UVICORN_PORT\s*=\s*\d+\s*$' } |
            Select-Object -Last 1
        if ($line -match '=\s*(\d+)') {
            $resolvedPort = [int]$Matches[1]
        }
    }
}

& "$PSScriptRoot\free-port-8000.ps1" -Port $resolvedPort

Write-Host "[start-uvicorn] Starting from $backendDir on port $resolvedPort (set web NEXT_PUBLIC_API_BASE to match)"
python -m uvicorn main:app --reload --host 127.0.0.1 --port $resolvedPort
