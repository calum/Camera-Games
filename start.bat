@echo off
cd /d "%~dp0"
echo Starting Kids Camera Game... (close this window to stop)
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:8137"
node server.mjs
