# Run in PowerShell (Admin may help if WSL commands fail)
Write-Host "=== Filter ERP - Docker + MySQL startup ===" -ForegroundColor Cyan

Write-Host "`n1. Checking Docker engine..." -ForegroundColor Yellow
docker version 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Docker engine not responding." -ForegroundColor Red
    Write-Host "`nTry these steps IN ORDER:" -ForegroundColor Yellow
    Write-Host "  a) Quit Docker Desktop (tray icon -> Quit)"
    Write-Host "  b) Run:  wsl --shutdown"
    Write-Host "  c) Open Docker Desktop again and wait for 'Engine running'"
    Write-Host "  d) Re-run this script"
    exit 1
}

Write-Host "Docker engine OK." -ForegroundColor Green

Write-Host "`n2. Starting MySQL container..." -ForegroundColor Yellow
Set-Location "$PSScriptRoot\.."
docker-compose up mysql -d
if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to start MySQL. Try: Docker Desktop -> Troubleshoot -> Restart Docker Desktop" -ForegroundColor Red
    exit 1
}

Write-Host "`n3. Waiting for MySQL health check..." -ForegroundColor Yellow
Start-Sleep -Seconds 15
docker ps --filter name=erp-mysql

Write-Host "`n4. Next: start backend" -ForegroundColor Cyan
Write-Host "   cd backend"
Write-Host "   npm run dev"
Write-Host "`nThen open http://localhost:5173" -ForegroundColor Green
