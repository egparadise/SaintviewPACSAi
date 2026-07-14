@echo off
rem Saintview PACS AI 원클릭 실행 ? docker(DB/Orthanc/OHIF) + 백엔드 + 프론트엔드(포털 3인스턴스)
cd /d %~dp0
echo [1/3] docker 서비스(DB/Orthanc/OHIF) 시작...
docker compose -f deploy\docker-compose.yml up -d

echo [2/3] 백엔드 API (:8000) 시작...
set SAINTVIEW_DATABASE_URL=postgresql+psycopg2://saintview:saintview_dev@localhost:5433/saintview
start "Saintview Backend" /min cmd /c "cd /d %~dp0backend && py -3.11 -m uvicorn app.main:app --port 8000 --log-level warning"

echo [3/3] 프론트엔드 포털 3인스턴스 (:5173 Landing / :5174 관리자 / :5175 Client) 시작...
rem strictPort ? 포트 선점 시 새 인스턴스는 종료되고 기존 인스턴스가 계속 서비스(포트 밀림 방지)
rem 자식 창 출력은 %TEMP%\sv_517x.log 에 남는다(창이 닫혀도 진단 가능)
start "Saintview Landing (5173)" /min cmd /c "cd /d %~dp0frontend && npm run dev -- --host 0.0.0.0 --port 5173 --strictPort > %TEMP%\sv_5173.log 2>&1"
start "Saintview Admin (5174)" /min cmd /c "cd /d %~dp0frontend && npm run dev -- --host 0.0.0.0 --port 5174 --strictPort > %TEMP%\sv_5174.log 2>&1"
start "Saintview Client (5175)" /min cmd /c "cd /d %~dp0frontend && set VITE_HTTPS=1 && npm run dev -- --host 0.0.0.0 --port 5175 --strictPort > %TEMP%\sv_5175.log 2>&1"

echo.
echo   Saintview PACS AI Landing : http://localhost:5173
echo   관리자 포털                : http://localhost:5174  (admin / admin1234)
echo   Client 뷰어 포털           : https://localhost:5175  (SAMPLE01 + 개별 ID)
echo.
rem Landing(:5173) 응답 대기 후 브라우저 오픈 ? 콜드 스타트에서 '연결할 수 없음' 방지(최대 60초)
echo   Landing 페이지 준비 대기 중...
set /a _try=0
:wait_landing
curl -s -o NUL -m 2 http://localhost:5173 >nul 2>&1 && goto open_landing
set /a _try+=1
if %_try% geq 60 goto open_landing
timeout /t 1 >nul
goto wait_landing
:open_landing
start http://localhost:5173