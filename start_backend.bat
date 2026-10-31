@echo off
title Bhasha Mentor Backend Server
cd /d "%~dp0backend"
echo ===================================================
echo Starting Bhasha Mentor Offline Backend on port 8000
echo ===================================================
C:\Users\taish\AppData\Local\Programs\Python\Python313\python.exe -m uvicorn main:app --port 8000 --host 0.0.0.0
pause
