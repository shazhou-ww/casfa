"""Mitsein CLI — HTTP client wrapping httpx."""

from __future__ import annotations

import sys
from typing import Any

import httpx

from .credentials import Credentials, resolve_credentials
from .errors import CliError, ExitCode, HttpError


class ApiClient:
    """HTTP client for Mitsein API.

    Wraps httpx with:
    - Automatic Authorization header from credential chain
    - Structured error handling → CliError
    - Debug logging support
    """

    def __init__(
        self,
        credentials: Credentials,
        timeout: float = 30.0,
        debug: bool = False,
    ):
        self._credentials = credentials
        self._debug = debug
        self._client = httpx.Client(
            base_url=credentials.endpoint,
            headers={
                "Authorization": f"Bearer {credentials.token}",
                "Content-Type": "application/json",
            },
            timeout=timeout,
        )

    @classmethod
    def from_options(
        cls,
        token: str | None = None,
        endpoint: str | None = None,
        real: bool = False,
        timeout: float = 30.0,
        debug: bool = False,
    ) -> "ApiClient":
        """Create an ApiClient by resolving credentials from the provider chain."""
        creds = resolve_credentials(token=token, endpoint=endpoint, real=real)
        return cls(credentials=creds, timeout=timeout, debug=debug)

    def _log_request(self, method: str, url: str, **kwargs: Any) -> None:
        if self._debug:
            print(f"[debug] {method} {url}", file=sys.stderr)
            if "json" in kwargs:
                import json
                print(f"[debug] body: {json.dumps(kwargs['json'], ensure_ascii=False)}", file=sys.stderr)

    def _log_response(self, response: httpx.Response) -> None:
        if self._debug:
            print(f"[debug] → {response.status_code} ({len(response.content)} bytes)", file=sys.stderr)

    def _handle_response(self, response: httpx.Response) -> Any:
        """Process response, raise HttpError on failure."""
        self._log_response(response)

        if response.is_success:
            if response.headers.get("content-type", "").startswith("application/json"):
                return response.json()
            return response.text

        # Try to extract error detail from JSON body
        detail = None
        message = f"HTTP {response.status_code}"
        try:
            body = response.json()
            if isinstance(body, dict):
                message = body.get("message", message)
                detail = body.get("detail") or body.get("error")
        except Exception:
            pass

        raise HttpError(
            status_code=response.status_code,
            message=message,
            detail=detail,
        )

    def get(self, path: str, *, params: dict[str, Any] | None = None) -> Any:
        """GET request."""
        self._log_request("GET", path)
        response = self._client.get(path, params=params)
        return self._handle_response(response)

    def post(self, path: str, *, json: Any = None) -> Any:
        """POST request."""
        self._log_request("POST", path, json=json)
        response = self._client.post(path, json=json)
        return self._handle_response(response)

    def patch(self, path: str, *, json: Any = None) -> Any:
        """PATCH request."""
        self._log_request("PATCH", path, json=json)
        response = self._client.patch(path, json=json)
        return self._handle_response(response)

    def delete(self, path: str) -> Any:
        """DELETE request."""
        self._log_request("DELETE", path)
        response = self._client.delete(path)
        return self._handle_response(response)

    def close(self) -> None:
        """Close the underlying httpx client."""
        self._client.close()

    def __enter__(self) -> "ApiClient":
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()
