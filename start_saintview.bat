@echo off
rem Saintview PACS AI 원클릭 실행 — docker(DB/Orthanc/OHIF) + 백엔드 + 프론트(포털 3종, HTTPS 전용)
rem 이 파일은 UTF-8 + CRLF 로 저장한다(chcp 65001 전제 — CP949 로 재저장 금지).
chcp 65001 >nul
setlocal EnableExtensions
cd /d %~dp0
title Saintview PACS AI 실행

rem ── 0. HTTPS 인증서 확인(없으면 자동 생성) ──
rem    프론트는 HTTPS 전용 — vite.config.ts 가 http 폴백 없이 강제한다.
rem    (원격 PC 다중 모니터 감지 getScreenDetails 는 secure context=https 에서만 동작)
if exist "frontend\certs\dev.key" if exist "frontend\certs\dev.crt" goto certs_ok
echo [0/4] HTTPS 인증서가 없어 자동 생성합니다(frontend\certs\dev.key/crt)...
if not exist "frontend\certs" mkdir "frontend\certs"
set "OPENSSL=openssl"
where openssl >nul 2>&1
if errorlevel 1 set "OPENSSL=%ProgramFiles%\Git\usr\bin\openssl.exe"
"%OPENSSL%" req -x509 -newkey rsa:2048 -nodes -keyout frontend\certs\dev.key -out frontend\certs\dev.crt -days 3650 -subj "/CN=saintview-dev" -addext "subjectAltName=IP:127.0.0.1,DNS:localhost" >nul 2>&1
if exist "frontend\certs\dev.key" if exist "frontend\certs\dev.crt" goto certs_ok
echo    [!] 인증서 생성 실패 - openssl 설치 후 재실행하거나 vite.config.ts 상단 명령으로 수동 생성하세요.
echo        (HTTPS 전용 - 인증서 없이는 프론트가 기동하지 않습니다)
pause
exit /b 1
:certs_ok

echo [1/4] Docker(DB/Orthanc/OHIF) 확인...
docker info >nul 2>&1
if not errorlevel 1 goto docker_ready
echo    Docker Desktop이 꺼져 있어 자동 시작합니다(최대 120초 대기)...
if exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" (
  start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
) else (
  echo    [!] Docker Desktop 설치 경로를 찾지 못했습니다 - 수동 실행 후 다시 시도하세요.
)
set /a _dtry=0
:wait_docker
docker info >nul 2>&1
if not errorlevel 1 goto docker_ready
set /a _dtry+=1
if %_dtry% geq 60 (
  echo    [!] Docker 대기 초과 - DB/Orthanc 없이 계속합니다(로그인·검사 조회 불가할 수 있음^).
  goto docker_skip
)
ping -n 3 127.0.0.1 >nul
goto wait_docker
:docker_ready
docker compose -f deploy\docker-compose.yml up -d
:docker_skip

echo [2/4] 백엔드 API(:8000) 확인...
curl -s -o NUL -m 2 http://localhost:8000/api/health >nul 2>&1
if not errorlevel 1 (
  echo    이미 실행 중 - 건너뜁니다.
) else (
  set "SAINTVIEW_DATABASE_URL=postgresql+psycopg2://saintview:saintview_dev@localhost:5433/saintview"
  start "Saintview Backend" /min cmd /c "cd /d %~dp0backend && py -3.11 -m uvicorn app.main:app --port 8000 --log-level warning"
)

echo [3/4] 프론트엔드 3종(:5173 Landing / :5174 관리자 / :5175 Client, HTTPS 전용) 확인...
rem 자식 창 출력은 %TEMP%\sv_517x.log 에 남는다(창이 사라져도 원인 추적)
call :start_front 5173 "Saintview Landing"
call :start_front 5174 "Saintview Admin"
call :start_front 5175 "Saintview Client"

echo [4/4] Landing 페이지 응답 대기(최대 60초)...
set /a _try=0
:wait_landing
curl -sk -o NUL -m 2 https://localhost:5173 >nul 2>&1
if not errorlevel 1 goto open_landing
set /a _try+=1
if %_try% geq 60 goto landing_fail
ping -n 2 127.0.0.1 >nul
goto wait_landing

:landing_fail
echo    [!] Landing이 응답하지 않습니다 - 로그 확인: %TEMP%\sv_5173.log

:open_landing
echo.
echo   Saintview PACS AI Landing : https://localhost:5173
echo   관리자 포털               : https://localhost:5174  (admin / admin1234)
echo   Client 포털               : https://localhost:5175  (SAMPLE01 + 개별 ID)
echo   ※ 자체서명 인증서 - 최초 접속 시 브라우저 경고는 [고급]-[계속]으로 1회 통과
echo.
start "" https://localhost:5173
exit /b 0

rem ── 서브루틴: 포트별 vite 기동 — https 로 응답 중이면 유지, 비-https 점유는 종료 후 재기동 ──
:start_front
netstat -an | findstr /c:":%~1 " | findstr /c:"LISTENING" >nul 2>&1
if errorlevel 1 goto spawn_front
curl -sk -o NUL -m 2 https://localhost:%~1 >nul 2>&1
if errorlevel 1 goto kill_front
echo    :%~1 이미 실행 중(https) - 건너뜁니다.
goto :eof
:kill_front
echo    :%~1 포트를 비-https 프로세스가 점유 중 - 종료 후 https 로 재기동합니다.
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /c:":%~1 " ^| findstr /c:"LISTENING"') do taskkill /f /t /pid %%p >nul 2>&1
ping -n 2 127.0.0.1 >nul
:spawn_front
start "%~2 (%~1)" /min cmd /c "cd /d %~dp0frontend && npm run dev -- --host 0.0.0.0 --port %~1 --strictPort > %TEMP%\sv_%~1.log 2>&1"
goto :eof
