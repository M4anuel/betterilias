import logging
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.api.routes import auth, dashboard, exercises, materials, system
from backend.config import settings
from backend.scrapers.dumper import ScrapingParsingError
from backend.services.ilias_client import SessionExpiredError

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("ilias.main")

app = FastAPI(
    title="ILIAS Alternative API",
    description="High-performance backend & scraper bridge for Uni Bern ILIAS",
    version="1.0.0",
)

# CORS configuration for React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(SessionExpiredError)
async def session_expired_handler(request: Request, exc: SessionExpiredError):
    logger.warning(f"Session expired or unauthorized request: {exc}")
    return JSONResponse(
        status_code=status.HTTP_401_UNAUTHORIZED,
        content={
            "error": "Session Expired",
            "detail": str(exc),
            "code": "SESSION_EXPIRED"
        }
    )


@app.exception_handler(ScrapingParsingError)
async def scraping_error_handler(request: Request, exc: ScrapingParsingError):
    logger.error(f"Scraping error: {exc}")
    return JSONResponse(
        status_code=status.HTTP_502_BAD_GATEWAY,
        content={
            "error": "Scraping Parsing Failed",
            "detail": exc.message,
            "context": exc.context,
            "dump_file": str(exc.dump_path) if exc.dump_path else None,
            "code": "PARSING_FAILED"
        }
    )


# Register API Routes
app.include_router(auth.router, prefix="/api")
app.include_router(dashboard.router, prefix="/api")
app.include_router(materials.router, prefix="/api")
app.include_router(exercises.router, prefix="/api")
app.include_router(system.router, prefix="/api")


@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "service": "ILIAS Alternative API",
        "ilias_base_url": settings.ilias_base_url,
    }


@app.get("/")
def root():
    return {
        "message": "Welcome to ILIAS Alternative Backend API",
        "docs_url": "/docs",
        "health_url": "/health"
    }

