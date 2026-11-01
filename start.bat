@echo off
setlocal
cd /d "%~dp0"

echo ================================================
echo   Thin Muscle - Start Local Server
echo ================================================

where docker >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Docker not found. Please install Docker Desktop.
    pause
    exit /b 1
)

echo [1/3] Starting containers...
docker compose up -d
if errorlevel 1 (
    echo [ERROR] Failed to start. Is Docker Desktop running?
    echo         If code changed, try: docker compose up -d --build
    pause
    exit /b 1
)

echo [2/3] Waiting for app to be ready...
timeout /t 5 /nobreak >nul

echo [3/3] Opening browser...
set "LAN_IP="
for /f "usebackq delims=" %%I in (`powershell -NoProfile -Command "$ips=@(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue); foreach($prefix in @('192.168.','10.','')) { foreach($item in $ips) { $alias=[string]$item.InterfaceAlias; if($item.IPAddress -and -not $item.IPAddress.StartsWith('127.') -and -not $item.IPAddress.StartsWith('169.254.') -and $alias.IndexOf('Docker',[StringComparison]::OrdinalIgnoreCase) -lt 0 -and $alias.IndexOf('vEthernet',[StringComparison]::OrdinalIgnoreCase) -lt 0 -and $alias.IndexOf('WSL',[StringComparison]::OrdinalIgnoreCase) -lt 0 -and $alias.IndexOf('Meta',[StringComparison]::OrdinalIgnoreCase) -lt 0 -and ($prefix -eq '' -or $item.IPAddress.StartsWith($prefix))) { $item.IPAddress; exit } } }"`) do if not defined LAN_IP set "LAN_IP=%%I"

if defined LAN_IP (
    start "" "http://%LAN_IP%:3001"
) else (
    start "" "http://localhost:3001"
)

echo.
if defined LAN_IP echo Done! Browser URL: http://%LAN_IP%:3001
if not defined LAN_IP echo Done! Browser URL: http://localhost:3001
if defined LAN_IP echo Phone on same LAN: http://%LAN_IP%:3001
if not defined LAN_IP echo LAN address not detected. Check your PC IPv4 address manually.
echo If the phone cannot connect, allow inbound TCP port 3001 in Windows Firewall and ensure both devices use the same LAN.
echo Login: yhone / yh159951
echo.
pause
