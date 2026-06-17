"""Tests for the eligibility API's request-handling hardening: the stdlib
multipart parser (replacing the ``cgi`` module removed in Python 3.13),
save-path allow-listing, malformed-input handling, and CLI exit codes.

The valid-save (200) path needs a real ``.sav`` file and is not covered here;
these tests focus on the error / security paths, which need no fixture.
"""

import json

import pytest

import api


class TestSavePathAllowlist:
    def test_accepts_profile_filenames(self):
        assert api._is_allowed_save_path("Profile1.sav")
        assert api._is_allowed_save_path("/home/x/Profile4.sav")
        assert api._is_allowed_save_path("C:/saves/Profile2_Temp.sav")

    def test_rejects_non_save_files(self):
        assert not api._is_allowed_save_path("/etc/passwd")
        assert not api._is_allowed_save_path("C:/Windows/win.ini")
        assert not api._is_allowed_save_path("Profile9.sav")
        assert not api._is_allowed_save_path("")


def _multipart(fields):
    """Build a multipart/form-data body from ``{name: (filename|None, bytes)}``."""
    boundary = "TESTBOUNDARY123"
    parts = []
    for name, (filename, value) in fields.items():
        disp = f'form-data; name="{name}"'
        if filename is not None:
            disp += f'; filename="{filename}"'
        parts.append(
            f"--{boundary}\r\nContent-Disposition: {disp}\r\n\r\n".encode()
            + value
            + b"\r\n"
        )
    body = b"".join(parts) + f"--{boundary}--\r\n".encode()
    return f"multipart/form-data; boundary={boundary}", body


class TestMultipartParser:
    def test_parses_file_and_text_fields(self):
        ct, body = _multipart({
            "save": ("Profile1.sav", b"SGB1binarydata"),
            "dialogue": (None, b"OrpheusSingsAgain02"),
            "game": (None, b"hades1"),
        })
        fields = api._parse_multipart_form(ct, body)
        assert fields["save"] == b"SGB1binarydata"
        assert fields["dialogue"] == "OrpheusSingsAgain02"
        assert fields["game"] == "hades1"

    def test_preserves_binary_payload_ending_in_crlf(self):
        payload = b"\x00\x01\x02\r\n"
        ct, body = _multipart({"save": ("Profile1.sav", payload)})
        assert api._parse_multipart_form(ct, body)["save"] == payload

    def test_missing_boundary_raises(self):
        with pytest.raises(ValueError):
            api._parse_multipart_form("multipart/form-data", b"")


class TestHandleRequest:
    def test_malformed_json_returns_400(self):
        status, result = api._handle_eligibility_request(
            "application/json", b"{not json", {}
        )
        assert status == 400
        assert "error" in result

    def test_disallowed_save_path_returns_400_without_reading(self):
        status, result = api._handle_eligibility_request(
            "application/json",
            json.dumps({"savePath": "/etc/passwd", "dialogue": "X"}).encode(),
            {},
        )
        assert status == 400
        assert "ProfileN.sav" in result["error"]

    def test_unsupported_content_type_returns_415(self):
        status, _ = api._handle_eligibility_request("text/plain", b"hi", {})
        assert status == 415

    def test_missing_save_field_returns_400(self):
        ct, body = _multipart({"dialogue": (None, b"X")})
        status, _ = api._handle_eligibility_request(ct, body, {})
        assert status == 400

    def test_invalid_save_bytes_returns_generic_400(self):
        # An allowed-but-bogus save -> generic message, no echoed file bytes.
        ct, body = _multipart({
            "save": ("Profile1.sav", b"not a real save"),
            "dialogue": (None, b"X"),
        })
        status, result = api._handle_eligibility_request(ct, body, {})
        assert status == 400
        assert result["error"] == "Not a valid Hades save file"


class TestCliExitCodes:
    def test_missing_save_file_exits_nonzero(self, capsys):
        args = type(
            "Args", (), {"save_file": "no_such_dir/Profile1.sav", "dialogue": "X", "game": None}
        )()
        with pytest.raises(SystemExit) as exc:
            api.run_cli(args)
        assert exc.value.code == 1
        assert "error" in capsys.readouterr().out
