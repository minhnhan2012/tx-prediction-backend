@echo off
REM TX Predictor Tool - Startup Script v2.0
REM =========================================

echo.
echo   === TX PREDICTOR TOOL v2.0 ===
echo   Tai/Xiu Prediction & Betting Assistant
echo.

REM Check if Node.js is installed
node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is not installed!
    echo Please install Node.js from: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

echo [OK] Node.js is installed: 
node --version

REM Get the directory where this script is located
cd /d "%~dp0"

echo [INFO] Current directory: %cd%

REM Check if package.json exists
if not exist package.json (
    echo [ERROR] package.json not found!
    echo Please run this script from the tx-prediction-backend directory.
    pause
    exit /b 1
)

REM Check if .env exists
if not exist .env (
    echo [WARNING] .env file not found!
    echo Creating .env from .env.example...
    if exist .env.example (
        copy .env.example .env
        echo [OK] Created .env file
    ) else (
        echo [ERROR] .env.example not found!
        pause
        exit /b 1
    )
)

REM Check if node_modules exists
if not exist node_modules (
    echo [INFO] Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo [ERROR] Failed to install dependencies!
        pause
        exit /b 1
    )
    echo [OK] Dependencies installed
)

echo.
echo [INFO] Starting TX Predictor Tool...
echo [INFO] Web UI will be available at: http://localhost:3000/tool
echo.
echo Press Ctrl+C to stop the server
echo.

REM Start the server
call npm run start

pause
