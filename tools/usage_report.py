#!/usr/bin/env python3
"""Summarise the local UI usage log into a Markdown UX report.

Reads ``~/.geomirage/usage/usage-*.jsonl`` (written by
``backend/services/usage_log.py``, fed by ``frontend/src/services/usage.ts``)
and prints:

  1. Action usage       — every non-GET API action: count, failures, latency
  2. Never used         — backend action endpoints with zero calls
  3. Clicks per action  — UI clicks since the previous action, per endpoint,
                          plus the most common click sequence leading to it
  4. Entry points       — which region/button triggered each action
  5. Dialogs            — opens, how many closed with no action (abandoned)
  6. Dead clicks        — clicks followed by no action and no dialog
  7. Shortcuts          — keyboard shortcut usage

Usage::

    python3 tools/usage_report.py                 # all data
    python3 tools/usage_report.py --days 30       # last 30 days
    python3 tools/usage_report.py --out report.md
    python3 tools/usage_report.py --exclude-dev   # only packaged (Electron) sessions
"""

from __future__ import annotations

import argparse
import json
import re
import statistics
import sys
import time
from collections import Counter, defaultdict
from itertools import islice, takewhile
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
API_DIR = REPO_ROOT / "backend" / "api"
DEFAULT_DIR = Path.home() / ".geomirage" / "usage"

# A click belongs to the next action only if the user didn't wander off.
IDLE_RESET_MS = 120_000
# How close a click must be to an action to count as its trigger.
ENTRY_WINDOW_MS = 5_000
# Clicks with nothing happening within this window count as dead.
DEAD_WINDOW_MS = 5_000

_PREFIX_RE = re.compile(r'APIRouter\(\s*prefix\s*=\s*"([^"]*)"')
_ROUTE_RE = re.compile(r'@router\.(post|put|patch|delete)\(\s*"([^"]*)"')


def discover_action_routes() -> list[tuple[str, str]]:
    """(METHOD, path template) for every non-GET backend route."""
    routes: list[tuple[str, str]] = []
    for py in sorted(API_DIR.rglob("*.py")):
        src = py.read_text("utf-8")
        m = _PREFIX_RE.search(src)
        prefix = m.group(1) if m else ""
        if not m and py.parent != API_DIR:
            init = py.parent / "__init__.py"
            pm = _PREFIX_RE.search(init.read_text("utf-8")) if init.exists() else None
            prefix = pm.group(1) if pm else ""
        for method, path in _ROUTE_RE.findall(src):
            full = prefix + path
            if not full.startswith("/api/usage"):
                routes.append((method.upper(), full))
    return routes


def template_matcher(routes: list[tuple[str, str]]):
    compiled = [
        (method, tpl, re.compile("^" + re.sub(r"\{[^}]+\}", "[^/]+", tpl) + "/?$"))
        for method, tpl in routes
    ]

    def match(method: str, path: str) -> str:
        for m, tpl, rx in compiled:
            if m == method and rx.match(path):
                return tpl
        return path

    return match


def load_events(directory: Path, since_ms: int | None, exclude_dev: bool) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for f in sorted(directory.glob("usage-*.jsonl")):
        for line in f.read_text("utf-8").splitlines():
            try:
                e = json.loads(line)
            except json.JSONDecodeError:
                continue
            if since_ms is not None and e.get("ts", 0) < since_ms:
                continue
            if exclude_dev and e.get("env") == "dev":
                continue
            events.append(e)
    events.sort(key=lambda e: e.get("ts", 0))
    return events


def click_name(e: dict[str, Any]) -> str:
    return f"{e.get('region') or '-'} › {e.get('label') or '?'}"


def table(headers: list[str], rows: list[list[Any]]) -> str:
    if not rows:
        return "_(no data)_\n"
    out = ["| " + " | ".join(headers) + " |", "|" + "---|" * len(headers)]
    out += ["| " + " | ".join(str(c).replace("|", "\\|") for c in r) + " |" for r in rows]
    return "\n".join(out) + "\n"


def build_report(events: list[dict[str, Any]], routes: list[tuple[str, str]]) -> str:
    match = template_matcher(routes)
    by_session: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for e in events:
        if e.get("type") == "api":
            e["action"] = f"{e.get('method')} {match(e.get('method', ''), e.get('path', ''))}"
        by_session[e.get("session", "?")].append(e)

    api_events = [e for e in events if e.get("type") == "api"]
    lines: list[str] = ["# GeoMirage usage report", ""]
    if events:
        span = (events[-1]["ts"] - events[0]["ts"]) / 86_400_000
        first = time.strftime("%Y-%m-%d", time.localtime(events[0]["ts"] / 1000))
        last = time.strftime("%Y-%m-%d", time.localtime(events[-1]["ts"] / 1000))
        lines.append(
            f"{first} → {last} ({span:.1f} days) · {len(by_session)} app sessions · "
            f"{len(events)} events · {len(api_events)} actions"
        )
    lines.append("")

    # 1. Action usage
    counts: Counter[str] = Counter()
    fails: Counter[str] = Counter()
    latency: dict[str, list[int]] = defaultdict(list)
    fail_codes: dict[str, Counter[str]] = defaultdict(Counter)
    for e in api_events:
        a = e["action"]
        counts[a] += 1
        if not e.get("ok"):
            fails[a] += 1
            fail_codes[a][e.get("code") or str(e.get("status") or "no response")] += 1
        if isinstance(e.get("ms"), int):
            latency[a].append(e["ms"])
    lines.append("## 1. Action usage\n")
    lines.append(table(
        ["action", "count", "failed", "top failure", "median ms"],
        [
            [a, n, fails[a], (fail_codes[a].most_common(1)[0][0] if fails[a] else ""),
             int(statistics.median(latency[a])) if latency[a] else ""]
            for a, n in counts.most_common()
        ],
    ))

    # 2. Never used
    used = set(counts)
    unused = [f"{m} {p}" for m, p in routes if f"{m} {p}" not in used]
    lines.append("## 2. Action endpoints never called\n")
    lines.append("\n".join(f"- `{u}`" for u in unused) + "\n" if unused else "_(all used)_\n")

    # 3 + 4 + 6: walk each session in order.
    clicks_before: dict[str, list[int]] = defaultdict(list)
    sequences: dict[str, Counter[tuple[str, ...]]] = defaultdict(Counter)
    entries: dict[str, Counter[str]] = defaultdict(Counter)
    dead: Counter[str] = Counter()
    dialog_opens: Counter[str] = Counter()
    dialog_abandoned: Counter[str] = Counter()
    dialog_ms: dict[str, list[int]] = defaultdict(list)
    shortcuts: Counter[str] = Counter()

    for evs in by_session.values():
        pending: list[dict[str, Any]] = []
        open_dialogs: dict[str, tuple[int, int]] = {}  # region -> (open ts, api count at open)
        api_seen = 0
        for i, e in enumerate(evs):
            t = e.get("type")
            if pending and e["ts"] - pending[-1]["ts"] > IDLE_RESET_MS:
                pending = []
            if t == "click":
                pending.append(e)
                horizon = e["ts"] + DEAD_WINDOW_MS
                follow = takewhile(lambda x: x["ts"] <= horizon, islice(evs, i + 1, None))
                if not any(x.get("type") in ("api", "dialog_open") for x in follow):
                    dead[click_name(e)] += 1
            elif t == "key":
                shortcuts[e.get("label") or "?"] += 1
                pending.append(e)
            elif t == "api":
                api_seen += 1
                a = e["action"]
                clicks_before[a].append(sum(1 for p in pending if p.get("type") == "click"))
                sequences[a][tuple(
                    click_name(p) if p.get("type") == "click" else f"key {p.get('label')}"
                    for p in pending[-4:]
                )] += 1
                trigger = next((p for p in reversed(pending) if e["ts"] - p["ts"] <= ENTRY_WINDOW_MS), None)
                entries[a][click_name(trigger) if trigger and trigger.get("type") == "click"
                           else (f"key {trigger.get('label')}" if trigger else "(no recent input)")] += 1
                pending = []
            elif t == "dialog_open":
                region = e.get("region") or "?"
                dialog_opens[region] += 1
                open_dialogs[region] = (e["ts"], api_seen)
            elif t == "dialog_close":
                region = e.get("region") or "?"
                if region in open_dialogs:
                    opened_ts, api_at_open = open_dialogs.pop(region)
                    dialog_ms[region].append(e["ts"] - opened_ts)
                    if api_seen == api_at_open:
                        dialog_abandoned[region] += 1
                        # Clicks spent on a cancelled dialog — including the
                        # click that opened it — belong to the abandoned
                        # attempt, not to whatever action comes next.
                        cut = opened_ts
                        opener = next((p for p in reversed(pending) if p["ts"] <= opened_ts), None)
                        if opener and opened_ts - opener["ts"] <= ENTRY_WINDOW_MS:
                            cut = opener["ts"]
                        pending = [p for p in pending if p["ts"] < cut]

    lines.append("## 3. Clicks per action\n")
    lines.append("Clicks since the previous action (reset after 2 min idle). High medians = long paths.\n")
    lines.append(table(
        ["action", "n", "median clicks", "max", "most common last steps"],
        [
            [a, len(v), statistics.median(v), max(v),
             " → ".join(sequences[a].most_common(1)[0][0]) or "(none)"]
            for a, v in sorted(clicks_before.items(), key=lambda kv: -statistics.median(kv[1]))
        ],
    ))

    lines.append("## 4. Entry points\n")
    lines.append(table(
        ["action", "triggered from (count)"],
        [[a, "; ".join(f"{k} ({n})" for k, n in c.most_common(3))] for a, c in entries.items()],
    ))

    lines.append("## 5. Dialogs\n")
    lines.append("Abandoned = closed without any action in between.\n")
    lines.append(table(
        ["dialog", "opens", "abandoned", "abandon %", "median open s"],
        [
            [d, n, dialog_abandoned[d], f"{100 * dialog_abandoned[d] / n:.0f}%",
             f"{statistics.median(dialog_ms[d]) / 1000:.1f}" if dialog_ms[d] else ""]
            for d, n in dialog_opens.most_common()
        ],
    ))

    lines.append("## 6. Dead clicks\n")
    lines.append(
        f"Clicks followed by no action or dialog within {DEAD_WINDOW_MS // 1000}s. "
        "UI-only toggles (tabs, map clicks) land here legitimately; "
        "repeated clicks on the same button suggest it looks actionable but isn't.\n"
    )
    lines.append(table(["element", "count"], [[k, n] for k, n in dead.most_common(20)]))

    lines.append("## 7. Keyboard shortcuts\n")
    lines.append(table(["key", "count"], [[k, n] for k, n in shortcuts.most_common()]))
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dir", type=Path, default=DEFAULT_DIR)
    ap.add_argument("--days", type=int, help="only include the last N days")
    ap.add_argument("--out", type=Path, help="write Markdown here instead of stdout")
    # `sudo python3 start.py` serves the UI through Vite, so everyday use is
    # tagged `dev` too — include it by default.
    ap.add_argument("--exclude-dev", action="store_true", help="drop Vite dev sessions (start.py) and keep packaged-app ones")
    args = ap.parse_args()

    since = int((time.time() - args.days * 86_400) * 1000) if args.days else None
    events = load_events(args.dir, since, args.exclude_dev)
    if not events:
        print(f"No usage events found in {args.dir}", file=sys.stderr)
        return 1
    report = build_report(events, discover_action_routes())
    if args.out:
        args.out.write_text(report, "utf-8")
        print(f"Wrote {args.out}")
    else:
        print(report)
    return 0


if __name__ == "__main__":
    sys.exit(main())
