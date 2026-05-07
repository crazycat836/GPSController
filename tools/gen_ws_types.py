#!/usr/bin/env python3
"""Generate TypeScript types from the backend WS event registry.

Reads :mod:`backend.models.ws_events` and writes
``frontend/src/generated/api-contract.ts`` containing:

  - One ``interface`` per event payload model
  - A ``WsEventType`` string-literal union of every event name
  - A ``WsEvent`` discriminated union keyed on ``type`` so the
    frontend WS dispatcher's ``switch (msg.type)`` narrows on the
    right payload shape

Re-run after adding / changing any event in the registry.

Usage::

    python3 tools/gen_ws_types.py
"""

from __future__ import annotations

import sys
import types
from pathlib import Path
from typing import Any, Literal, Union, get_args, get_origin

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "backend"))

from pydantic import BaseModel  # noqa: E402

from api._errors import ErrorCode  # noqa: E402
from models.ws_events import WS_EVENTS  # noqa: E402


_OUT_PATH = REPO_ROOT / "frontend" / "src" / "generated" / "api-contract.ts"


_HEADER = """\
/**
 * GENERATED FILE — do not edit by hand.
 *
 * Source: backend/models/ws_events.py (WS_EVENTS registry)
 * Tool:   tools/gen_ws_types.py
 *
 * Re-run after editing the registry:
 *   python3 tools/gen_ws_types.py
 */

"""


def _ts_type_for(annotation: Any) -> str:
    """Map a Pydantic field annotation to a TS type string."""
    if annotation is str:
        return "string"
    if annotation is bool:
        return "boolean"
    if annotation in (int, float):
        return "number"
    if annotation is type(None):
        return "null"
    if annotation is Any:
        return "unknown"

    origin = get_origin(annotation)
    args = get_args(annotation)

    # Both Python-3.10 ``X | Y`` (types.UnionType) and ``typing.Union[X, Y]``
    if origin is Union or origin is types.UnionType:
        return " | ".join(_ts_type_for(a) for a in args)

    if origin is list:
        inner = _ts_type_for(args[0]) if args else "unknown"
        return f"{inner}[]"

    if origin is dict:
        key = _ts_type_for(args[0]) if len(args) >= 1 else "string"
        val = _ts_type_for(args[1]) if len(args) >= 2 else "unknown"
        return f"Record<{key}, {val}>"

    if origin is Literal:
        return " | ".join(repr(a) if isinstance(a, str) else str(a) for a in args)

    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        return annotation.__name__

    return "unknown"


def _ts_field(name: str, info: Any) -> str:
    """Render one TypeScript interface field from a Pydantic field info."""
    annotation = info.annotation
    args = get_args(annotation)

    # ``X | None`` annotations: collapse to plain ``X`` + optional marker.
    if args and type(None) in args:
        non_none = [a for a in args if a is not type(None)]
        if len(non_none) == 1:
            ts = _ts_type_for(non_none[0])
        else:
            ts = " | ".join(_ts_type_for(a) for a in non_none)
        return f"  {name}?: {ts}"

    optional = info.is_required() is False
    ts = _ts_type_for(annotation)
    return f"  {name}{'?' if optional else ''}: {ts}"


def _render_interface(model: type[BaseModel]) -> str:
    """Render one TS interface for a Pydantic model."""
    fields = [_ts_field(fname, finfo) for fname, finfo in model.model_fields.items()]
    body = "\n".join(fields) if fields else "  // (empty payload)"
    docstring = (model.__doc__ or "").strip()
    leading = ""
    if docstring:
        first_line = docstring.split("\n")[0]
        leading = f"/** {first_line} */\n"
    return f"{leading}export interface {model.__name__} {{\n{body}\n}}\n"


def _render_union() -> str:
    """Render the discriminated `WsEvent` union."""
    arms = [
        f'  | {{ type: "{event_name}"; data: {model.__name__} }}'
        for event_name, model in WS_EVENTS.items()
    ]
    body = "\n".join(arms)
    return (
        "/**\n"
        " * Discriminated union of every WebSocket event the backend emits.\n"
        " * Use as `switch (msg.type)` so the compiler narrows `msg.data`.\n"
        " */\n"
        "export type WsEvent =\n"
        f"{body};\n"
    )


def _render_event_name_union() -> str:
    arms = " | ".join(f'"{n}"' for n in WS_EVENTS)
    return f"export type WsEventType = {arms};\n"


def _render_error_code_union() -> str:
    """Render `BackendErrorCode` (TS type) and `BACKEND_ERROR_CODES`
    (runtime tuple) from the live ErrorCode StrEnum.

    The frontend i18n table must mirror this exactly — the contract
    test in ``frontend/src/i18n/strings.test.ts`` walks the runtime
    tuple and asserts every member has an ``err.<code>`` translation
    in ``STRINGS``.
    """
    arms = " | ".join(f'"{c.value}"' for c in ErrorCode)
    runtime = ",\n  ".join(f'"{c.value}"' for c in ErrorCode)
    return (
        "/**\n"
        " * Mirrors backend/api/_errors.py::ErrorCode. Used by the i18n\n"
        " * contract test to detect drift between backend codes and the\n"
        " * `err.<code>` lookup table in `frontend/src/i18n/strings.ts`.\n"
        " */\n"
        f"export type BackendErrorCode = {arms};\n"
        "\n"
        "/** Runtime version of `BackendErrorCode` for iteration in tests. */\n"
        "export const BACKEND_ERROR_CODES = [\n"
        f"  {runtime},\n"
        "] as const satisfies readonly BackendErrorCode[];\n"
    )


def main() -> int:
    out_dir = _OUT_PATH.parent
    out_dir.mkdir(parents=True, exist_ok=True)

    parts = [_HEADER]
    for _name, model in WS_EVENTS.items():
        parts.append(_render_interface(model))
    parts.append(_render_event_name_union())
    parts.append(_render_union())
    parts.append(_render_error_code_union())

    text = "\n".join(parts)
    _OUT_PATH.write_text(text, encoding="utf-8")
    print(f"wrote {_OUT_PATH.relative_to(REPO_ROOT)} ({len(WS_EVENTS)} events)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
