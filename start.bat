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
start "" http://localhost:3001

echo.
echo Done! Open http://localhost:3001 if browser did not open.
echo Login: yhone / yh159951
echo.
pause
