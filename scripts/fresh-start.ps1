# Filter ERP - Full fresh start (Docker MySQL + backend + frontend)
$ErrorActionPreference = "Continue"
$Root = Split-Path $PSScriptRoot -Parent

Write-Host "`n=== Filter ERP Fresh Start ===" -ForegroundColor Cyan

# 1. Stop processes on dev ports
Write-Host "`n[1/6] Stopping old dev servers..." -ForegroundColor Yellow
foreach ($port in @(3001, 5173, 5174)) {
    Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
        ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
}

# 2. Reset Docker MySQL
Write-Host "[2/6] Resetting Docker MySQL..." -ForegroundColor Yellow
Set-Location $Root

docker version 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Docker engine not ready. Starting Docker Desktop..." -ForegroundColor Yellow
    Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe" -ErrorAction SilentlyContinue
    $ready = $false
    1..12 | ForEach-Object {
        Start-Sleep 5
        docker version 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { $ready = $true; return }
    }
    if (-not $ready) {
        Write-Host "ERROR: Docker engine failed to start within 60s." -ForegroundColor Red
        Write-Host ""
        Write-Host "Docker Desktop is not working on this machine. Use LOCAL MySQL instead:" -ForegroundColor Yellow
        Write-Host '  winget install Oracle.MySQL'
        Write-Host '  powershell -ExecutionPolicy Bypass -File scripts\setup-mysql-without-docker.ps1'
        Write-Host ""
        Write-Host "OR fix Docker: Desktop -> Troubleshoot -> Reset to factory defaults" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Starting backend + frontend anyway (login will fail until DB is up)..." -ForegroundColor Yellow
        Set-Location $Root
        Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$Root\backend'; npm run dev" -WindowStyle Minimized
        Start-Sleep 2
        Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$Root\frontend'; npm run dev" -WindowStyle Minimized
        Write-Host "Frontend: http://localhost:5173"
        exit 1
    }
}

docker-compose down -v 2>$null
docker-compose up mysql -d
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Could not start MySQL container." -ForegroundColor Red
    exit 1
}

# 3. Wait for MySQL healthy
Write-Host "[3/6] Waiting for MySQL to be healthy..." -ForegroundColor Yellow
$healthy = $false
1..30 | ForEach-Object {
    $status = docker inspect --format='{{.State.Health.Status}}' erp-mysql 2>$null
    if ($status -eq "healthy") { $healthy = $true; return }
    Start-Sleep 2
}
if (-not $healthy) {
    Write-Host "WARNING: MySQL health check timed out. Continuing anyway..." -ForegroundColor Yellow
} else {
    Write-Host "MySQL is healthy." -ForegroundColor Green
}

# 4. Database schema + seed
Write-Host "[4/6] Setting up database schema and seed data..." -ForegroundColor Yellow
Set-Location "$Root\backend"
npx prisma generate
npx prisma db push --accept-data-loss
npm run db:seed
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Database setup failed." -ForegroundColor Red
    exit 1
}

# 5. Start backend
Write-Host "[5/6] Starting backend on :3001..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$Root\backend'; npm run dev" -WindowStyle Minimized

Start-Sleep 3

# 6. Start frontend
Write-Host "[6/6] Starting frontend on :5173..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$Root\frontend'; npm run dev" -WindowStyle Minimized

Start-Sleep 4

# Verify
Write-Host "`n=== System Status ===" -ForegroundColor Cyan
try {
    $health = Invoke-RestMethod -Uri "http://localhost:3001/api/health" -TimeoutSec 5
    Write-Host "Backend:  $($health.status) (DB: $($health.database))" -ForegroundColor Green
} catch {
    Write-Host "Backend:  starting... (give it a few seconds)" -ForegroundColor Yellow
}

try {
    $fe = Invoke-WebRequest -Uri "http://localhost:5173" -UseBasicParsing -TimeoutSec 5
    Write-Host "Frontend: http://localhost:5173 (status $($fe.StatusCode))" -ForegroundColor Green
} catch {
    Write-Host "Frontend: starting... try http://localhost:5173 or :5174" -ForegroundColor Yellow
}

docker ps --filter name=erp-mysql --format "MySQL:   {{.Names}} - {{.Status}}"

Write-Host "`nLogin: admin@filtererp.co.ke / Admin@123" -ForegroundColor Cyan
Write-Host "Open:  http://localhost:5173`n" -ForegroundColor Cyan
