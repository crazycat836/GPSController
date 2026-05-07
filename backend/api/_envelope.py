"""Standard `{success, data, error, meta}` response envelope.

Per `~/.claude/rules/common/patterns.md` — every JSON response from the
HTTP API is wrapped so the frontend has a single shape to deserialise:

  {
    "success": true,
    "data": <T>,
    "error": null,
    "meta": {...} | null      # optional, only set when relevant
  }

Errors come out as:

  {
    "success": false,
    "data": null,
    "error": {"code": "...", "message": "..."}
  }

Wrapping is applied transparently by the custom JSONResponse class
below — endpoints keep returning their plain dicts / lists / Pydantic
models, and FastAPI's `response_model` validation still runs first.
File-download endpoints that return ``Response(content=bytes, ...)``
bypass JSONResponse entirely, so they remain unwrapped (binary
payloads do not carry a JSON envelope).
"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from api._errors import ErrorCode


def _is_already_enveloped(content: Any) -> bool:
    """Detect a payload already in envelope shape so we never double-wrap."""
    return (
        isinstance(content, dict)
        and "success" in content
        and "data" in content
        and "error" in content
    )


def ok(data: Any = None, meta: dict[str, Any] | None = None) -> dict[str, Any]:
    """Build a success envelope explicitly. Most endpoints don't need
    this — `EnvelopeJSONResponse` wraps return values automatically."""
    body: dict[str, Any] = {"success": True, "data": data, "error": None}
    if meta is not None:
        body["meta"] = meta
    return body


def err(code: str, message: str, *, status_code: int = 400) -> HTTPException:
    """Raise via FastAPI's HTTPException flow with the structured detail
    that the global handler converts into the error envelope."""
    return HTTPException(status_code=status_code, detail={"code": code, "message": message})


class EnvelopeJSONResponse(JSONResponse):
    """JSONResponse that auto-wraps content in the success envelope.

    Hooked up as ``app = FastAPI(default_response_class=EnvelopeJSONResponse, ...)``.
    Every endpoint that returns a dict / list / Pydantic model goes
    through ``render`` here. Payloads already in envelope shape (e.g.
    explicitly built via :func:`ok`) pass through untouched.
    """

    def render(self, content: Any) -> bytes:
        if not _is_already_enveloped(content):
            content = {"success": True, "data": content, "error": None}
        return super().render(content)


async def http_exception_handler(_request: Request, exc: HTTPException) -> JSONResponse:
    """Convert HTTPException into the error envelope.

    Accepts both the structured detail dict ({"code", "message"}) used
    across the project and bare-string details from third-party libs /
    legacy code (mapped to ``code="http_<status>"``).
    """
    detail = exc.detail
    if isinstance(detail, dict) and "code" in detail and "message" in detail:
        error: dict[str, Any] = {"code": detail["code"], "message": detail.get("message", "")}
        # Preserve any extra structured fields the endpoint attached
        # (e.g. ios_unsupported includes ``ios_version`` / ``min_version``).
        for k, v in detail.items():
            if k not in error:
                error[k] = v
    else:
        message = str(detail) if detail is not None else ""
        error = {"code": f"http_{exc.status_code}", "message": message}
    body = {"success": False, "data": None, "error": error}
    # Use plain JSONResponse so we don't recurse through the auto-wrap.
    return JSONResponse(body, status_code=exc.status_code, headers=exc.headers)


async def validation_exception_handler(
    _request: Request, exc: RequestValidationError
) -> JSONResponse:
    """Convert FastAPI's 422 RequestValidationError into the error envelope."""
    body = {
        "success": False,
        "data": None,
        "error": {
            "code": ErrorCode.VALIDATION_FAILED.value,
            "message": "Request payload failed validation",
            "errors": exc.errors(),
        },
    }
    return JSONResponse(body, status_code=422)


def unauthorized_response() -> JSONResponse:
    """401 envelope used by the auth middleware. Lives here so middleware
    and route handlers share the same shape."""
    return JSONResponse(
        {
            "success": False,
            "data": None,
            "error": {"code": ErrorCode.UNAUTHORIZED.value, "message": "Missing or invalid X-GPS-Token"},
        },
        status_code=401,
    )
