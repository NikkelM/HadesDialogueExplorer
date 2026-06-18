"""Local user configuration loader for HadesDialogueExplorer.

Reads ``config.toml`` from the repo root (or an explicit path passed in for
tests) and returns a typed :class:`Config` describing the user's local game
script directories. Errors are normalised to :class:`ConfigError` with a
message that points the user at the checked-in ``config.example.toml``
template, so a missing or misconfigured config never surfaces as a raw
``FileNotFoundError`` / ``TOMLDecodeError`` / ``KeyError``.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional

try:
    import tomllib  # Python 3.11+
except ModuleNotFoundError:  # pragma: no cover - fallback for 3.8 - 3.10
    import tomli as tomllib  # type: ignore[import-not-found, no-redef]

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG_PATH = PROJECT_ROOT / "config.toml"
EXAMPLE_CONFIG_PATH = PROJECT_ROOT / "config.example.toml"


class ConfigError(Exception):
    """Raised when the local config file is missing, malformed, or invalid."""


@dataclass(frozen=True)
class Config:
    """Resolved local configuration.

    All paths are absolute and have already been expanded (``~`` resolved
    against the user's home directory, relative paths resolved against the
    directory containing the config file).
    """

    hades1_scripts: Path
    hades2_scripts: Path


def _example_hint() -> str:
    return (
        f"See {EXAMPLE_CONFIG_PATH.name} in the repo root for the expected "
        f"format; copy it to {DEFAULT_CONFIG_PATH.name} and edit the paths."
    )


def _resolve_path(raw: str, config_dir: Path) -> Path:
    """Expand ``~`` and resolve relative paths against the config file dir.

    Resolving against the config file (rather than the process cwd) means
    ``python path/to/generate_data.py`` behaves the same regardless of where
    it's invoked from.
    """
    p = Path(raw).expanduser()
    if not p.is_absolute():
        p = (config_dir / p).resolve()
    return p


def _require_dir(path: Path, key: str, config_path: Path) -> None:
    if not path.exists():
        raise ConfigError(
            f"{config_path.name}: '{key}' points at a path that does not exist: {path}\n"
            f"{_example_hint()}"
        )
    if not path.is_dir():
        raise ConfigError(
            f"{config_path.name}: '{key}' must point at a directory, not a file: {path}\n"
            f"{_example_hint()}"
        )


def _require_string(value: object, key: str, config_path: Path) -> str:
    if not isinstance(value, str):
        raise ConfigError(
            f"{config_path.name}: '{key}' must be a string, got {type(value).__name__}.\n"
            f"{_example_hint()}"
        )
    if not value.strip():
        raise ConfigError(
            f"{config_path.name}: '{key}' must be a non-empty string.\n"
            f"{_example_hint()}"
        )
    return value


def load_config(
    config_path: Optional[Path] = None,
    *,
    validate_paths: bool = True,
) -> Config:
    """Load and validate the local configuration.

    Args:
        config_path: Path to the TOML file. Defaults to ``<repo>/config.toml``.
        validate_paths: When True (the default), each configured directory
            must exist and be a directory. Set False to parse the file
            without filesystem checks (useful in tests).

    Raises:
        ConfigError: If the file is missing, malformed, missing required
            keys, or (when ``validate_paths`` is True) any configured path
            does not resolve to a directory.
    """
    path = (config_path or DEFAULT_CONFIG_PATH).resolve()

    if not path.exists():
        raise ConfigError(
            f"Config file not found: {path}\n{_example_hint()}"
        )

    try:
        with open(path, "rb") as f:
            raw = tomllib.load(f)
    except tomllib.TOMLDecodeError as e:
        raise ConfigError(
            f"Could not parse {path.name} as TOML: {e}\n{_example_hint()}"
        ) from e

    paths_section = raw.get("paths")
    if not isinstance(paths_section, dict):
        raise ConfigError(
            f"{path.name}: missing required '[paths]' section.\n{_example_hint()}"
        )

    resolved = {}
    for key in ("hades1_scripts", "hades2_scripts"):
        if key not in paths_section:
            raise ConfigError(
                f"{path.name}: missing required key 'paths.{key}'.\n{_example_hint()}"
            )
        raw_value = _require_string(paths_section[key], f"paths.{key}", path)
        resolved[key] = _resolve_path(raw_value, path.parent)

    if validate_paths:
        for key, directory in resolved.items():
            _require_dir(directory, f"paths.{key}", path)

    return Config(
        hades1_scripts=resolved["hades1_scripts"],
        hades2_scripts=resolved["hades2_scripts"],
    )
