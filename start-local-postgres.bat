@echo off
setlocal

REM ═══════════════════════════════════════════════════════════════════════════
REM  TGDP Ecosystem — Local development startup (PostgreSQL edition)
REM  Starts: Firebase Auth emulator → Express API server → Browser
REM ═══════════════════════════════════════════════════════════════════════════

set "ROOT=%~dp0"
set "JAVA_HOME=C:\Program Files\Eclipse Adoptium\jdk-21.0.10.7-hotspot"
set "PATH=%JAVA_HOME%\bin;%PATH%"

REM ─── 1. Check PostgreSQL is running ─────────────────────────────────────────
echo [1/4] Checking PostgreSQL...
pg_isready -U postgres >nul 2>&1
if errorlevel 1 (
  echo      PostgreSQL not running. Starting via pg_ctl...
  pg_ctl start -D "%PGDATA%" >nul 2>&1
  timeout /t 3 /nobreak >nul
  pg_isready -U postgres >nul 2>&1
  if errorlevel 1 (
    echo      ERROR: Could not start PostgreSQL.
    echo      Please start PostgreSQL manually, then re-run this script.
    pause
    exit /b 1
  )
)
echo      PostgreSQL OK.

REM ─── 2. Apply schema (first run only) ───────────────────────────────────────
echo [2/4] Checking database schema...
psql -U postgres -tc "SELECT 1 FROM information_schema.tables WHERE table_name='users'" tgdp_local 2>nul | findstr /c:"1" >nul 2>&1
if errorlevel 1 (
  echo      Creating database and applying schema...
  psql -U postgres -c "CREATE DATABASE tgdp_local;" 2>nul
  psql -U postgres -d tgdp_local -f "%ROOT%database\schema.sql"
  echo      Schema applied.
) else (
  echo      Schema already exists, skipping.
)

REM ─── 3. Start Firebase Auth emulator (background) ───────────────────────────
echo [3/4] Starting Firebase Auth emulator...
start "TGDP Auth Emulator" /min cmd /c "cd /d %ROOT% && firebase emulators:start --only auth --import=./emulator-data --export-on-exit=./emulator-data 2>&1"
timeout /t 6 /nobreak >nul

REM ─── 4. Install server dependencies if needed ────────────────────────────────
if not exist "%ROOT%server\node_modules" (
  echo      Installing server dependencies...
  cd /d "%ROOT%server"
  call npm install --silent
  cd /d "%ROOT%"
)

REM ─── 5. Seed demo users (idempotent) ─────────────────────────────────────────
echo      Seeding demo users...
node "%ROOT%scripts\seed-postgres.js" 2>&1
if errorlevel 1 (
  echo      Seed warning ^(continuing anyway^)...
)

REM ─── 6. Start Express API server (background) ────────────────────────────────
echo [4/4] Starting TGDP API server on http://localhost:3001 ...
start "TGDP API Server" /min cmd /c "cd /d %ROOT%server && node index.js 2>&1"
timeout /t 3 /nobreak >nul

REM ─── 7. Open browser ────────────────────────────────────────────────────────
echo.
echo  ══════════════════════════════════════════════════════
echo   TGDP running at: http://localhost:3001
echo   API health:      http://localhost:3001/api/v1/health
echo   Auth emulator:   http://localhost:4000
echo.
echo   Demo logins:
echo     admin@tgdp.local      Admin@1234
echo     household@tgdp.local  House@1234
echo     licensee@tgdp.local   Licensee@1234
echo  ══════════════════════════════════════════════════════
echo.

start "" "http://localhost:3001"

echo  Press any key to stop all services...
pause >nul

echo  Stopping services...
taskkill /fi "WindowTitle eq TGDP API Server*"     /f >nul 2>&1
taskkill /fi "WindowTitle eq TGDP Auth Emulator*"  /f >nul 2>&1
echo  Done.
