@echo off
rem Saintview PACS AI 원클릭 실행 — docker(DB/Orthanc/OHIF) + 백엔드 + 프론트(포털 3종)
rem 이 파일은 UTF-8 + CRLF 로 저장한다(chcp 65001 전제 — CP949 로 재저장 금지).
chcp 65001 >nul
setlocal EnableExtensions
cd /d %~dp0
title Saintview PACS AI 실행

rem ── 0. 서빙 스킴 결정: certs/dev.{key,crt} 있으면 HTTPS ──
rem    주의: "set VAR=1 && ..." 처럼 && 앞에 공백을 두면 값에 공백이 포함돼
rem    vite 의 VITE_HTTPS === '1' 비교가 깨진다(과거 장애 원인). 반드시 set "VAR=1" 형태 사용.
set "SCHEME=http"
if exist "frontend\certs\dev.key" if exist "frontend\certs\dev.crt" (
  set "SCHEME=https"
  set "VITE_HTTPS=1"
)

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

echo [3/4] 프론트엔드 3종(:5173 Landing / :5174 관리자 / :5175 Client, %SCHEME%) 확인...
rem 자식 창 출력은 %TEMP%\sv_517x.log 에 남는다(창이 사라져도 원인 추적)
call :start_front 5173 "Saintview Landing"
call :start_front 5174 "Saintview Admin"
call :start_front 5175 "Saintview Client"

echo [4/4] Landing 페이지 응답 대기(최대 60초)...
rem 실제 응답하는 스킴(https→http 순)을 감지해 그 주소로 브라우저를 연다.
rem 과거에는 https 고정이라, 서버가 http 로 떠 있으면 SSL 오류 페이지가 열려 "실행 안 됨"처럼 보였다.
set /a _try=0
set "OPEN_URL="
:wait_landing
curl -sk -o NUL -m 2 https://localhost:5173 >nul 2>&1
if not errorlevel 1 set "OPEN_URL=https://localhost:5173"
if not defined OPEN_URL (
  curl -s -o NUL -m 2 http://localhost:5173 >nul 2>&1
  if not errorlevel 1 set "OPEN_URL=http://localhost:5173"
)
if defined OPEN_URL goto open_landing
set /a _try+=1
if %_try% geq 60 goto landing_fail
ping -n 2 127.0.0.1 >nul
goto wait_landing

:landing_fail
echo    [!] Landing이 응답하지 않습니다 - 로그 확인: %TEMP%\sv_5173.log
set "OPEN_URL=%SCHEME%://localhost:5173"

:open_landing
echo.
echo   Saintview PACS AI Landing : %OPEN_URL%
echo   관리자 포털               : %SCHEME%://localhost:5174  (admin / admin1234)
echo   Client 포털               : %SCHEME%://localhost:5175  (SAMPLE01 + 개별 ID)
echo.
start "" %OPEN_URL%
exit /b 0

rem ── 서브루틴: 포트가 비어 있을 때만 vite 인스턴스 기동(중복 기동·로그 덮어쓰기 방지) ──
:start_front
netstat -an | findstr /c:":%~1 " | findstr /c:"LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo    :%~1 이미 실행 중 - 건너뜁니다.
  goto :eof
)
start "%~2 (%~1)" /min cmd /c "cd /d %~dp0frontend && npm run dev -- --host 0.0.0.0 --port %~1 --strictPort > %TEMP%\sv_%~1.log 2>&1"
goto :eof
