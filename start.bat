@echo off
setlocal
chcp 65001 >nul
title UOOC Study
cd /d "%~dp0"
if not exist "%~dp0app.js" goto use_exe
where node >nul 2>nul
if errorlevel 1 goto use_exe
node -e "process.exit(Number(process.versions.node.split('.')[0]) === 24 ? 0 : 1)"
if errorlevel 1 goto use_exe
if not exist "node_modules\playwright\package.json" goto install
if not exist "node_modules\@inquirer\prompts\package.json" goto install
goto run

:install
echo Installing dependencies...
call npm ci --omit=dev --no-audit --no-fund
if errorlevel 1 goto failed

:run
node "%~dp0app.js" %*
set "result=%errorlevel%"
goto finish

:use_exe
if not exist "%~dp0UOOC-Study.exe" goto need_node
"%~dp0UOOC-Study.exe" %*
exit /b %errorlevel%

:need_node
echo Install Node.js 24 from https://nodejs.org/ or use UOOC-Study.exe.
set "result=1"
goto finish

:failed
echo Dependency installation failed. Check your network and try again.
set "result=1"

:finish
if "%~1"=="" exit /b %result%
if /i "%~1"=="--gui" exit /b %result%
if /i "%~1"=="--check" exit /b %result%
if /i "%~1"=="--help" exit /b %result%
pause
exit /b %result%
