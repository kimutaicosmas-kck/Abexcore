# Run MySQL WITHOUT Docker (when Docker Desktop engine fails)
# Requires: MySQL 8 installed locally (winget install Oracle.MySQL)

Write-Host "=== Filter ERP - Local MySQL Setup ===" -ForegroundColor Cyan

$mysqlExe = @(
    "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe",
    "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $mysqlExe) {
    Write-Host "MySQL not found. Install with:" -ForegroundColor Yellow
    Write-Host '  winget install Oracle.MySQL'
    Write-Host "Or download: https://dev.mysql.com/downloads/installer/"
    Write-Host "`nDuring install, set root password and enable 'MySQL Server' + 'MySQL Workbench'."
    exit 1
}

Write-Host "Using: $mysqlExe" -ForegroundColor Green
$rootPass = Read-Host "Enter MySQL root password (set during install)"

$sql = @"
CREATE DATABASE IF NOT EXISTS filter_erp;
CREATE USER IF NOT EXISTS 'erp_user'@'localhost' IDENTIFIED BY 'erp_password';
GRANT ALL PRIVILEGES ON filter_erp.* TO 'erp_user'@'localhost';
FLUSH PRIVILEGES;
"@

$sql | & $mysqlExe -u root "-p$rootPass" 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "SQL failed. Check root password and that MySQL service is running:" -ForegroundColor Red
    Write-Host "  Get-Service MySQL*"
    exit 1
}

Write-Host "`nDatabase ready. Running Prisma..." -ForegroundColor Green
Set-Location "$PSScriptRoot\..\backend"
npx prisma db push
npm run db:seed

Write-Host "`nDone! Start the app:" -ForegroundColor Cyan
Write-Host "  cd backend && npm run dev"
Write-Host "  cd frontend && npm run dev"
Write-Host "  Open http://localhost:5173"
Write-Host "  Login: admin@filtererp.co.ke / Admin@123"
