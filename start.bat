@echo off
title CaptchaSolve Server
color 0A
cd /d D:\captcha-solver

echo.
echo  ==========================================
echo   CaptchaSolve Server
echo  ==========================================
echo.

:: Kill any process on port 3000 using PowerShell
echo  Freeing port 3000...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"
timeout /t 1 /nobreak >nul

echo  Starting server...
echo.
echo  Open in browser:
echo    http://localhost:3000/guide
echo    http://localhost:3000/admin
echo    http://localhost:3000/worker
echo.
echo  Press Ctrl+C to stop.
echo  ==========================================
echo.

node index.js

echo.
echo  Server stopped. Press any key to exit.
pause >nul
