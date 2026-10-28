"""Consistent error responses: {"error": {"code", "message", "request_id", "details"}}.

Internal exceptions, paths and stack traces are never returned to clients."""

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.logging import request_id_var

logger = logging.getLogger("aether.errors")


class AppError(Exception):
    status_code = 400
    code = "bad_request"

    def __init__(
        self, message: str, *, code: str | None = None, status_code: int | None = None, details: Any = None
    ) -> None:
        super().__init__(message)
        self.message = message
        if code:
            self.code = code
        if status_code:
            self.status_code = status_code
        self.details = details


class NotFound(AppError):
    status_code = 404
    code = "not_found"


class Forbidden(AppError):
    status_code = 403
    code = "forbidden"


class Unauthorized(AppError):
    status_code = 401
    code = "unauthorized"


class Conflict(AppError):
    status_code = 409
    code = "conflict"


class ValidationFailed(AppError):
    status_code = 422
    code = "validation_failed"


def error_body(code: str, message: str, details: Any = None) -> dict[str, Any]:
    return {"error": {"code": code, "message": message, "request_id": request_id_var.get(), "details": details}}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(error_body(exc.code, exc.message, exc.details), status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        details = [{"loc": [str(p) for p in e.get("loc", [])], "msg": e.get("msg")} for e in exc.errors()]
        return JSONResponse(error_body("validation_failed", "Request validation failed", details), status_code=422)

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        return JSONResponse(error_body(f"http_{exc.status_code}", str(exc.detail)), status_code=exc.status_code)

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled error")
        return JSONResponse(error_body("internal_error", "An unexpected error occurred"), status_code=500)
