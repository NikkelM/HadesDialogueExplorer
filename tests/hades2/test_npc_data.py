"""Tests for the H2 NPC data extractor.

Covers the discovery contract of :func:`.npc_data.extract_npc_data`:

* Discovers ``UnitSetData.NPC_<Char>`` top-level keys (per-character
  files) AND ``UnitSetData.NPCs`` (master file - matches H1's plural
  container name to handle the protagonist + template entries).
* Iterates every owner inside the container; multiple owners per
  file are surfaced (e.g. ``NPC_Artemis_01`` + ``NPC_Artemis_Field_01``).
* Owners with zero non-empty sections are dropped so templates
  (``NPC_Neutral`` / ``NPC_Giftable``) and empty stubs don't pollute
  the speaker list.
* The output dict shape mirrors H1's
  :func:`src.extractors.hades1.npc_data.extract_npc_data` so the
  merge / build pipeline consumes both games uniformly.
* The dialogue extraction is delegated to the H2 textline-set walker
  (covered in :mod:`tests.hades2.test_textline_set`), so these tests
  focus on the discovery / owner-entry-assembly layer.
"""

from src.lua_parser import LuaParser
from src.extractors.hades2.npc_data import extract_npc_data


def _parse(lua_text):
    return LuaParser(lua_text).parse_file()


class TestDiscovery:
    def test_per_character_container_discovered(self):
        parsed = _parse("""
            UnitSetData.NPC_Artemis = {
                NPC_Artemis_01 = {
                    InteractTextLineSets = {
                        Foo = { { Cue = "/VO/X_0001", Text = "Hi." } },
                    },
                },
            }
        """)
        owners = extract_npc_data(parsed, source_label="Hades 2", source_file="NPCData_Artemis.lua")
        assert "NPC_Artemis_01" in owners
        assert owners["NPC_Artemis_01"]["source"] == "Hades 2"

    def test_master_npcs_container_discovered(self):
        # H1-style plural ``UnitSetData.NPCs`` is used by the H2
        # master NPCData.lua for the protagonist + templates.
        parsed = _parse("""
            UnitSetData.NPCs = {
                NPC_Melinoe_Story_01 = {
                    InteractTextLineSets = {
                        Foo = { { Cue = "/VO/X_0001", Text = "Hi." } },
                    },
                },
            }
        """)
        owners = extract_npc_data(parsed, source_label="Hades 2", source_file="NPCData.lua")
        assert "NPC_Melinoe_Story_01" in owners

    def test_multiple_owners_per_container(self):
        parsed = _parse("""
            UnitSetData.NPC_Artemis = {
                NPC_Artemis_01 = {
                    InteractTextLineSets = {
                        Hub01 = { { Cue = "/VO/X_0001", Text = "Hi." } },
                    },
                },
                NPC_Artemis_Field_01 = {
                    InteractTextLineSets = {
                        Field01 = { { Cue = "/VO/X_0002", Text = "Hi." } },
                    },
                },
            }
        """)
        owners = extract_npc_data(parsed, source_label="Hades 2", source_file="NPCData_Artemis.lua")
        assert set(owners.keys()) == {"NPC_Artemis_01", "NPC_Artemis_Field_01"}

    def test_unrelated_top_level_keys_ignored(self):
        # ``GlobalVoiceLines.*`` is the per-character file's other top-level
        # category and must not be picked up as an owner container.
        parsed = _parse("""
            UnitSetData.NPC_Artemis = {
                NPC_Artemis_01 = {
                    InteractTextLineSets = {
                        Foo = { { Cue = "/VO/X_0001", Text = "Hi." } },
                    },
                },
            }
            GlobalVoiceLines.ArtemisGatherReactionVoiceLines = {
                NPC_Artemis_01 = { },
            }
        """)
        owners = extract_npc_data(parsed, source_label="Hades 2", source_file="NPCData_Artemis.lua")
        assert set(owners.keys()) == {"NPC_Artemis_01"}

    def test_empty_owner_dropped(self):
        # An entry with no non-empty section is filtered out - matches
        # H1's behaviour for inherited stubs.
        parsed = _parse("""
            UnitSetData.NPC_Stub = {
                NPC_Stub_01 = {
                    InheritFrom = { "NPC_Neutral" },
                },
            }
        """)
        owners = extract_npc_data(parsed, source_label="Hades 2", source_file="NPCData_Stub.lua")
        assert owners == {}

    def test_section_with_empty_dict_dropped(self):
        # An owner whose only section is an empty dict still counts as
        # "no real sections"; we want it dropped too.
        parsed = _parse("""
            UnitSetData.NPC_Stub = {
                NPC_Stub_01 = {
                    InteractTextLineSets = { },
                },
            }
        """)
        owners = extract_npc_data(parsed, source_label="Hades 2", source_file="NPCData_Stub.lua")
        assert owners == {}


class TestSectionPropagation:
    def test_multiple_section_keys_extracted(self):
        parsed = _parse("""
            UnitSetData.NPC_Artemis = {
                NPC_Artemis_01 = {
                    InteractTextLineSets = {
                        Interact01 = { { Cue = "/VO/X_0001", Text = "Hi." } },
                    },
                    GiftTextLineSets = {
                        Gift01 = { { Cue = "/VO/X_0002", Text = "Thanks." } },
                    },
                },
            }
        """)
        owners = extract_npc_data(parsed, source_label="Hades 2", source_file="NPCData_Artemis.lua")
        entry = owners["NPC_Artemis_01"]
        assert "InteractTextLineSets" in entry
        assert "GiftTextLineSets" in entry
        assert "Interact01" in entry["InteractTextLineSets"]
        assert "Gift01" in entry["GiftTextLineSets"]

    def test_owner_id_used_as_default_speaker(self):
        parsed = _parse("""
            UnitSetData.NPC_Artemis = {
                NPC_Artemis_01 = {
                    InteractTextLineSets = {
                        Foo = { { Cue = "/VO/X_0001", Text = "Hi." } },
                    },
                },
            }
        """)
        owners = extract_npc_data(parsed, source_label="Hades 2", source_file="NPCData_Artemis.lua")
        line = owners["NPC_Artemis_01"]["InteractTextLineSets"]["Foo"]["dialogueLines"][0]
        assert line["speaker"] == "NPC_Artemis_01"

    def test_source_label_attached(self):
        parsed = _parse("""
            UnitSetData.NPC_Artemis = {
                NPC_Artemis_01 = {
                    InteractTextLineSets = {
                        Foo = { { Cue = "/VO/X_0001", Text = "Hi." } },
                    },
                },
            }
        """)
        owners = extract_npc_data(parsed, source_label="Hades 2", source_file="NPCData_Artemis.lua")
        assert owners["NPC_Artemis_01"]["source"] == "Hades 2"


class TestRequirementsIntegration:
    def test_named_requirements_registry_passed_through(self):
        # The registry is forwarded to the textline walker so inline
        # expansion picks up textline edges from the named req.
        parsed = _parse("""
            UnitSetData.NPC_Artemis = {
                NPC_Artemis_01 = {
                    InteractTextLineSets = {
                        Foo = {
                            GameStateRequirements = {
                                NamedRequirements = { "FooDone" },
                            },
                            { Cue = "/VO/X_0001", Text = "Hi." },
                        },
                    },
                },
            }
        """)
        registry_lua = """N = {
            FooDone = {
                { Path = { "GameState", "TextLinesRecord" }, HasAll = { "FooLine" } },
            },
        }"""
        registry_table = LuaParser(registry_lua).parse_file()["N"]
        registry = {"FooDone": registry_table.named["FooDone"]}
        owners = extract_npc_data(
            parsed, source_label="Hades 2", source_file="NPCData_Artemis.lua",
            named_requirements=registry,
        )
        reqs = owners["NPC_Artemis_01"]["InteractTextLineSets"]["Foo"]["requirements"]
        assert reqs == {"RequiredTextLines": ["FooLine"]}


class TestVariantSetData:
    """``VariantSetData.NPC_<Char>_01.<Variant>.<Section>.<Name>`` entries
    are walked in a second pass and merged into the genus owner (derived
    from the container key, e.g. ``NPC_Heracles_01``)."""

    def test_variant_textlines_merged_onto_genus_owner(self):
        parsed = _parse("""
            VariantSetData.NPC_Heracles_01 = {
                HeraclesShopping = {
                    InteractTextLineSets = {
                        HeraclesMiscChat01 = { { Cue = "/VO/X_0001", Text = "Hi." } },
                    },
                },
            }
        """)
        owners = extract_npc_data(parsed, source_label="Hades 2", source_file="NPCData_Heracles.lua")
        assert "NPC_Heracles_01" in owners
        assert "HeraclesMiscChat01" in owners["NPC_Heracles_01"]["InteractTextLineSets"]

    def test_variant_merges_with_existing_unit_set_data_owner(self):
        parsed = _parse("""
            UnitSetData.NPC_Heracles = {
                NPC_Heracles_01 = {
                    InteractTextLineSets = {
                        HeraclesBaseLine = { { Cue = "/VO/X_0001", Text = "Hi." } },
                    },
                },
            }
            VariantSetData.NPC_Heracles_01 = {
                HeraclesShopping = {
                    InteractTextLineSets = {
                        HeraclesMiscChat01 = { { Cue = "/VO/X_0002", Text = "Shop." } },
                    },
                },
            }
        """)
        owners = extract_npc_data(parsed, source_label="Hades 2", source_file="NPCData_Heracles.lua")
        section = owners["NPC_Heracles_01"]["InteractTextLineSets"]
        # Both UnitSetData and VariantSetData textlines present on the same owner.
        assert "HeraclesBaseLine" in section
        assert "HeraclesMiscChat01" in section

    def test_unit_set_data_wins_on_textline_name_collision(self):
        # UnitSetData runs first. ``setdefault`` keeps the existing entry
        # so the variant value does NOT clobber the canonical definition.
        parsed = _parse("""
            UnitSetData.NPC_Heracles = {
                NPC_Heracles_01 = {
                    InteractTextLineSets = {
                        HeraclesShared = { { Cue = "/VO/X_0001", Text = "Canonical." } },
                    },
                },
            }
            VariantSetData.NPC_Heracles_01 = {
                HeraclesShopping = {
                    InteractTextLineSets = {
                        HeraclesShared = { { Cue = "/VO/X_0002", Text = "Variant." } },
                    },
                },
            }
        """)
        owners = extract_npc_data(parsed, source_label="Hades 2", source_file="NPCData_Heracles.lua")
        dialogue = owners["NPC_Heracles_01"]["InteractTextLineSets"]["HeraclesShared"]["dialogueLines"]
        assert dialogue[0]["text"] == "Canonical."

    def test_variant_container_level_fields_skipped(self):
        # ``GameStateRequirements`` / ``Cooldowns`` / ``ObjectType`` are
        # container-level metadata, not context-variant entries; they
        # must NOT show up as variants.
        parsed = _parse("""
            VariantSetData.NPC_Heracles_01 = {
                GameStateRequirements = {
                    { Path = { "GameState", "TextLinesRecord" }, HasAny = { "X" } },
                },
                Cooldowns = { Default = 5 },
                ObjectType = "NPC",
                HeraclesShopping = {
                    InteractTextLineSets = {
                        HeraclesMiscChat01 = { { Cue = "/VO/X_0001", Text = "Hi." } },
                    },
                },
            }
        """)
        owners = extract_npc_data(parsed, source_label="Hades 2", source_file="NPCData_Heracles.lua")
        section = owners["NPC_Heracles_01"]["InteractTextLineSets"]
        assert list(section.keys()) == ["HeraclesMiscChat01"]

    def test_variant_with_no_textline_sections_skipped(self):
        # A variant entry that carries only Cooldowns / GSR (no textline
        # sections) must NOT create the genus owner.
        parsed = _parse("""
            VariantSetData.NPC_Heracles_01 = {
                HeraclesBathHouse = {
                    Cooldowns = { Default = 5 },
                },
            }
        """)
        owners = extract_npc_data(parsed, source_label="Hades 2", source_file="NPCData_Heracles.lua")
        assert owners == {}

    def test_multiple_variants_merge_in_order(self):
        # First variant declares HeraclesShared; second variant tries to
        # redeclare it. First wins (setdefault).
        parsed = _parse("""
            VariantSetData.NPC_Heracles_01 = {
                HeraclesShopping = {
                    InteractTextLineSets = {
                        HeraclesShared = { { Cue = "/VO/X_0001", Text = "Shop." } },
                    },
                },
                HeraclesBathHouse = {
                    InteractTextLineSets = {
                        HeraclesShared = { { Cue = "/VO/X_0002", Text = "Bath." } },
                    },
                },
            }
        """)
        owners = extract_npc_data(parsed, source_label="Hades 2", source_file="NPCData_Heracles.lua")
        dialogue = owners["NPC_Heracles_01"]["InteractTextLineSets"]["HeraclesShared"]["dialogueLines"]
        # The "first wins on collision" rule is the per-section
        # ``setdefault`` semantics; both Shopping and BathHouse map to
        # genus NPC_Heracles_01 here.
        assert dialogue[0]["text"] in {"Shop.", "Bath."}
        # Exactly one entry kept regardless of declaration order.
        assert len(owners["NPC_Heracles_01"]["InteractTextLineSets"]) == 1
