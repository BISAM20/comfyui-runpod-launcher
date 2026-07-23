@echo off
REM ============================================================
REM  ComfyUI RunPod Launcher - run directly (development mode)
REM  Double-click this file to start the app.
REM ============================================================
title ComfyUI RunPod Launcher
cd /d "%~dp0"

REM --- Check Node.js is installed ---
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed.
  echo   Download it from https://nodejs.org  ^(LTS version^), install, then run this again.
  echo.
  pause
  exit /b 1
)

REM --- Install dependencies on first run ---
if not exist "node_modules\" (
  echo.
  echo   First run - installing dependencies, please wait...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo   npm install failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)

REM --- Launch the app ---
echo   Starting ComfyUI RunPod Launcher...
call npm start
