"""Shared HTTP error helper for API routers.

Centralises the `{code, message}` detail envelope used across every API so
internal exception text never leaks onto the wire. Raise the result of
``http_err(...)`` instead of ``HTTPException(detail=str(e))``.
"""

from fastapi import HTTPException


def http_err(status: int, code: str, message: str) -> HTTPException:
    """Build a structured HTTPException with `{code, message}` detail.

    Use this instead of raising `HTTPException(detail=str(e))` so internal
    exception text never leaks to API clients.
    """
    return HTTPException(status_code=status, detail={"code": code, "message": message})
