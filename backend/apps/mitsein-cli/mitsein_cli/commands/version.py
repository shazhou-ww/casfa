"""Mitsein CLI — version command."""

from __future__ import annotations

import typer

from ..core.errors import handle_errors
from ..core.output import emit


@handle_errors
def version_command() -> None:
    """Print CLI version."""
    try:
        from importlib.metadata import version as pkg_version
        ver = pkg_version("mitsein-cli")
    except Exception:
        ver = "0.1.0-dev"
    emit(ver)
