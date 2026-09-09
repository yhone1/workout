@echo off
setlocal
cd /d "%~dp0"

echo Stopping thin-muscle-workout...
docker compose down
echo Done. Data is kept. Use "docker compose down -v" to also clear data.
pause
