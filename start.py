#!/usr/bin/env python
"""
Unified launcher for ILIAS Alternative.
Starts both the FastAPI Python backend and the React Vite frontend concurrently.
Handles graceful shutdown of both servers on Ctrl+C.
"""
import os
import signal
import subprocess
import sys
import time
import webbrowser
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR / "frontend"

# Locate virtual environment Python
if os.name == "nt":
    VENV_PYTHON = BASE_DIR / "venv" / "Scripts" / "python.exe"
    NPM_CMD = "npm.cmd"
else:
    VENV_PYTHON = BASE_DIR / "venv" / "bin" / "python"
    NPM_CMD = "npm"

PYTHON_BIN = sys.executable


def select_python():
    """Use a local virtual environment only if its base interpreter still works."""
    for directory in ("venv", ".venv"):
        candidate = BASE_DIR / directory / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        if not candidate.exists():
            continue
        try:
            result = subprocess.run(
                [str(candidate), "--version"], capture_output=True, text=True, timeout=10
            )
        except (OSError, subprocess.TimeoutExpired):
            result = None
        if result is not None and result.returncode == 0:
            return str(candidate)
        print(f"[!] Virtual environment is broken: {candidate}. Skipping it.")
    return sys.executable


def check_prerequisites():
    """Verify that dependencies exist before launching."""
    global PYTHON_BIN
    PYTHON_BIN = select_python()
    print(f"Using Python: {PYTHON_BIN}")
    result = subprocess.run(
        [PYTHON_BIN, "-c", "import fastapi, uvicorn, playwright, bs4, lxml, httpx, pydantic, pydantic_settings, dotenv; from backend.main import app"],
        cwd=str(BASE_DIR), capture_output=True, text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"Backend dependencies could not be imported:\n{result.stderr}"
            f'Install them with: "{PYTHON_BIN}" -m pip install -r requirements.txt'
        )
    if not (FRONTEND_DIR / "node_modules").exists():
        print("[!] Frontend node_modules not found. Installing packages...")
        subprocess.run([NPM_CMD, "install"], cwd=str(FRONTEND_DIR), check=True)

def main():
    print("=" * 65)
    print(" 🚀 Starting ILIAS Alternative (Uni Bern)")
    print("=" * 65)

    check_prerequisites()

    processes = []

    try:
        # 1. Start FastAPI Backend
        print("[1/2] Launching Backend API (FastAPI) on http://127.0.0.1:8000 ...")
        backend_proc = subprocess.Popen(
            [PYTHON_BIN, "run.py"],
            cwd=str(BASE_DIR),
            stdout=sys.stdout,
            stderr=sys.stderr,
        )
        processes.append(("Backend", backend_proc))

        # Give backend a moment to start
        time.sleep(1.2)
        if backend_proc.poll() is not None:
            raise RuntimeError(f"Backend failed to start (exit code: {backend_proc.returncode}).")

        # 2. Start React Frontend (Vite)
        print("[2/2] Launching Frontend (Vite) on http://localhost:5173 ...")
        frontend_proc = subprocess.Popen(
            [NPM_CMD, "run", "dev"],
            cwd=str(FRONTEND_DIR),
            stdout=sys.stdout,
            stderr=sys.stderr,
        )
        processes.append(("Frontend", frontend_proc))

        print("\n" + "=" * 65)
        print(" 🎉 Both servers are running!")
        print("    • Web App:  http://localhost:5173")
        print("    • REST API: http://127.0.0.1:8000/docs")
        print(" Press Ctrl+C at any time to stop both servers.")
        print("=" * 65 + "\n")

        # Open web browser automatically after 1.5 seconds
        time.sleep(1.5)
        webbrowser.open("http://localhost:5173")

        # Keep parent process alive monitoring children
        while True:
            time.sleep(1)
            for name, proc in processes:
                if proc.poll() is not None:
                    print(f"\n[!] {name} stopped unexpectedly (exit code: {proc.returncode}).")
                    return

    except KeyboardInterrupt:
        print("\n[!] Shutting down servers gracefully...")
    finally:
        for name, proc in processes:
            if proc.poll() is None:
                print(f"Stopping {name}...")
                if os.name == "nt":
                    # On Windows, kill process tree
                    subprocess.call(["taskkill", "/F", "/T", "/PID", str(proc.pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                else:
                    proc.terminate()
        print("All servers stopped. Goodbye!")


if __name__ == "__main__":
    main()
