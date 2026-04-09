"""Tests for the API client."""

from __future__ import annotations

import pytest
import httpx

from mitsein_cli.core.client import ApiClient
from mitsein_cli.core.credentials import Credentials
from mitsein_cli.core.errors import HttpError


class TestApiClient:
    def make_client(self, **kwargs) -> ApiClient:
        creds = Credentials(token="test-token", endpoint="http://localhost:8900")
        return ApiClient(credentials=creds, **kwargs)

    def test_auth_header_injected(self):
        client = self.make_client()
        # Check the httpx client has the auth header
        assert client._client.headers["authorization"] == "Bearer test-token"

    def test_content_type_set(self):
        client = self.make_client()
        assert client._client.headers["content-type"] == "application/json"

    def test_base_url_set(self):
        client = self.make_client()
        assert str(client._client.base_url) == "http://localhost:8900"

    def test_context_manager(self):
        with self.make_client() as client:
            assert client._client is not None

    def test_handle_response_success_json(self):
        client = self.make_client()
        response = httpx.Response(
            200,
            json={"ok": True},
            headers={"content-type": "application/json"},
        )
        result = client._handle_response(response)
        assert result == {"ok": True}

    def test_handle_response_success_text(self):
        client = self.make_client()
        response = httpx.Response(
            200,
            text="hello",
            headers={"content-type": "text/plain"},
        )
        result = client._handle_response(response)
        assert result == "hello"

    def test_handle_response_404(self):
        client = self.make_client()
        response = httpx.Response(
            404,
            json={"error": "NOT_FOUND", "message": "Thread not found"},
            headers={"content-type": "application/json"},
        )
        with pytest.raises(HttpError) as exc_info:
            client._handle_response(response)
        assert exc_info.value.status_code == 404
        assert "Thread not found" in str(exc_info.value)

    def test_handle_response_500(self):
        client = self.make_client()
        response = httpx.Response(
            500,
            json={"error": "INTERNAL_ERROR", "message": "Something broke"},
            headers={"content-type": "application/json"},
        )
        with pytest.raises(HttpError) as exc_info:
            client._handle_response(response)
        assert exc_info.value.status_code == 500
        assert exc_info.value.code == 3  # HTTP_ERROR

    def test_from_options_with_explicit_token(self):
        client = ApiClient.from_options(token="my-token", endpoint="http://localhost:9000")
        assert client._client.headers["authorization"] == "Bearer my-token"
        assert str(client._client.base_url) == "http://localhost:9000"
