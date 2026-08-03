@echo off
rem Saintview backend restart/stop - invoked by server-control API via Task Scheduler.
rem Scheduler-owned process: survives even when the backend (caller) dies.
rem Usage: server_restart.bat [restart|stop] [port]  (target PID read from restart.pid)
set MODE=%1
if "%MODE%"=="" set MODE=restart

ping -n 3 127.0.0.1 >nul
if not exist "%~dp0restart.pid" goto skipkill
for /f %%p in ('type "%~dp0restart.pid"') do taskkill /f /pid %%p >nul 2>&1
del "%~dp0restart.pid" >nul 2>&1
:skipkill
if /i "%MODE%"=="stop" exit /b 0

ping -n 2 127.0.0.1 >nul
rem DB env - reuse the line from start_saintview.bat (single source).
rem Handles both forms:  set VAR=...  and  set "VAR=..."  (trailing quote stripped)
for /f "tokens=1,* delims==" %%a in ('findstr /c:"SAINTVIEW_DATABASE_URL=" "%~dp0..\start_saintview.bat"') do set "SVDB=%%b"
if defined SVDB set "SVDB=%SVDB:"=%"
if defined SVDB set "SAINTVIEW_DATABASE_URL=%SVDB%"
cd /d %~dp0
rem Port comes from %2 - the server-control API passes the port it is ACTUALLY listening on.
rem Hardcoding it breaks non-default deployments: the revived listener binds one port while
rem every access path (vite proxy / nginx proxy_pass) still points at the old one, so the
rem admin console says "reconnecting shortly" and the web never comes back.
set PORT=%2
if "%PORT%"=="" set PORT=8000
start "Saintview Backend" /min py -3.11 -m uvicorn app.main:app --port %PORT% --log-level warning
exit /b 0
