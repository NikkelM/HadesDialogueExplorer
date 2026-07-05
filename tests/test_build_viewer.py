"""Unit tests for the split-build head augmentation
(``build_viewer._build_split_index_html``) and the ``viewer_bundle`` JS
bundler / source-map module (both split out of ``build_viewer`` for #141)."""

import json
import sys
from html import escape as html_escape
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import viewer_bundle
from build_viewer import DEPLOY_BASE_URL, OG_IMAGE_NAME, SEO_DESCRIPTION, _build_split_index_html


# --- split-build head augmentation --------------------------------------

def test_head_cache_busts_asset_refs():
    html = _build_split_index_html("abc123")
    assert 'href="viewer.css?v=abc123"' in html
    assert 'src="viewer.js?v=abc123"' in html
    assert '<meta name="viewer-version" content="abc123">' in html


def test_head_injects_csp_allowing_cloudflare_beacon():
    html = _build_split_index_html("v")
    assert 'http-equiv="Content-Security-Policy"' in html
    assert "static.cloudflareinsights.com" in html
    assert "connect-src 'self' https://cloudflareinsights.com" in html


def test_head_injects_tool_specific_seo_and_social_tags():
    page = _build_split_index_html("v")
    desc = html_escape(SEO_DESCRIPTION)
    assert f'<meta name="description" content="{desc}">' in page
    assert '<meta property="og:title" content="Hades Dialogue Explorer">' in page
    assert f'<meta property="og:description" content="{desc}">' in page
    assert '<meta name="twitter:card" content="summary_large_image">' in page


def test_head_escapes_ampersand_in_meta_text():
    # A raw ``&`` in an HTML attribute is invalid and can trip OG scrapers;
    # "Hades & Hades II" must be emitted as "Hades &amp; Hades II".
    page = _build_split_index_html("v")
    assert "Hades &amp; Hades II" in page
    assert "Hades & Hades II" not in page


def test_head_og_image_url_is_absolute():
    html = _build_split_index_html("v")
    expected = DEPLOY_BASE_URL + OG_IMAGE_NAME
    assert expected.startswith("https://")
    assert f'<meta property="og:image" content="{expected}">' in html
    assert f'<meta name="twitter:image" content="{expected}">' in html


def test_head_omits_worker_owned_tags_to_avoid_duplicates():
    # canonical / og:url / og:type / og:site_name are injected by the nikkelm.dev
    # Worker (inject-if-absent), so the page must NOT emit them - see #141.
    html = _build_split_index_html("v")
    assert 'rel="canonical"' not in html
    assert 'property="og:url"' not in html
    assert 'property="og:type"' not in html
    assert 'property="og:site_name"' not in html


# --- viewer_bundle: JS assembly + source map ----------------------------

def test_build_js_matches_assembly_and_pins_boot_last():
    js_text, _blocks = viewer_bundle.assemble_viewer_js()
    # build_js() is the thin wrapper; both must agree byte-for-byte.
    assert js_text == viewer_bundle.build_js()
    assert js_text.endswith("\n")
    # init.js is pinned last, and its trailing top-level call must survive.
    assert js_text.rstrip().endswith("boot();")


def test_source_map_is_valid_v3_with_posix_sources():
    js_text, blocks = viewer_bundle.assemble_viewer_js()
    sm = json.loads(viewer_bundle.build_source_map(js_text, blocks, "viewer.js"))
    assert sm["version"] == 3
    assert sm["file"] == "viewer.js"
    assert len(sm["sources"]) == len(sm["sourcesContent"]) == len(blocks)
    assert sm["mappings"]
    # Source paths must be POSIX (forward slashes) or browsers/devtools can't
    # resolve them; and they should be repo-relative to the viewer module dir.
    assert all("\\" not in src for src in sm["sources"])
    assert all(src.startswith("templates/viewer/") for src in sm["sources"])
