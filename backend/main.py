import httpx
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException

from backend.api.routes import auth, calendar, dashboard, exercises, materials, system
from backend.config import settings
from backend.scrapers.dumper import ScrapingParsingError
from backend.services.ilias_client import SessionExpiredError
from backend.services.submission_listing import SubmissionListingError
from backend.i18n import LanguageMiddleware, t
from backend.coordination import CoordinationBusy
from backend.outbound_budget import OutboundUnavailable
from backend.outbound_targets import OutboundTargetRejected
from backend.observability import DiagnosticMiddleware, configure_logging, emit, shutdown
from backend.api.routes import admin
from backend.api.routes import diagnostics
from backend.diagnostic_reports import ReportMiddleware, problem

configure_logging()
logger = logging.getLogger("ilias.main")


@asynccontextmanager
async def lifespan(app):
    configure_logging()
    emit('worker.started')
    try:
        yield
    finally:
        emit('worker.stopped')
        shutdown()


app = FastAPI(
    lifespan=lifespan,
    title="ILIAS Alternative API",
    description="High-performance backend & scraper bridge for Uni Bern ILIAS",
    version="1.0.0",
    docs_url='/docs' if settings.app_env == 'development' else None,
    redoc_url='/redoc' if settings.app_env == 'development' else None,
    openapi_url='/openapi.json' if settings.app_env == 'development' else None,
)
app.add_middleware(LanguageMiddleware)
app.add_middleware(DiagnosticMiddleware)
app.add_middleware(ReportMiddleware)


@app.exception_handler(OutboundTargetRejected)
async def outbound_target_rejected_handler(request: Request, exc: OutboundTargetRejected):
    problem('OUTBOUND_TARGET_BLOCKED')
    return JSONResponse(status_code=400, content={'detail': t('outbound.target_blocked'), 'code': 'OUTBOUND_TARGET_BLOCKED'},
                        headers={'Cache-Control': 'no-store'})


@app.exception_handler(OutboundUnavailable)
async def outbound_unavailable_handler(request: Request, exc: OutboundUnavailable):
    problem('ILIAS_BUSY')
    emit('outbound.busy', status=503)
    return JSONResponse(status_code=503,
        content={'detail': t('outbound.write_uncertain') if exc.write_uncertain or request.method not in ('GET', 'HEAD', 'OPTIONS') else t('outbound.busy'),
                 'code': 'ILIAS_BUSY'},
        headers={'Retry-After': str(exc.retry_after), 'Cache-Control': 'no-store'})


@app.exception_handler(CoordinationBusy)
async def coordination_busy_handler(request: Request, exc: CoordinationBusy):
    problem('COORDINATION_BUSY')
    emit('coordination.busy', status=503)
    return JSONResponse(status_code=503, content={'detail': t('coordination.busy')}, headers={'Retry-After': '1'})


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    emit('input.invalid', status=422)
    return JSONResponse(status_code=422, content={"detail": [
        {"loc": list(error['loc']), "type": error['type'],
         "msg": t('validation.required' if error['type'] == 'missing' else 'validation.invalid')}
        for error in exc.errors()
    ]})


@app.exception_handler(HTTPException)
async def http_error_handler(request: Request, exc: HTTPException):
    detail = t(exc.detail) if isinstance(exc.detail, str) and exc.detail in ('Not Found', 'Method Not Allowed') else exc.detail
    return JSONResponse(status_code=exc.status_code, content={"detail": detail}, headers=exc.headers)

# CORS configuration for React frontend & Browser extensions
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=(r"^(chrome-extension://.*|moz-extension://.*)$" if settings.app_env == 'production'
                        else r"^(chrome-extension://.*|moz-extension://.*|http://localhost(:\d+)?|http://127\.0\.0\.1(:\d+)?)$"),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Length", "Content-Disposition", "X-Session-Id", "X-Request-Id",
                    "X-Diagnostic-Capture", "X-Diagnostic-Code", "X-Diagnostic-Report"],
)


@app.exception_handler(SessionExpiredError)
async def session_expired_handler(request: Request, exc: SessionExpiredError):
    emit('auth.rejected', status=401)
    logger.warning(f"Session expired or unauthorized request: {exc}")
    return JSONResponse(
        status_code=status.HTTP_401_UNAUTHORIZED,
        content={
            "error": t('Session Expired'),
            "detail": str(exc),
            "code": "SESSION_EXPIRED"
        }
    )


@app.exception_handler(SubmissionListingError)
async def submission_listing_error_handler(request: Request, exc: SubmissionListingError):
    problem('SUBMISSIONS_INCOMPLETE')
    return JSONResponse(status_code=502, content={'detail': str(exc), 'code': 'SUBMISSIONS_INCOMPLETE'})


@app.exception_handler(ScrapingParsingError)
async def scraping_error_handler(request: Request, exc: ScrapingParsingError):
    problem('PARSING_FAILED')
    logger.error(f"Scraping error: {exc}")
    return JSONResponse(
        status_code=status.HTTP_502_BAD_GATEWAY,
        content={
            "error": t('Scraping Parsing Failed'),
            "detail": exc.message,
            "context": exc.context,
            "dump_file": str(exc.dump_path) if exc.dump_path and settings.app_env == 'development' else None,
            "code": "PARSING_FAILED"
        }
    )


@app.exception_handler(httpx.TimeoutException)
async def httpx_timeout_handler(request: Request, exc: httpx.TimeoutException):
    problem('ILIAS_TIMEOUT')
    emit('outbound.timeout', status=504)
    logger.warning(f"ILIAS timeout on {request.url.path}: {exc}")
    return JSONResponse(
        status_code=status.HTTP_504_GATEWAY_TIMEOUT,
        content={
            "error": t('Gateway Timeout'),
            "detail": t('Zeitüberschreitung bei der Kommunikation mit ILIAS (ilias.unibe.ch). Bitte versuche es in wenigen Momenten erneut.'),
            "code": "ILIAS_TIMEOUT"
        }
    )


@app.exception_handler(httpx.NetworkError)
async def httpx_network_handler(request: Request, exc: httpx.NetworkError):
    problem('ILIAS_NETWORK_ERROR')
    emit('outbound.network_error', status=502)
    logger.warning(f"ILIAS network error on {request.url.path}: {exc}")
    return JSONResponse(
        status_code=status.HTTP_502_BAD_GATEWAY,
        content={
            "error": t('Bad Gateway'),
            "detail": t('Netzwerkfehler bei der Kommunikation mit ILIAS (ilias.unibe.ch). Bitte überprüfe deine Internetverbindung.'),
            "code": "ILIAS_NETWORK_ERROR"
        }
    )


# Register API Routes
app.include_router(auth.router, prefix="/api")
app.include_router(dashboard.router, prefix="/api")
app.include_router(materials.router, prefix="/api")
app.include_router(exercises.router, prefix="/api")
app.include_router(calendar.router, prefix="/api")
app.include_router(system.router, prefix="/api")
app.include_router(admin.router, prefix="/api")
app.include_router(diagnostics.router, prefix="/api")


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
        "message": t('Welcome to ILIAS Alternative Backend API'),
        "docs_url": "/docs",
        "health_url": "/health"
    }

