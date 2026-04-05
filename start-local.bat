@echo off
echo =============================================
echo  TGDP Local Dev Stack
echo =============================================
echo.

REM Set Java 21 path (installed by winget)
set JAVA_HOME=C:\Program Files\Eclipse Adoptium\jdk-21.0.10.7-hotspot
set PATH=%JAVA_HOME%\bin;%PATH%

REM Check Java 21+
java -version 2>&1 | findstr /r "version \"2[1-9]\|version \"[3-9][0-9]" >nul
if errorlevel 1 (
  echo [WARNING] Java 21+ not detected. Firebase emulators need Java 21.
  echo           Install from: https://adoptium.net/
  echo           Falling back to static-only mode...
  echo.
  goto STATIC_ONLY
)

echo [1/3] Installing functions dependencies...
cd functions && npm install --silent && cd ..

echo [2/3] Starting Firebase emulators...
start "Firebase Emulators" cmd /k "firebase emulators:start --import=./emulator-data --export-on-exit=./emulator-data"

echo [3/3] Waiting for emulators to start...
timeout /t 20 /nobreak >nul

echo [4/3] Seeding local data...
node scripts/seed-local.js

echo.
echo =============================================
echo  App running at: http://localhost:5000
echo  Emulator UI at: http://localhost:4000
echo =============================================
start http://localhost:5000
goto END

:STATIC_ONLY
echo Starting static file server (live Firebase data)...
start "TGDP Static Server" cmd /k "npx serve . -p 5000"
timeout /t 4 /nobreak >nul
echo.
echo =============================================
echo  App running at: http://localhost:5000
echo  NOTE: Using LIVE Firebase (no local data)
echo =============================================
start http://localhost:5000

:END
