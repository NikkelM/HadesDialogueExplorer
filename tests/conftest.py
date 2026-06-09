"""Shared test fixtures.

Pytest auto-discovers ``conftest.py`` and makes anything declared with
``@pytest.fixture`` here available to every test under ``tests/`` (and
its subpackages) by name. No imports are needed in the test modules
themselves - they just request the fixture as a parameter.
"""

import pytest


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
