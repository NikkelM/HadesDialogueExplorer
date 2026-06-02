"""Tests for src.config (local user configuration loader)."""

from pathlib import Path

import pytest

from src.config import Config, ConfigError, load_config


def _write(tmp_path: Path, content: str) -> Path:
    cfg = tmp_path / "config.toml"
    cfg.write_text(content, encoding="utf-8")
    return cfg


# --- Happy path ---


def test_loads_required_hades1_scripts(tmp_path: Path):
    scripts = tmp_path / "scripts"
    scripts.mkdir()
    cfg_path = _write(tmp_path, f'[paths]\nhades1_scripts = "{scripts.as_posix()}"\n')

    result = load_config(cfg_path)

    assert isinstance(result, Config)
    assert result.hades1_scripts == scripts
    assert result.hades2_scripts is None


def test_loads_optional_hades2_scripts(tmp_path: Path):
    scripts1 = tmp_path / "h1"
    scripts2 = tmp_path / "h2"
    scripts1.mkdir()
    scripts2.mkdir()
    cfg_path = _write(
        tmp_path,
        f'[paths]\n'
        f'hades1_scripts = "{scripts1.as_posix()}"\n'
        f'hades2_scripts = "{scripts2.as_posix()}"\n',
    )

    result = load_config(cfg_path)

    assert result.hades1_scripts == scripts1
    assert result.hades2_scripts == scripts2


def test_expands_user_home_in_paths(tmp_path: Path, monkeypatch):
    fake_home = tmp_path / "home"
    target = fake_home / "Games" / "Hades" / "Scripts"
    target.mkdir(parents=True)
    monkeypatch.setenv("HOME", str(fake_home))
    monkeypatch.setenv("USERPROFILE", str(fake_home))  # Windows

    cfg_path = _write(tmp_path, '[paths]\nhades1_scripts = "~/Games/Hades/Scripts"\n')

    result = load_config(cfg_path)

    assert result.hades1_scripts == target


def test_resolves_relative_paths_against_config_file_dir(tmp_path: Path):
    """Relative paths should resolve relative to the config file, not cwd."""
    nested = tmp_path / "subdir" / "scripts"
    nested.mkdir(parents=True)
    cfg_path = _write(tmp_path, '[paths]\nhades1_scripts = "subdir/scripts"\n')

    result = load_config(cfg_path)

    assert result.hades1_scripts == nested.resolve()


# --- Error path: file missing / malformed ---


def test_raises_when_config_file_missing(tmp_path: Path):
    missing = tmp_path / "does-not-exist.toml"
    with pytest.raises(ConfigError, match="not found"):
        load_config(missing)


def test_raises_with_example_hint_on_missing_file(tmp_path: Path):
    missing = tmp_path / "does-not-exist.toml"
    with pytest.raises(ConfigError, match="config.example.toml"):
        load_config(missing)


def test_raises_on_invalid_toml_syntax(tmp_path: Path):
    cfg_path = _write(tmp_path, '[paths\nhades1_scripts = broken\n')
    with pytest.raises(ConfigError, match="TOML"):
        load_config(cfg_path)


# --- Error path: missing/invalid keys ---


def test_raises_on_missing_paths_section(tmp_path: Path):
    cfg_path = _write(tmp_path, '[other]\nfoo = "bar"\n')
    with pytest.raises(ConfigError, match=r"\[paths\]"):
        load_config(cfg_path)


def test_raises_on_missing_hades1_scripts_key(tmp_path: Path):
    cfg_path = _write(tmp_path, '[paths]\nhades2_scripts = "/tmp"\n')
    with pytest.raises(ConfigError, match="hades1_scripts"):
        load_config(cfg_path, validate_paths=False)


def test_raises_on_non_string_value(tmp_path: Path):
    cfg_path = _write(tmp_path, '[paths]\nhades1_scripts = 123\n')
    with pytest.raises(ConfigError, match="must be a string"):
        load_config(cfg_path, validate_paths=False)


def test_raises_on_empty_string_value(tmp_path: Path):
    cfg_path = _write(tmp_path, '[paths]\nhades1_scripts = ""\n')
    with pytest.raises(ConfigError, match="non-empty"):
        load_config(cfg_path, validate_paths=False)


# --- Error path: path validation ---


def test_raises_when_hades1_path_does_not_exist(tmp_path: Path):
    cfg_path = _write(tmp_path, f'[paths]\nhades1_scripts = "{(tmp_path / "nope").as_posix()}"\n')
    with pytest.raises(ConfigError, match="does not exist"):
        load_config(cfg_path)


def test_raises_when_hades1_path_is_a_file(tmp_path: Path):
    not_a_dir = tmp_path / "scripts.lua"
    not_a_dir.write_text("", encoding="utf-8")
    cfg_path = _write(tmp_path, f'[paths]\nhades1_scripts = "{not_a_dir.as_posix()}"\n')
    with pytest.raises(ConfigError, match="must point at a directory"):
        load_config(cfg_path)


def test_raises_when_optional_hades2_path_invalid(tmp_path: Path):
    scripts1 = tmp_path / "h1"
    scripts1.mkdir()
    cfg_path = _write(
        tmp_path,
        f'[paths]\n'
        f'hades1_scripts = "{scripts1.as_posix()}"\n'
        f'hades2_scripts = "{(tmp_path / "nope").as_posix()}"\n',
    )
    with pytest.raises(ConfigError, match="hades2_scripts"):
        load_config(cfg_path)


# --- validate_paths=False escape hatch ---


def test_validate_paths_false_skips_filesystem_checks(tmp_path: Path):
    """Parse-only mode should accept non-existent paths."""
    cfg_path = _write(
        tmp_path,
        '[paths]\nhades1_scripts = "/definitely/does/not/exist"\n',
    )
    # Should NOT raise even though path doesn't exist.
    result = load_config(cfg_path, validate_paths=False)
    assert str(result.hades1_scripts).endswith("exist")


def test_validate_paths_is_keyword_only():
    """Guard against accidental positional booleans."""
    import inspect

    sig = inspect.signature(load_config)
    param = sig.parameters["validate_paths"]
    assert param.kind == inspect.Parameter.KEYWORD_ONLY
