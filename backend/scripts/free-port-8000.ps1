# Stops every process listening on TCP port 8000 (Windows).
# Run from PowerShell:  powershell -ExecutionPolicy Bypass -File .\scripts\free-port-8000.ps1
# From backend folder, or:  .\backend\scripts\free-port-8000.ps1

param(
    [int] $Port = 8000
)

$ErrorActionPreference = "Continue"
$killed = @()

Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
    $procId = $_.OwningProcess
    if ($killed -notcontains $procId) {
        Write-Host "[free-port] Stopping PID $procId (listening on $Port)"
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        $killed += $procId
    }
}

if ($killed.Count -eq 0) {
    Write-Host "[free-port] No LISTENING process found on port $Port."
} else {
    Start-Sleep -Seconds 1
    Write-Host "[free-port] Done. Start uvicorn: python -m uvicorn main:app --reload --host 127.0.0.1 --port $Port"
}
