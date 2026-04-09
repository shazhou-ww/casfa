"""Mitsein CLI — Credential Provider Chain (inspired by botocore)."""

from __future__ import annotations

import os
import subprocess
from abc import ABC, abstractmethod
from dataclasses import dataclass
from urllib.parse import urlparse

from .config import DEFAULT_ENDPOINT
from .errors import NoCredentialsError


@dataclass
class Credentials:
    """Resolved credentials: token + endpoint."""
    token: str
    endpoint: str


class CredentialProvider(ABC):
    """Base class for credential providers."""

    @abstractmethod
    def load(self) -> Credentials | None:
        """Try to load credentials. Return None if this provider can't provide them."""
        ...


class ExplicitFlagProvider(CredentialProvider):
    """Provider 1: credentials from explicit --token / --endpoint CLI flags."""

    def __init__(self, token: str | None = None, endpoint: str | None = None):
        self._token = token
        self._endpoint = endpoint

    def load(self) -> Credentials | None:
        if self._token:
            return Credentials(
                token=self._token,
                endpoint=self._endpoint or DEFAULT_ENDPOINT,
            )
        return None


class EnvProvider(CredentialProvider):
    """Provider 2: credentials from MITSEIN_TOKEN / MITSEIN_API_URL env vars."""

    def load(self) -> Credentials | None:
        token = os.environ.get("MITSEIN_TOKEN")
        if token:
            return Credentials(
                token=token,
                endpoint=os.environ.get("MITSEIN_API_URL", DEFAULT_ENDPOINT),
            )
        return None


class DevTokenProvider(CredentialProvider):
    """Provider 3: credentials from scripts/dev-token.sh.

    Security: ONLY enabled when endpoint resolves to localhost / 127.0.0.1.
    This prevents accidentally using a stress/dev token against staging or production.
    """

    def __init__(self, endpoint: str | None = None, real: bool = False, project_root: str | None = None):
        self._endpoint = endpoint or DEFAULT_ENDPOINT
        self._real = real
        self._project_root = project_root

    @staticmethod
    def _is_localhost(endpoint: str) -> bool:
        """Check if the endpoint points to localhost."""
        parsed = urlparse(endpoint)
        host = parsed.hostname or ""
        return host in ("localhost", "127.0.0.1", "::1", "0.0.0.0")

    def _find_script(self) -> str | None:
        """Find dev-token.sh by walking up from project root or cwd."""
        import pathlib

        search_roots = []
        if self._project_root:
            search_roots.append(pathlib.Path(self._project_root))
        search_roots.append(pathlib.Path.cwd())

        for root in search_roots:
            # Walk up looking for scripts/dev-token.sh
            current = root
            for _ in range(10):  # max depth
                script = current / "scripts" / "dev-token.sh"
                if script.exists():
                    return str(script)
                parent = current.parent
                if parent == current:
                    break
                current = parent
        return None

    def load(self) -> Credentials | None:
        if not self._is_localhost(self._endpoint):
            return None

        script = self._find_script()
        if not script:
            return None

        try:
            cmd = [script, "--raw"]
            if self._real:
                cmd.append("--real")

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=10,
            )
            token = result.stdout.strip()
            if result.returncode == 0 and token:
                return Credentials(token=token, endpoint=self._endpoint)
        except (subprocess.TimeoutExpired, FileNotFoundError, PermissionError):
            pass
        return None


def resolve_credentials(
    token: str | None = None,
    endpoint: str | None = None,
    real: bool = False,
    project_root: str | None = None,
) -> Credentials:
    """Run the credential provider chain. Raises NoCredentialsError if all fail."""
    providers: list[CredentialProvider] = [
        ExplicitFlagProvider(token=token, endpoint=endpoint),
        EnvProvider(),
        DevTokenProvider(endpoint=endpoint, real=real, project_root=project_root),
    ]

    for provider in providers:
        creds = provider.load()
        if creds is not None:
            return creds

    raise NoCredentialsError()
