"""Tests for the credential provider chain."""

from __future__ import annotations

import os
from unittest.mock import patch, MagicMock

import pytest

from mitsein_cli.core.credentials import (
    Credentials,
    DevTokenProvider,
    EnvProvider,
    ExplicitFlagProvider,
    resolve_credentials,
)
from mitsein_cli.core.errors import NoCredentialsError


class TestExplicitFlagProvider:
    def test_returns_credentials_when_token_given(self):
        p = ExplicitFlagProvider(token="my-token", endpoint="http://example.com")
        creds = p.load()
        assert creds is not None
        assert creds.token == "my-token"
        assert creds.endpoint == "http://example.com"

    def test_uses_default_endpoint_when_not_given(self):
        p = ExplicitFlagProvider(token="my-token")
        creds = p.load()
        assert creds is not None
        assert creds.endpoint == "http://localhost:8900"

    def test_returns_none_when_no_token(self):
        p = ExplicitFlagProvider()
        assert p.load() is None


class TestEnvProvider:
    def test_returns_credentials_from_env(self):
        with patch.dict(os.environ, {"MITSEIN_TOKEN": "env-token", "MITSEIN_API_URL": "http://env.example.com"}):
            p = EnvProvider()
            creds = p.load()
            assert creds is not None
            assert creds.token == "env-token"
            assert creds.endpoint == "http://env.example.com"

    def test_uses_default_endpoint_when_url_not_set(self):
        env = {"MITSEIN_TOKEN": "env-token"}
        with patch.dict(os.environ, env, clear=False):
            # Remove MITSEIN_API_URL if present
            os.environ.pop("MITSEIN_API_URL", None)
            p = EnvProvider()
            creds = p.load()
            assert creds is not None
            assert creds.endpoint == "http://localhost:8900"

    def test_returns_none_when_no_token(self):
        with patch.dict(os.environ, {}, clear=True):
            p = EnvProvider()
            assert p.load() is None


class TestDevTokenProvider:
    def test_is_localhost_positive(self):
        for host in ["http://localhost:8900", "http://127.0.0.1:8900", "http://[::1]:8900"]:
            assert DevTokenProvider._is_localhost(host) is True

    def test_is_localhost_negative(self):
        for host in ["http://staging.example.com", "https://prod.mitsein.io", "http://10.0.0.1:8900"]:
            assert DevTokenProvider._is_localhost(host) is False

    def test_returns_none_for_non_localhost(self):
        p = DevTokenProvider(endpoint="http://staging.example.com")
        assert p.load() is None

    def test_returns_none_when_no_script_found(self):
        p = DevTokenProvider(endpoint="http://localhost:8900", project_root="/nonexistent")
        assert p.load() is None


class TestResolveCredentials:
    def test_explicit_flag_wins(self):
        with patch.dict(os.environ, {"MITSEIN_TOKEN": "env-token"}):
            creds = resolve_credentials(token="explicit-token")
            assert creds.token == "explicit-token"

    def test_env_used_when_no_explicit(self):
        with patch.dict(os.environ, {"MITSEIN_TOKEN": "env-token"}, clear=False):
            creds = resolve_credentials()
            assert creds.token == "env-token"

    def test_raises_when_no_credentials(self):
        with patch.dict(os.environ, {}, clear=True):
            with pytest.raises(NoCredentialsError):
                resolve_credentials(token=None, endpoint="http://remote.example.com")

    def test_chain_order_explicit_first(self):
        """ExplicitFlag should be checked before Env."""
        with patch.dict(os.environ, {"MITSEIN_TOKEN": "env-token"}):
            creds = resolve_credentials(token="flag-token")
            assert creds.token == "flag-token"
