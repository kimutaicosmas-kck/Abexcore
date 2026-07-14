# Start local MySQL for Filter ERP (no Docker required)
$Root = Split-Path $PSScriptRoot -Parent
$datadir = Join-Path $Root "mysql-data"
$bindir = "C:\Program Files\MySQL\MySQL Server 8.4\bin"

if (-not (Test-Path "$bindir\mysqld.exe")) {
    Write-Host "MySQL not installed. Run: winget install Oracle.MySQL" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path "$datadir\mysql")) {
    Write-Host "Initializing MySQL data directory..."
    New-Item -ItemType Directory -Path $datadir -Force | Out-Null
    & "$bindir\mysqld.exe" --initialize-insecure --datadir=$datadir
}

$running = Get-NetTCPConnection -LocalPort 3306 -ErrorAction SilentlyContinue
if (-not $running) {
    Write-Host "Starting MySQL on port 3306..."
    Start-Process -FilePath "$bindir\mysqld.exe" -ArgumentList "--datadir=$datadir","--port=3306" -WindowStyle Hidden
    Start-Sleep 5
}

& "$bindir\mysql.exe" -u root -e "CREATE DATABASE IF NOT EXISTS filter_erp; CREATE USER IF NOT EXISTS 'erp_user'@'localhost' IDENTIFIED BY 'erp_password'; GRANT ALL PRIVILEGES ON filter_erp.* TO 'erp_user'@'localhost'; FLUSH PRIVILEGES;" 2>$null
Write-Host "MySQL ready on localhost:3306" -ForegroundColor Green
