"""Shared test fixtures.

Pytest auto-discovers ``conftest.py`` and makes anything declared with
``@pytest.fixture`` here available to every test under ``tests/`` (and
its subpackages) by name. No imports are needed in the test modules
themselves - they just request the fixture as a parameter.
"""

import pytest


def _configured_scripts_dir(key):
    """Resolve a game ``Content/Scripts`` directory from the local
    ``config.toml`` (the same source the extraction pipeline reads), skipping
    the requesting test when no config is present or the configured directory
    doesn't exist on this machine. Avoids hard-coding an install path (e.g.
    ``C:/Program Files .../Hades II``) that is wrong on any machine whose game
    lives on another drive, which would otherwise skip live-data tests even
    though the install is present.
    """
    from src.config import load_config, ConfigError

    try:
        cfg = load_config(validate_paths=False)
    except ConfigError:
        pytest.skip("No local config.toml - game scripts path unavailable")
    path = getattr(cfg, key)
    if not path.exists():
        pytest.skip(f"Configured {key} not present on this machine: {path}")
    return path


@pytest.fixture(scope="session")
def hades2_scripts():
    """The configured Hades II ``Content/Scripts`` directory (or skip)."""
    return _configured_scripts_dir("hades2_scripts")


@pytest.fixture(scope="session")
def hades1_scripts():
    """The configured Hades 1 ``Content/Scripts`` directory (or skip)."""
    return _configured_scripts_dir("hades1_scripts")


@pytest.fixture
def make_graph_data():
    """Factory for the minimal merged-graph dict shape that the
    ``build_viewer.annotate_*`` audit/annotation steps consume.

    All fields default to empty so each test only specifies what it
    actually cares about::

        gd = make_graph_data(textlines={"A": {...}})
        gd = make_graph_data(unresolved=["MissingRef"])
        gd = make_graph_data()  # all empty

    ``totalTextlines`` is derived from the supplied ``textlines`` map
    so individual tests don't need to keep the count in sync.

    Returned as a fresh dict on each call, so tests can mutate the
    result in place without leaking between cases.
    """
    def _factory(textlines=None, unresolved=None, speakers=None, total_speakers=0):
        tl = textlines or {}
        return {
            "textlines": tl,
            "dependents": {},
            "speakers": speakers or {},
            "stats": {
                "totalSpeakers": total_speakers,
                "totalTextlines": len(tl),
                "totalEdges": 0,
                "unresolvedRefs": sorted(unresolved or []),
                "duplicates": [],
            },
        }
    return _factory
