#!/usr/bin/env python
"""Runner script to launch the ILIAS Alternative FastAPI server."""
import uvicorn
from backend.config import settings

if __name__ == "__main__":
    print(f"Starting ILIAS Alternative Backend at http://{settings.api_host}:{settings.api_port}")
    print(f"API Documentation available at: http://{settings.api_host}:{settings.api_port}/docs")
    uvicorn.run(
        "backend.main:app",
        host=settings.api_host,
        port=settings.api_port,
        reload=True
    )

