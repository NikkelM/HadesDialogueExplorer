"""Curated friendly names for Hades 1 entities that have no usable
``DisplayName`` in the game text data but still appear as ``otherRequirements``
values - resources, boss/enemy kill-source ids, elite enemy variants, and
environmental traps.

These are merged into the viewer's ``entityNames`` lookup (below the vendored
sjson map, which has priority) so that gates such as
``RequiredLastKilledByUnits`` / ``RequiredResourcesMin`` read with a friendly
name; the internal id stays in the row tooltip.

Naming choices:
  - Resources use their in-game item names (Money is the Obol currency, the
    "Super" tiers are the rare meta currencies).
  - The three Bone Hydra attack-heads are the same boss (Lernie) in different
    attack modes, so all read "Bone Hydra". Theseus2 is the chariot phase of
    the Theseus fight, tracked as a separate kill-source id but the same boss.
  - Elite variants read "<base enemy> (Elite)". The game's own UI has separate
    "Dire <name>" labels only for the dedicated mini-boss ids (``*Miniboss``),
    not these elite variants, so the base-name + "(Elite)" form is used to stay
    consistent with the rest of the tool.
  - Traps / hazards have no codex name; they get a short readable label. The two
    that do inherit a named obstacle (DartTrapEmitter -> Dart Trap,
    BlastCubeFusedRegenerating -> Urn of Shadows) use that name.
"""

HADES1_EXTRA_ENTITY_NAMES = {
    # --- Resources (currencies / meta materials) ---
    "Money": "Charon's Obol",
    "Gems": "Gemstones",
    "GiftPoints": "Nectar",
    "SuperGiftPoints": "Ambrosia",
    "LockKeys": "Chthonic Keys",
    "SuperLockKeys": "Titan Blood",

    # --- Bosses / named enemies (kill-source ids) ---
    "Theseus2": "Theseus (Extreme Measures)",
    "CrawlerMiniBoss": "King Vermin",
    "HydraHeadSlammer": "Bone Hydra (Blue)",
    "HydraHeadLavamaker": "Bone Hydra (Orange)",
    "HydraHeadSummoner": "Bone Hydra (Green)",

    # --- Elite enemy variants ("<base enemy> (Elite)") ---
    "RatThugElite": "Gigantic Vermin (Elite)",
    "FreezeShotUnitElite": "Gorgon (Elite)",
    "SpreadShotUnitElite": "Spreader (Elite)",
    "SplitShotUnitElite": "Splitter (Elite)",
    "BloodlessSelfDestructElite": "Slam-Dancer (Elite)",
    "BloodlessNakedElite": "Bloodless (Elite)",
    "BloodlessNakedBerserkerEliter": "Bone-Raker (Elite)",
    "ShadeSpearUnitElite": "Longspear (Elite)",
    "ShadeShieldUnitElite": "Greatshield (Elite)",
    "ShadeBowUnitElite": "Strongbow (Elite)",
    "ShadeSwordUnitElite": "Brightsword (Elite)",
    "ChariotElite": "Nemean Chariot (Elite)",
    "ChariotSuicideElite": "Flame Wheel (Elite)",
    "SatyrRangedElite": "Satyr Cultist (Elite)",
    "ThiefImpulseMineLayerElite": "Bother (Elite)",
    "HeavyRangedForkedElite": "Snakestone (Elite)",
    "RangedBurrowerElite": "Dracon (Elite)",
    "DisembodiedHandElite": "Wringer (Elite)",

    # --- Traps / hazards / environmental kill-sources ---
    "ArcherTrap": "Archer Trap",
    "BloodMine": "Blood Mine",
    "DartTrapEmitter": "Dart Trap",
    "LavaTile": "Lava",
    "LavaTileTriangle01": "Lava",
    "LavaTileTriangle02": "Lava",
    "LavaSplash": "Lava",
    "SawTrap": "Saw Trap",
    "AxeTrap": "Axe Trap",
    "PoisonTrap": "Poison Trap",
    "BlastCubeFusedRegenerating": "Phoenix Urn",

    # --- Other kill-sources (RequiredLastKilledByWeaponNames) ---
    "BiomeTimer": "Tight Deadline",
    "GunGrenadeToss": "Adamant Rail",
}
