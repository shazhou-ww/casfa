"""Mitsein CLI — configuration and paths."""

from __future__ import annotations

from pathlib import Path


DEFAULT_ENDPOINT = "http://localhost:8900"
DEFAULT_PROFILE = "e2e"
CONFIG_DIR = Path.home() / ".mitsein"


def ensure_config_dir() -> Path:
    """Create ~/.mitsein/ if it doesn't exist, with 0700 permissions."""
    CONFIG_DIR.mkdir(mode=0o700, exist_ok=True)
    return CONFIG_DIR


def get_profile_dir(profile: str = DEFAULT_PROFILE) -> Path:
    """Get the directory for a specific profile."""
    d = CONFIG_DIR / "profiles" / profile
    d.mkdir(mode=0o700, parents=True, exist_ok=True)
    return d


def get_openapi_cache_path() -> Path:
    """Path for cached OpenAPI spec."""
    return CONFIG_DIR / "openapi.json"
