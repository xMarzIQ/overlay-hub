@echo off
rem PC mode: runs the overlay hub on this computer, as a free backup if the online server ever has a problem.
rem Double-click this file. It needs Node.js 18 or newer from https://nodejs.org
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js isn't installed. Get it from https://nodejs.org, then double-click this again. & pause & exit /b 1)
if not exist node_modules (echo Installing, this happens once... & call npm ci --omit=dev --no-audit --no-fund)
set /p CONTROL_KEY=Type a control key (password) for the hub, then press Enter: 
set PORT=8080
echo.
echo In OBS, use: http://localhost:8080/overlay  (or the streamer's own link from the hub)
echo On your phone (same Wi-Fi), open one of the "On your network" links below.
echo To load your setup: Settings, Backup, Restore from a file, or "Restore from it" if this computer has a copy.
echo.
start "" http://localhost:8080/control
node server.js
pause
