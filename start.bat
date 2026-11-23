@echo off
cd /d "%~dp0"
rem 优先启动打包好的独立软件
if exist "dist\BiliPlayer-win32-x64\BiliPlayer.exe" (
  start "" "dist\BiliPlayer-win32-x64\BiliPlayer.exe"
  exit /b 0
)
rem 没打包过则退回两种运行方式
if exist "node_modules\electron\dist\electron.exe" (
  start "" "node_modules\electron\dist\electron.exe" .
  exit /b 0
)
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Please install it from https://nodejs.org/
  pause
  exit /b 1
)
node server.js
pause
