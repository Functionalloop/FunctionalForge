@echo off
title Bhasha Mentor Backend Server
cd /d "%~dp0backend"
set PYTHONPATH=%~dp0backend;%PYTHONPATH%
echo ===================================================
echo Starting Bhasha Mentor Offline Backend on port 8000
echo Open http://localhost:8000 in your browser
echo ===================================================
C:\Users\taish\AppData\Local\Programs\Python\Python313\python.exe -m uvicorn main:app --port 8000 --host 0.0.0.0 --reload
if %ERRORLEVEL% neq 0 (
    echo.
    echo Fallback: trying without --reload...
    C:\Users\taish\AppData\Local\Programs\Python\Python313\python.exe -m uvicorn main:app --port 8000 --host 0.0.0.0
)
pause
