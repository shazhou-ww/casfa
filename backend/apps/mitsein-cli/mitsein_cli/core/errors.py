"""Mitsein CLI — error types and exit code mapping."""

from __future__ import annotations

import sys
from enum import IntEnum
from functools import wraps
from typing import Any, Callable

import typer


class ExitCode(IntEnum):
    """Standard CLI exit codes."""
    SUCCESS = 0
    BUSINESS_ERROR = 1      # run failed, resource not found, etc.
    USAGE_ERROR = 2          # bad args, missing credentials
    HTTP_ERROR = 3           # 4xx/5xx non-business HTTP errors
    TIMEOUT = 124            # wait/stream timeout


class CliError(Exception):
    """Structured CLI error with exit code."""

    def __init__(self, message: str, code: ExitCode = ExitCode.BUSINESS_ERROR, detail: Any = None):
        super().__init__(message)
        self.code = code
        self.detail = detail


class NoCredentialsError(CliError):
    """No valid credentials found in the provider chain."""

    def __init__(self, message: str = "No credentials found. Set MITSEIN_TOKEN, pass --token, or run from a dev environment."):
        super().__init__(message, code=ExitCode.USAGE_ERROR)


class HttpError(CliError):
    """HTTP request failed."""

    def __init__(self, status_code: int, message: str, detail: Any = None):
        code = ExitCode.BUSINESS_ERROR if 400 <= status_code < 500 else ExitCode.HTTP_ERROR
        super().__init__(message, code=code, detail=detail)
        self.status_code = status_code


def handle_errors(f: Callable[..., Any]) -> Callable[..., Any]:
    """Decorator: catch CliError and KeyboardInterrupt, print nicely, exit with correct code."""

    @wraps(f)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        try:
            return f(*args, **kwargs)
        except CliError as e:
            # Import here to avoid circular dependency
            from .output import get_stderr_console
            console = get_stderr_console()
            console.print(f"[bold red]Error:[/bold red] {e}")
            if e.detail:
                console.print(f"[dim]{e.detail}[/dim]")
            raise typer.Exit(code=e.code) from None
        except KeyboardInterrupt:
            print("\nInterrupted.", file=sys.stderr)
            raise typer.Exit(code=130) from None

    return wrapper
