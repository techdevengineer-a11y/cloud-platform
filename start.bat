@echo off
REM Launcher for fourfaith-cloud — runs the Next.js web app + the TCP listener (port 10000).
REM Double-click this file from Explorer, or run `start.bat` from a terminal.

setlocal
cd /d "%~dp0"

title fourfaith-cloud

echo ============================================================
echo   fourfaith-cloud launcher
echo   Working directory: %CD%
echo ============================================================
echo.

where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] npm not found on PATH. Install Node.js from https://nodejs.org and try again.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo [setup] node_modules missing - running "npm install" first...
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed. See output above.
        pause
        exit /b 1
    )
    echo.
)

echo [run] Starting web (http://localhost:3000) + TCP listener (port 10000)...
echo       Press Ctrl+C in this window to stop both.
echo.
call npm run dev:all

echo.
echo [exit] Servers stopped.
pause
