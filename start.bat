@echo off
title ILIAS Alternative Launcher
echo Starting ILIAS Alternative...
cd /d "%~dp0"
if exist "venv\Scripts\python.exe" (
    venv\Scripts\python.exe --version >nul 2>&1
    if not errorlevel 1 (
        venv\Scripts\python.exe start.py
        goto end
    )
)
python start.py
:end
pause
