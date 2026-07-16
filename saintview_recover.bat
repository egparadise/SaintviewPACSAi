@echo off
chcp 65001 >nul
title Saintview PACS - 서버 시작·복구
cd /d %~dp0

echo [Saintview] 서버 상태 확인 중...
curl -s -o nul -m 3 http://localhost:8000/api/health
if %errorlevel%==0 (
  echo [Saintview] 서버가 이미 실행 중입니다 - 접속 페이지를 엽니다.
  goto open
)

echo [Saintview] 서버가 꺼져 있습니다 - 전체 스택을 강제 시작합니다 (docker + 백엔드 + 프론트).
call start_saintview.bat

echo [Saintview] 백엔드 기동 대기 중 (최대 120초)...
set /a tries=0
:wait
timeout /t 3 /nobreak >nul
curl -s -o nul -m 3 http://localhost:8000/api/health
if %errorlevel%==0 goto open
set /a tries+=1
if %tries% lss 40 goto wait

echo.
echo [Saintview] 백엔드가 기동되지 않았습니다 - 열린 콘솔 창의 오류를 확인하세요.
pause
exit /b 1

:open
start "" https://localhost:5173
exit /b 0
