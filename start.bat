@echo off
title ILIAS Alternative Launcher
echo Starting ILIAS Alternative...
if exist "venv\Scripts\python.exe" (
    venv\Scripts\python.exe start.py
) else (
    python start.py
)
pause

