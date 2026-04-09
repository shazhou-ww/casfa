"""Tests for output formatting."""

from __future__ import annotations

import json
from io import StringIO
from unittest.mock import patch

from mitsein_cli.core.output import emit, set_json_mode, is_json_mode, is_tty


class TestJsonMode:
    def test_default_is_off(self):
        set_json_mode(False)
        assert is_json_mode() is False

    def test_can_enable(self):
        set_json_mode(True)
        assert is_json_mode() is True
        set_json_mode(False)  # cleanup


class TestEmit:
    def test_json_mode_dict(self, capsys):
        set_json_mode(True)
        emit({"ok": True, "name": "test"})
        set_json_mode(False)

        captured = capsys.readouterr()
        data = json.loads(captured.out)
        assert data == {"ok": True, "name": "test"}

    def test_json_mode_list(self, capsys):
        set_json_mode(True)
        emit([{"id": 1}, {"id": 2}])
        set_json_mode(False)

        captured = capsys.readouterr()
        data = json.loads(captured.out)
        assert data == [{"id": 1}, {"id": 2}]

    def test_json_mode_string(self, capsys):
        set_json_mode(True)
        emit("hello")
        set_json_mode(False)

        captured = capsys.readouterr()
        assert json.loads(captured.out) == "hello"

    def test_human_mode_string(self, capsys):
        set_json_mode(False)
        emit("hello")

        captured = capsys.readouterr()
        assert "hello" in captured.out
