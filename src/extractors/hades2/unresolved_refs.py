"""
Hardcoded categorisation of Hades II textline references that are present
in the source data but have no matching definition reachable by the
current set of H2 extractors.

The pipeline (``build_viewer.py``) audits this list against the set of
refs that the parser computed as unresolved. Drift in either direction
prints a warning:
  - An entry here that the parser already resolves -> remove it (likely
    fixed by a recent extractor change, e.g. the ``h2-npc-inherit-variants``
    walker landing for the ``extractor-deferred`` entries).
  - An unresolved ref the parser found that isn't in this list -> triage
    and add it with a category and brief reason.

Categories (the viewer renders these with distinct colours and an inline
explanation):

  cut-content
      The referenced textline was planned but never made it into the
      final game data. May appear in negative ``PathFalse`` /
      ``HasNone`` requirements (harmless - the requirement is trivially
      satisfied) or in positive ``HasAll`` / ``HasAny`` requirements
      (the referencing textline can therefore never play).

  extractor-deferred
      The referenced textline IS defined in the H2 source, but inside
      a container that the current extractor set does not walk yet.
      In H2 this overwhelmingly means ``VariantSetData.NPC_<Char>_01.*``
      -- the per-character variant subtrees that the NPC walker
      (which only enters ``UnitSetData.NPC_<Char>`` containers) skips.
      These will resolve automatically when the ``h2-npc-inherit-variants``
      walker lands and the audit will flag the entries here as stale.
"""

HADES2_KNOWN_UNRESOLVED_REFS = {
    # --- cut-content (8) ---
    "ChronosBossPreTrueEndingOutro01": {
        "category": "cut-content",
        "reason": "Cut textline; referenced only as a defensive PathFalse "
                  "check on GameState.TextLinesRecord in EnemyData_Chronos.lua "
                  "(trivially satisfied).",
    },
    "ChronosBossPreTrueEndingOutro01_B": {
        "category": "cut-content",
        "reason": "Cut _B variant; referenced only as a defensive PathFalse "
                  "check on GameState.TextLinesRecord in EnemyData_Chronos.lua "
                  "(trivially satisfied).",
    },
    "ChronosBossSuit01": {
        "category": "cut-content",
        "reason": "Cut textline; referenced only as a defensive PathFalse "
                  "check on GameState.TextLinesRecord in EnemyData_Chronos.lua "
                  "(trivially satisfied).",
    },
    "ErisAboutShrine01": {
        "category": "cut-content",
        "reason": "Cut textline; referenced only as a defensive PathFalse "
                  "check on GameState.TextLinesRecord in EnemyData_Eris.lua "
                  "(trivially satisfied).",
    },
    "ErisAboutShrine02": {
        "category": "cut-content",
        "reason": "Cut textline; referenced only as a defensive PathFalse "
                  "check on GameState.TextLinesRecord in EnemyData_Eris.lua "
                  "(trivially satisfied).",
    },
    "ErisAboutShrine03": {
        "category": "cut-content",
        "reason": "Cut textline; referenced only as a defensive PathFalse "
                  "check on GameState.TextLinesRecord in EnemyData_Eris.lua "
                  "(trivially satisfied).",
    },
    "MedeaHubMeeting01": {
        "category": "cut-content",
        "reason": "Required by MedeaHubMeeting02's GameStateRequirements "
                  "(HasAll on GameState.TextLinesRecord alongside MedeaGift04 "
                  "and ZeusPalacePostTrueEnding01); cut, so MedeaHubMeeting02 "
                  "can never play.",
    },
    "TyphonHeadAltFight01": {
        "category": "cut-content",
        "reason": "Referenced as a defensive PathFalse check in "
                  "EnemyData_TyphonHead.lua and as one option in a HasAny "
                  "(alongside ChronosBossAboutAltFight01) in "
                  "WorldUpgradeData.lua; cut, so the HasAny falls back to "
                  "the surviving option only.",
    },

    # --- extractor-deferred: VariantSetData.NPC_Eris_01 (1) ---
    "ErisGrantsCurse01": {
        "category": "extractor-deferred",
        "reason": "Defined in NPCData_Eris.lua under "
                  "VariantSetData.NPC_Eris_01.ErisCurseGiver.InteractTextLineSets; "
                  "the H2 NPC walker only enters UnitSetData.NPC_<Char> "
                  "containers. Will resolve once h2-npc-inherit-variants "
                  "lands.",
    },

    # --- extractor-deferred: VariantSetData.NPC_Heracles_01 (2) ---
    "HeraclesMiscChat01": {
        "category": "extractor-deferred",
        "reason": "Defined in NPCData_Heracles.lua under "
                  "VariantSetData.NPC_Heracles_01.HeraclesShopping.InteractTextLineSets; "
                  "the H2 NPC walker only enters UnitSetData.NPC_<Char> "
                  "containers. Will resolve once h2-npc-inherit-variants "
                  "lands.",
    },
    "HeraclesMiscChat08": {
        "category": "extractor-deferred",
        "reason": "Defined in NPCData_Heracles.lua under "
                  "VariantSetData.NPC_Heracles_01.HeraclesShopping.InteractTextLineSets; "
                  "the H2 NPC walker only enters UnitSetData.NPC_<Char> "
                  "containers. Will resolve once h2-npc-inherit-variants "
                  "lands.",
    },

    # --- extractor-deferred: VariantSetData.NPC_Icarus_01 (7) ---
    "IcarusBecomingCloser01": {
        "category": "extractor-deferred",
        "reason": "Defined in NPCData_Icarus.lua under "
                  "VariantSetData.NPC_Icarus_01.IcarusHome.InteractTextLineSets; "
                  "the H2 NPC walker only enters UnitSetData.NPC_<Char> "
                  "containers. Will resolve once h2-npc-inherit-variants "
                  "lands.",
    },
    "IcarusHomeAboutFlying01": {
        "category": "extractor-deferred",
        "reason": "Defined in NPCData_Icarus.lua under "
                  "VariantSetData.NPC_Icarus_01.IcarusHome.InteractTextLineSets; "
                  "the H2 NPC walker only enters UnitSetData.NPC_<Char> "
                  "containers. Will resolve once h2-npc-inherit-variants "
                  "lands.",
    },
    "IcarusHomeAboutFlying01_B": {
        "category": "extractor-deferred",
        "reason": "Defined in NPCData_Icarus.lua under "
                  "VariantSetData.NPC_Icarus_01.IcarusHome.InteractTextLineSets; "
                  "the H2 NPC walker only enters UnitSetData.NPC_<Char> "
                  "containers. Will resolve once h2-npc-inherit-variants "
                  "lands.",
    },
    "IcarusHomeAboutMoros01": {
        "category": "extractor-deferred",
        "reason": "Defined in NPCData_Icarus.lua under "
                  "VariantSetData.NPC_Icarus_01.IcarusHome.InteractTextLineSets; "
                  "the H2 NPC walker only enters UnitSetData.NPC_<Char> "
                  "containers. Will resolve once h2-npc-inherit-variants "
                  "lands.",
    },
    "IcarusHomeAboutMoros01_B": {
        "category": "extractor-deferred",
        "reason": "Defined in NPCData_Icarus.lua under "
                  "VariantSetData.NPC_Icarus_01.IcarusHome.InteractTextLineSets; "
                  "the H2 NPC walker only enters UnitSetData.NPC_<Char> "
                  "containers. Will resolve once h2-npc-inherit-variants "
                  "lands.",
    },
    "IcarusHomeFirstMeeting": {
        "category": "extractor-deferred",
        "reason": "Defined in NPCData_Icarus.lua under "
                  "VariantSetData.NPC_Icarus_01.IcarusHome.InteractTextLineSets; "
                  "the H2 NPC walker only enters UnitSetData.NPC_<Char> "
                  "containers. Will resolve once h2-npc-inherit-variants "
                  "lands.",
    },
    "IcarusHomePostTrueEnding01": {
        "category": "extractor-deferred",
        "reason": "Defined in NPCData_Icarus.lua under "
                  "VariantSetData.NPC_Icarus_01.IcarusHome.InteractTextLineSets; "
                  "the H2 NPC walker only enters UnitSetData.NPC_<Char> "
                  "containers. Will resolve once h2-npc-inherit-variants "
                  "lands.",
    },

    # --- extractor-deferred: VariantSetData.NPC_Nemesis_01 (18) ---
    "NemesisBuyItemIntro01": {
        "category": "extractor-deferred",
        "reason": "Defined in NPCData_Nemesis.lua under "
                  "VariantSetData.NPC_Nemesis_01.NemesisRandomEvent; the H2 "
                  "NPC walker only enters UnitSetData.NPC_<Char> containers. "
                  "Will resolve once h2-npc-inherit-variants lands.",
    },
    "NemesisCombatFirstIntro": {
        "category": "extractor-deferred",
        "reason": "Defined in NPCData_Nemesis.lua under "
                  "VariantSetData.NPC_Nemesis_01.NemesisCombat.CombatIntroTextLineSets; "
                  "the H2 NPC walker only enters UnitSetData.NPC_<Char> "
                  "containers. Will resolve once h2-npc-inherit-variants "
                  "lands.",
    },
    "NemesisDamageContestIntro01": {
        "category": "extractor-deferred",
        "reason": "Defined in NPCData_Nemesis.lua under "
                  "VariantSetData.NPC_Nemesis_01.NemesisRandomEvent; the H2 "
                  "NPC walker only enters UnitSetData.NPC_<Char> containers. "
                  "Will resolve once h2-npc-inherit-variants lands.",
    },
    "NemesisGetFreeItemIntro01": {
        "category": "extractor-deferred",
        "reason": "Defined in NPCData_Nemesis.lua under "
                  "VariantSetData.NPC_Nemesis_01.NemesisRandomEvent; the H2 "
                  "NPC walker only enters UnitSetData.NPC_<Char> containers. "
                  "Will resolve once h2-npc-inherit-variants lands.",
    },
    "NemesisGetFreeItemIntroBridge01": {
        "category": "extractor-deferred",
        "reason": "Defined in NPCData_Nemesis.lua under "
                  "VariantSetData.NPC_Nemesis_01.NemesisRandomEvent; the H2 "
                  "NPC walker only enters UnitSetData.NPC_<Char> containers. "
                  "Will resolve once h2-npc-inherit-variants lands.",
    },
    "NemesisGiveTraitForItemIntro01": {
        "category": "extractor-deferred",
        "reason": "Defined in NPCData_Nemesis.lua under "
                  "VariantSetData.NPC_Nemesis_01.NemesisRandomEvent; the H2 "
                  "NPC walker only enters UnitSetData.NPC_<Char> containers. "
                  "Will resolve once h2-npc-inherit-variants lands.",
    },
    "NemesisPostCombatAboutArmor01": {
        "category": "extractor-deferred",
        "reason": "Defined in NPCData_Nemesis.lua under "
                  "VariantSetData.NPC_Nemesis_01.NemesisPostRandomEventCombat; "
                  "the H2 NPC walker only enters UnitSetData.NPC_<Char> "
                  "containers. Will resolve once h2-npc-inherit-variants "
                  "lands.",
    },
    "NemesisPostCombatAboutCerberus01": {
        "category": "extractor-deferred",
        "reason": "Defined in NPCData_Nemesis.lua under "
                  "VariantSetData.NPC_Nemesis_01.NemesisPostRandomEventCombat; "
                  "the H2 NPC walker only enters UnitSetData.NPC_<Char> "
                  "containers. Will resolve once h2-npc-inherit-variants "
                  "lands.",
    },
    "NemesisPostCombatAboutRelationship01": {
        "category": "extractor-deferred",
        "reason": "Defined in NPCData_Nemesis.lua under "
                  "VariantSetData.NPC_Nemesis_01.NemesisPostRandomEventCombat; "
                  "the H2 NPC walker only enters UnitSetData.NPC_<Char> "
                  "containers. Will resolve once h2-npc-inherit-variants "
                  "lands.",
    },
    "NemesisPostCombatAboutTartarus03": {
        "category": "extractor-deferred",
        "reason": "Defined in NPCData_Nemesis.lua under "
                  "VariantSetData.NPC_Nemesis_01.NemesisPostRandomEventCombat; "
                  "the H2 NPC walker only enters UnitSetData.NPC_<Char> "
                  "containers. Will resolve once h2-npc-inherit-variants "
                  "lands.",
    },
    "NemesisPostCombatBecomingCloser01": {
        "category": "extractor-deferred",
        "reason": "Defined in NPCData_Nemesis.lua under "
                  "VariantSetData.NPC_Nemesis_01.NemesisPostRandomEventCombat; "
                  "the H2 NPC walker only enters UnitSetData.NPC_<Char> "
                  "containers. Will resolve once h2-npc-inherit-variants "
                  "lands.",
    },
    "NemesisPostCombatFirstMeeting": {
        "category": "extractor-deferred",
        "reason": "Defined in NPCData_Nemesis.lua under "
                  "VariantSetData.NPC_Nemesis_01.NemesisPostRandomEventCombat; "
                  "the H2 NPC walker only enters UnitSetData.NPC_<Char> "
                  "containers. Will resolve once h2-npc-inherit-variants "
                  "lands.",
    },
    "NemesisPostCombatPostTrueEnding01": {
        "category": "extractor-deferred",
        "reason": "Defined in NPCData_Nemesis.lua under "
                  "VariantSetData.NPC_Nemesis_01.NemesisPostRandomEventCombat; "
                  "the H2 NPC walker only enters UnitSetData.NPC_<Char> "
                  "containers. Will resolve once h2-npc-inherit-variants "
                  "lands.",
    },
    "NemesisShopping01": {
        "category": "extractor-deferred",
        "reason": "Defined in NPCData_Nemesis.lua under "
                  "VariantSetData.NPC_Nemesis_01.NemesisShopping; the H2 NPC "
                  "walker only enters UnitSetData.NPC_<Char> containers. "
                  "Will resolve once h2-npc-inherit-variants lands.",
    },
    "NemesisShopping02": {
        "category": "extractor-deferred",
        "reason": "Defined in NPCData_Nemesis.lua under "
                  "VariantSetData.NPC_Nemesis_01.NemesisShopping; the H2 NPC "
                  "walker only enters UnitSetData.NPC_<Char> containers. "
                  "Will resolve once h2-npc-inherit-variants lands.",
    },
    "NemesisShopping03": {
        "category": "extractor-deferred",
        "reason": "Defined in NPCData_Nemesis.lua under "
                  "VariantSetData.NPC_Nemesis_01.NemesisShopping; the H2 NPC "
                  "walker only enters UnitSetData.NPC_<Char> containers. "
                  "Will resolve once h2-npc-inherit-variants lands.",
    },
    "NemesisShopping04": {
        "category": "extractor-deferred",
        "reason": "Defined in NPCData_Nemesis.lua under "
                  "VariantSetData.NPC_Nemesis_01.NemesisShopping; the H2 NPC "
                  "walker only enters UnitSetData.NPC_<Char> containers. "
                  "Will resolve once h2-npc-inherit-variants lands.",
    },
    "NemesisTakeDamageForItemIntro01": {
        "category": "extractor-deferred",
        "reason": "Defined in NPCData_Nemesis.lua under "
                  "VariantSetData.NPC_Nemesis_01.NemesisRandomEvent; the H2 "
                  "NPC walker only enters UnitSetData.NPC_<Char> containers. "
                  "Will resolve once h2-npc-inherit-variants lands.",
    },
}


# Display labels and short descriptions for the viewer; keeps category
# strings in the data layer terse while still surfacing the full intent
# in the UI. H2 adds the ``extractor-deferred`` category on top of the
# H1 set; the shared ``UNRESOLVED_CATEGORY_LABELS`` /
# ``UNRESOLVED_CATEGORY_DESCRIPTIONS`` maps in ``src.known_unresolved``
# are populated as the union of both games' categories at import time.
HADES2_UNRESOLVED_CATEGORY_LABELS = {
    "cut-content":        "Cut content",
    "extractor-deferred": "Extractor coverage gap",
}

HADES2_UNRESOLVED_CATEGORY_DESCRIPTIONS = {
    "cut-content":
        "The referenced textline was planned but never made it into the "
        "final game data. Whether this breaks anything depends on how "
        "it is referenced (a null-check is harmless; a positive requirement "
        "blocks the referencing textline).",
    "extractor-deferred":
        "The referenced textline IS defined in the H2 source, but inside "
        "a container that the current extractor set does not walk yet "
        "(typically a VariantSetData per-character subtree). These will "
        "resolve automatically when the corresponding extractor work "
        "lands.",
}
