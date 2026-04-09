"""Mitsein CLI — output formatting (human-readable vs JSON)."""

from __future__ import annotations

import json
import sys
from typing import Any

from rich.console import Console

_console: Console | None = None
_stderr_console: Console | None = None
_json_mode = False


def set_json_mode(enabled: bool) -> None:
    """Enable or disable JSON output mode."""
    global _json_mode
    _json_mode = enabled


def is_json_mode() -> bool:
    return _json_mode


def get_console() -> Console:
    """Get the stdout console (lazy init)."""
    global _console
    if _console is None:
        _console = Console()
    return _console


def get_stderr_console() -> Console:
    """Get the stderr console for error output (lazy init)."""
    global _stderr_console
    if _stderr_console is None:
        _stderr_console = Console(stderr=True)
    return _stderr_console


def is_tty() -> bool:
    """Check if stdout is a TTY."""
    return sys.stdout.isatty()


def emit(data: Any, *, human_formatter: Any | None = None) -> None:
    """Emit output: JSON if --json, otherwise human-readable.

    Args:
        data: The data to output.
        human_formatter: Optional callable(console, data) for custom human-readable output.
    """
    if _json_mode:
        print(json.dumps(data, ensure_ascii=False, default=str))
    elif human_formatter is not None:
        human_formatter(get_console(), data)
    elif isinstance(data, dict):
        _print_dict_human(get_console(), data)
    elif isinstance(data, list):
        for item in data:
            _print_dict_human(get_console(), item)
            get_console().print()
    else:
        get_console().print(data)


def _print_dict_human(console: Console, d: dict[str, Any]) -> None:
    """Pretty-print a dict for human consumption."""
    for key, value in d.items():
        console.print(f"[bold]{key}:[/bold] {value}")
