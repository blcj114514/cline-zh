@echo off
setlocal enableextensions
chcp 65001 >nul

rem ============================================================
rem  Cline Chinese Localization - Launcher v1.1
rem
rem  Two rules for editing this file:
rem   1) Keep it ASCII-only. cmd.exe parses .bat bytes with the OEM code
rem      page, so non-ASCII text here can corrupt command parsing.
rem      Chinese notes live in README.md; the injector prints Chinese itself.
rem   2) Never put literal parentheses inside an "if (...)" block, and
rem      prefer goto-style flow. Parentheses in echo text break the parser.
rem
rem  1. pre-flight check: Cline not running / port free / Node 22+
rem  2. set WebView2 remote debugging args
rem  3. start Cline
rem  4. attach the Chinese translation layer via CDP
rem  Keep this window open while using Cline.
rem ============================================================

set "ZH_HOME=%~dp0"
set "CLINE_EXE=E:\Cline\cline-app.exe"
set "PORT=9222"
set "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=%PORT% --remote-allow-origins=*"
rem Pass the SAME port to the injector, otherwise changing PORT above breaks the injection.
set "CLINE_ZH_PORT=%PORT%"

if exist "%CLINE_EXE%" goto zh_check_running
echo [ERROR] Cline executable not found: %CLINE_EXE%
echo         Open this file in Notepad and edit the CLINE_EXE line.
pause
exit /b 1

rem ---- Check 1: Cline already running? Debug port only applies on a fresh start.
:zh_check_running
tasklist /FI "IMAGENAME eq cline-app.exe" 2>nul | findstr /I /C:"cline-app.exe" >nul
if errorlevel 1 goto zh_check_port

echo.
echo  [!] Cline is already running.
echo      The debug port only opens when Cline starts fresh, so injection
echo      will NOT work while it is open. The interface will stay English.
echo.
echo      Please fully exit Cline, including the tray icon.
echo      This window continues automatically once it is closed.
echo.
:zh_wait_closed
ping -n 3 127.0.0.1 >nul
tasklist /FI "IMAGENAME eq cline-app.exe" 2>nul | findstr /I /C:"cline-app.exe" >nul
if not errorlevel 1 goto zh_wait_closed

rem ---- Check 2: debug port already taken?
:zh_check_port
netstat -ano | findstr /C:":%PORT% " | findstr /C:"LISTENING" >nul
if errorlevel 1 goto zh_check_node

echo.
echo  [ERROR] Port %PORT% is already in use by another program.
echo          Close that program, or change PORT in this file, e.g. 9333.
echo.
pause
exit /b 1

rem ---- Check 3: Node.js, needs 22+ for built-in WebSocket
:zh_check_node
set "NODE="
where node >nul 2>nul && set "NODE=node"
if not defined NODE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if defined NODE goto zh_check_node_ver

echo [ERROR] Node.js not found. Please install Node.js 22 or newer.
pause
exit /b 1

:zh_check_node_ver
"%NODE%" -e "process.exit(typeof WebSocket==='function'?0:1)" >nul 2>nul
if not errorlevel 1 goto zh_start

echo [ERROR] Node is too old: this tool needs Node 22 or newer, built-in WebSocket.
echo         Current version:
"%NODE%" -v
pause
exit /b 1

:zh_start
echo.
echo  ============================================
echo   Cline Chinese Localization
echo  ============================================
echo   Cline exe  : %CLINE_EXE%
echo   Node       : %NODE%
echo   Debug port : %PORT%
echo.
echo   Starting Cline...
start "" "%CLINE_EXE%"
ping -n 4 127.0.0.1 >nul

echo   Attaching translation layer. Keep this window open...
echo.
"%NODE%" "%ZH_HOME%injector.js"

echo.
echo   Injector stopped. Reload the page or restart Cline to return to English.
pause
endlocal
