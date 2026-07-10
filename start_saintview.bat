@echo off
rem Saintview PACS AI 원클릭 실행 — docker(DB/Orthanc/OHIF) + 백엔드 + 프론트엔드(포털 3인스턴스)
cd /d %~dp0
echo [1/3] docker 서비스(DB/Orthanc/OHIF) 시작...
docker compose -f deploy\docker-compose.yml up -d

echo [2/3] 백엔드 API (:8000) 시작...
set SAINTVIEW_DATABASE_URL=postgresql+psycopg2://saintview:saintview_dev@localhost:5433/saintview
start "Saintview Backend" /min cmd /c "cd backend && py -3.11 -m uvicorn app.main:app --port 8000 --log-level warning"

echo [3/3] 프론트엔드 포털 3인스턴스 (:5173 Landing / :5174 관리자 / :5175 Client) 시작...
start "Saintview Landing (5173)" /min cmd /c "cd frontend && npm run dev"
start "Saintview Admin (5174)" /min cmd /c "cd frontend && npm run dev -- --port 5174 --strictPort"
start "Saintview Client (5175)" /min cmd /c "cd frontend && npm run dev -- --port 5175 --strictPort"

echo.
echo   Saintview PACS AI Landing : http://localhost:5173
echo   관리자 포털                : http://localhost:5174  (admin / admin1234)
echo   Client 뷰어 포털           : http://localhost:5175  (SAMPLE01 + 개별 ID)
echo.
timeout /t 5 >nul
start http://localhost:5173
