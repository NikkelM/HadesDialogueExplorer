"""
Hardcoded speaker / NPC display name mappings.

These map internal IDs (used in NPCData.lua dialogue entries) to friendly
display names shown in the viewer. Internal IDs remain canonical everywhere
in the data; friendly names are presentation only.

The set of speakers per game is small and stable, so hardcoding is simpler
than parsing the game's HelpText.en.sjson localization file. Sources include
the player character (which has no HelpText entry), regular NPCs, and "Field"
encounter variants that reuse the same character identity as their base NPC.

When new NPCs are added or a player encounters an unmapped speaker, the
viewer falls back to displaying the internal ID. Run ``generate_data.py``
to see the "Speaker names: X mapped of Y referenced" line and identify
missing entries.
"""

HADES1_SPEAKER_NAMES = {
    "CharProtag": "Zagreus",
    "NPC_Achilles_01": "Achilles",
    "NPC_Achilles_Story_01": "Achilles",
    "NPC_Bouldy_01": "Bouldy",
    "NPC_Cerberus_01": "Cerberus",
    "NPC_Cerberus_Field_01": "Cerberus",
    "NPC_Charon_01": "Charon",
    "NPC_Chaos_01": "Chaos",
    "NPC_Dusa_01": "Dusa",
    "NPC_Eurydice_01": "Eurydice",
    "NPC_FurySister_01": "Megaera",
    "NPC_FurySister_02": "Alecto",
    "NPC_FurySister_03": "Tisiphone",
    "NPC_Hades_01": "Hades",
    "NPC_Hades_Story_01": "Hades",
    "NPC_Hypnos_01": "Hypnos",
    "NPC_Nyx_01": "Nyx",
    "NPC_Nyx_Story_01": "Nyx",
    "NPC_Orpheus_01": "Orpheus",
    "NPC_Orpheus_Story_01": "Orpheus",
    "NPC_Patroclus_01": "Patroclus",
    "NPC_Patroclus_Unnamed_01": "? ? ?",
    "NPC_Persephone_01": "Persephone",
    "NPC_Persephone_Home_01": "Persephone",
    "NPC_Persephone_Unnamed_01": "? ? ?",
    "NPC_Sisyphus_01": "Sisyphus",
    "NPC_SisyphusAndBouldy_01": "Sisyphus & Bouldy",
    "NPC_Skelly_01": "Skelly",
    "NPC_Thanatos_01": "Thanatos",
    "NPC_Thanatos_Field_01": "Thanatos",
}
