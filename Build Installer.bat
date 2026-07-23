@echo off
REM ============================================================
REM  Build the shareable Windows installer (.exe)
REM  Produces:  release\ComfyUI RunPod Launcher Setup <ver>.exe
REM  Send that ONE file to your friend - they double-click to install.
REM ============================================================
title Build ComfyUI RunPod Launcher Installer
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get it from https://nodejs.org then retry.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 ( echo npm install failed. & pause & exit /b 1 )
)

REM Skip code-signing auto-discovery (we ship unsigned)
set CSC_IDENTITY_AUTO_DISCOVERY=false

echo.
echo   Building installer - this can take a few minutes the first time
echo   ^(it downloads packaging tools^)...
echo.
call npm run dist
if errorlevel 1 (
  echo.
  echo   Build failed - see the messages above.
  pause
  exit /b 1
)

echo.
echo   Done. Opening the release folder...
start "" "%~dp0release"
pause
