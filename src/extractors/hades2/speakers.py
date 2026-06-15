"""
Hardcoded Hades II speaker / NPC metadata.

Single source of truth for everything the viewer needs to know about an
H2 speaker beyond what's in the dialogue data itself: the friendly
display name and (optionally) the one-line character description quip
that surfaces in the hover tooltip.

The two fields are kept in one map because they're strictly 1:1 with
the internal id; splitting them into parallel dicts would invite
silent drift (an entry added in one but not the other) without buying
anything. Audit logic that used to enforce parity is therefore made
structurally impossible to violate.

Internal IDs remain canonical everywhere in the data; friendly names
and descriptions are presentation only.

Labelling conventions:
  * Whichever id actually carries the most prominent in-game dialogue
    for a character gets the bare name (e.g. ``NPC_Hades_Field_01`` =
    "Hades", since that's where the bulk of present-day Hades dialogue
    lives in ``NPCData_Hades.lua``; ``HermesUpgrade`` = "Hermes",
    since the boon-offer Hermes is his canonical interactive form -
    the running ``NPC_Hermes_01`` Field variant carries less dialogue).
  * If multiple ids for the same character all carry dialogue, they
    all get the bare name; the collision is allowlisted in the test
    module (e.g. all four ``NPC_Hypnos_0[1-4]`` variants display as
    "Hypnos"; all four Hades framing variants display as "Hades"
    with the description quip carrying the contextual distinction).
  * Qualifiers in parentheses are used only when the in-game framing
    is distinct enough that the player would notice a difference:
      - ``(Field)`` for the chamber-encounter Artemis variant and the
        running ``NPC_Hermes_01`` courier variant (vs the canonical
        boon-offer ``HermesUpgrade`` form).
      - ``(House)`` for ``NPC_Hades_02`` (his House of Hades framing).
      - ``(Reformed)`` for ``NPC_Chronos_02`` and ``Speaker_Chronos_02``
        (the late-game redeemed Father Time framing).
      - ``(Crossroads)`` for ``NPC_Arachne_Home_01`` (the Crossroads
        hub vs the chamber-encounter Arachne).
      - ``(Olympus)`` for the Olympian ``NPC_<God>_Story_01`` variants
        that fire during the Olympus story arc.
      - ``(Dreaming)`` for the two Hypnos dream-sequence variants.
  * Story-event variants for non-Olympian Underworld characters
    (Hecate / Nyx / Melinoë / Chronos / Hades / Cerberus) get the
    bare name - the in-game framing is continuous with their base
    appearance, and the description quip differentiates contexts.
  * Mystery / first-meeting variants keep the ``? ? ? (Char)`` shape.
  * Boss-only characters (Polyphemus, Prometheus, Theseus, ...) use
    the bare character name regardless of cutscene / dream-run /
    alt-fight sub-variant, mirroring H1. Characters who are *both* a
    boss and a walking NPC (Hecate, Eris, Chronos, Zagreus) get
    ``(Boss)`` on the boss form, registered under the bare boss
    container key from ``UnitSetData.<Char>`` (matches the H1
    convention - see ``Hades`` / ``Harpy`` entries in
    :mod:`src.extractors.hades1.speakers`). The Surface alt-fight
    container ``TyphonHead`` displays as ``"Chronos (Summit)"`` for
    the same reason - Typhon never speaks, and the apparition voice
    is Chronos in a context distinct from his Erebus boss
    appearance.
  * **Environmental / combat-bark speakers are NOT included.** Bare
    names like ``Medea``, ``Heracles``, ``InfestedCerberus`` (in
    ``EnemyData_*.lua`` / ``AudioData.lua``) are non-interactive
    voice tags for boss-fight callouts / environmental quips with no
    portrait or textbox - they are not "dialogue speakers" and the
    corresponding interactive forms already live in the dict as
    ``NPC_<Char>_01``.

Source notes:
  * Initial dump generated once from H2 1.x
    ``Game/Text/en/HelpText.en.sjson`` (entries whose ``Id`` starts
    with ``NPC_``, ``PlayerUnit``, ``Speaker_``), then hand-curated
    to drop false positives (quest ids and UI strings that shared a
    character prefix - e.g. ``HermesFirstPickUp``, ``PlayerUnitFrozen``,
    all ``<Character>_Full`` / ``_AltFight01`` / ``_DreamRun01``
    HealthBarTextIds), and cross-referenced against a cue-attribution
    walk of all 171 H2 Lua scripts (NPCData / EncounterData / EnemyData
    / RoomData / DeathLoopData / AudioData / FlashbackPresentation /
    NarrativeData / PresentationBiome) to drop ids with zero
    interactive-dialogue cue attribution and add ids that the walker
    surfaced as real speakers but HelpText omitted (``HermesUpgrade``,
    ``Speaker_Chronos_02``, ``NPC_Cerberus_Field_01``,
    ``NPC_Cerberus_Story_01``).
  * Hardcoded - intentionally NOT loaded from SJSON at build time -
    to match H1's convention (:mod:`src.extractors.hades1.speakers`)
    and the related hardcoded MiscText override.
  * Mystery / shrouded variants (``NPC_Unnamed_01``,
    ``NPC_Cyclops_Unnamed_01``, ``NPC_Scylla_Unnamed_01``) keep
    their masked display name from the source. The shepherd /
    sea-monster quips on the Cyclops / Scylla mystery entries are
    intentionally preserved because the in-game tag already exposes
    the silhouette flavour; the bare ``NPC_Unnamed_01`` quip stays
    ``None`` so the dev tooltip doesn't leak it.
"""

HADES2_SPEAKERS = {
    # The protagonist plus narrative-context variants. ``PlayerUnit``
    # is the primary tag, ``_Flashback`` is used in flashback scenes
    # (Chthonic Nymph quip; explicit ``Speaker = "PlayerUnit_Flashback"``
    # on Melinoë's young-self subtitle lines).
    "PlayerUnit":           {"name": "Melinoë", "description": "Princess of the Underworld"},
    "PlayerUnit_Flashback": {"name": "Melinoë", "description": "Chthonic Nymph"},

    # Olympian / underworld NPCs - one entry per ``NPC_<Char>_01`` id
    # in the HelpText source, kept in alphabetical order for diff
    # readability. Story / Field / Home / Past variants are
    # interleaved next to their base form so a reader can see the
    # per-character variant set at a glance.
    "NPC_Achilles_01":      {"name": "Achilles",    "description": "Forgotten Hero"},
    "NPC_Aphrodite_01":     {"name": "Aphrodite",   "description": "Goddess of Love"},
    "NPC_Apollo_01":        {"name": "Apollo",      "description": "God of Light"},
    # Olympus story-arc variant - same character, fires during the
    # surface-Olympus narrative beats so the ``(Olympus)`` qualifier
    # makes the context explicit in the viewer.
    "NPC_Apollo_Story_01":  {"name": "Apollo (Olympus)", "description": "God of Light"},
    "NPC_Arachne_01":       {"name": "Arachne",     "description": "Silk Weaver"},
    # Arachne's Crossroads-hub variant. The base ``_01`` is her
    # chamber-encounter form; the ``_Home_`` variant only speaks
    # once she's set up shop at the Crossroads.
    "NPC_Arachne_Home_01":  {"name": "Arachne (Crossroads)", "description": "Silk Weaver"},
    "NPC_Ares_01":          {"name": "Ares",        "description": "God of War"},
    # Artemis has both a hub-style ``_01`` form (with InteractTextLineSets)
    # and a chamber-encounter ``_Field_01`` form; both carry distinct
    # dialogue sets so they get distinct labels.
    "NPC_Artemis_01":        {"name": "Artemis",        "description": "Goddess of the Hunt"},
    "NPC_Artemis_Field_01":  {"name": "Artemis (Field)", "description": "Goddess of the Hunt"},
    "NPC_Athena_01":        {"name": "Athena",      "description": "Goddess of Wisdom"},
    # Strange Rock has no source description (Bouldy is a returning
    # cameo without a quip in H2).
    "NPC_Bouldy_01":        {"name": "Strange Rock", "description": None},
    # Cerberus speaks via the Field / Story variants registered in
    # ``NarrativeData.lua`` (``InteractTextLinePriorities = {
    # "CerberusFirstMeeting", "CerberusMeeting02" }`` on
    # ``NPC_Cerberus_Field_01``). The actual cue blocks live under
    # ``NPCData_Hades.lua`` because Bouldy + Cerberus are grouped with
    # Hades; the Storyteller voices most lines but the displayed
    # speaker is Cerberus (mirrors H1's pattern). The bare
    # ``NPC_Cerberus_01`` HelpText id ships no interactive cues and
    # is intentionally omitted - only the Field / Story variants are
    # surfaced.
    "NPC_Cerberus_Field_01": {"name": "Cerberus", "description": "Notorious Watchdog"},
    "NPC_Cerberus_Story_01": {"name": "Cerberus", "description": "Notorious Watchdog"},
    "NPC_Chaos_01":         {"name": "Chaos",       "description": "Primordial Originator"},
    "NPC_Charon_01":        {"name": "Charon",      "description": "Stygian Boatman"},
    "NPC_Chronos_01":       {"name": "Chronos",     "description": "Titan of Time"},
    # ``NPC_Chronos_02`` carries the post-redemption Father Time
    # framing; in-game quip differs from the Titan tag so the
    # ``(Reformed)`` qualifier disambiguates them. ``Speaker_Chronos_02``
    # is the matching subtitle/voice tag on the cues themselves
    # (NPCData_Chronos.lua, 103 cues) - same character, same framing.
    "NPC_Chronos_02":       {"name": "Chronos (Reformed)", "description": "Father Time"},
    "Speaker_Chronos_02":   {"name": "Chronos (Reformed)", "description": "Father Time"},
    # ChronosNightmare01 lives on the story variant; same character,
    # bare name (no Olympus-style displacement).
    "NPC_Chronos_Story_01": {"name": "Chronos",     "description": "Titan of Time"},
    "NPC_Circe_01":         {"name": "Circe",       "description": "Witch of Changing"},
    # Polyphemus uses ``NPC_Cyclops_01`` as his canonical speaker id;
    # ``_Unnamed_`` is his first-meeting masked variant (the shepherd
    # silhouette before the player learns his name in-game).
    "NPC_Cyclops_01":           {"name": "Polyphemus", "description": "Infamous Cyclops"},
    "NPC_Cyclops_Unnamed_01":   {"name": "? ? ? (Polyphemus)", "description": "Cyclopean Shepherd"},
    "NPC_Demeter_01":       {"name": "Demeter",     "description": "Goddess of Seasons"},
    "NPC_Demeter_Story_01": {"name": "Demeter (Olympus)", "description": "Goddess of Seasons"},
    "NPC_Dionysus_01":      {"name": "Dionysus",    "description": "God of Wine"},
    "NPC_Dora_01":          {"name": "Dora",        "description": "Listless Shade"},
    "NPC_Dusa_01":          {"name": "Dusa",        "description": "Duty-Bound Gorgon"},
    # Echo has two distinct narrative arcs in H2 - the dispirited
    # first-act version and the spirited second-act version - and
    # they ship as separate speaker ids in the source data.
    "NPC_Echo_01":          {"name": "Echo",        "description": "Dispirited Nymph"},
    "NPC_Echo_02":          {"name": "Echo",        "description": "Spirited Nymph"},
    "NPC_Eris_01":          {"name": "Eris",        "description": "Strife Incarnate"},
    # The three Fates each have a personal speaker id. No joint
    # ``FateSisters`` tag is used in interactive cues - the three
    # individuals speak separately even in chorus scenes.
    "NPC_Fates_01":         {"name": "Clotho",      "description": "Spinstress of Fate"},
    "NPC_Fates_02":         {"name": "Lachesis",    "description": "Apportioner of Fate"},
    "NPC_Fates_03":         {"name": "Atropos",     "description": "Cutter of Fate"},
    # Hades disambiguation: he speaks under four distinct ids that all
    # show "Hades" with the description quip carrying the contextual
    # distinction. ``_Field_01`` is the main present-day dialogue
    # carrier (108 refs in NPCData_Hades.lua). ``_02`` is the
    # House-of-Hades framing. ``_01`` is the captive/Prisoner-of-Time
    # form (HelpText description). ``LordHades_01`` is the formal
    # Lord-of-the-Dead voice tag used during Chronos confrontation
    # scenes (NPCData_Chronos.lua, NPCData.lua, NPCData_Hades.lua;
    # 28 cues with ``Speaker = "NPC_LordHades_01"`` and
    # ``LineHistoryName = "NPC_Hades_01"``). ``_Story_01`` is the
    # chained-Hades True Ending sequence (RoomDataI.lua,
    # PresentationBiomeI.lua) - same captive framing.
    "NPC_Hades_Field_01":   {"name": "Hades",         "description": "God of the Dead"},
    "NPC_Hades_01":         {"name": "Hades",         "description": "Prisoner of Time"},
    "NPC_Hades_02":         {"name": "Hades (House)", "description": "God of the Dead"},
    "NPC_Hades_Story_01":   {"name": "Hades",         "description": "Prisoner of Time"},
    "NPC_LordHades_01":     {"name": "Hades",         "description": "God of the Dead"},
    "NPC_Hecate_01":        {"name": "Hecate",      "description": "Witch of the Crossroads"},
    "NPC_Hecate_Story_01":  {"name": "Hecate",      "description": "Witch of the Crossroads"},
    "NPC_Hephaestus_01":    {"name": "Hephaestus",  "description": "God of the Forge"},
    "NPC_Hera_01":          {"name": "Hera",        "description": "Queen of the Olympians"},
    "NPC_Hera_Story_01":    {"name": "Hera (Olympus)", "description": "Queen of the Olympians"},
    "NPC_Heracles_01":      {"name": "Heracles",    "description": "Mightiest of Men"},
    # Hermes ships in two forms. ``HermesUpgrade`` is the canonical
    # boon-offer Hermes - the form most players interact with most
    # often (and the only ``<God>Upgrade`` id with its own cue-level
    # ``Speaker = "..."`` references; 29 cues in NPCData_Hermes.lua).
    # ``NPC_Hermes_01`` is the running-courier Field variant who
    # appears in specific chambers and carries less dialogue.
    "HermesUpgrade":        {"name": "Hermes",         "description": "God of Swiftness"},
    "NPC_Hermes_01":        {"name": "Hermes (Field)", "description": "God of Swiftness"},
    "NPC_Hestia_01":        {"name": "Hestia",      "description": "Goddess of the Hearth"},
    # Hypnos has four numbered variants (01-04) plus two dream-run
    # forms. All four numbered forms speak as the same character in
    # different rooms / states; the dream-run pair is the only one
    # that warrants a qualifier since the dreaming framing is what
    # the player actually perceives.
    "NPC_Hypnos_01":        {"name": "Hypnos",      "description": "Sleep Incarnate"},
    "NPC_Hypnos_02":        {"name": "Hypnos",      "description": "Sleep Incarnate"},
    "NPC_Hypnos_03":        {"name": "Hypnos",      "description": "Sleep Incarnate"},
    "NPC_Hypnos_04":        {"name": "Hypnos",      "description": "Sleep Incarnate"},
    "NPC_Hypnos_DreamRun":      {"name": "Hypnos (Dreaming)", "description": "Sleep Incarnate"},
    "NPC_Hypnos_DreamRun_Alt":  {"name": "Hypnos (Dreaming)", "description": "Sleep Incarnate"},
    "NPC_Icarus_01":        {"name": "Icarus",      "description": "Free Spirit"},
    "NPC_Medea_01":         {"name": "Medea",       "description": "Witch of Shadows"},
    "NPC_Megaera_01":       {"name": "Megaera",     "description": "First of the Furies"},
    "NPC_Melinoe_Story_01": {"name": "Melinoë",     "description": "Princess of the Underworld"},
    "NPC_Moros_01":         {"name": "Moros",       "description": "Doom Incarnate"},
    "NPC_Narcissus_01":      {"name": "Narcissus",  "description": "Beautiful Flower"},
    "NPC_Narcissus_Field_01": {"name": "Narcissus", "description": "Beautiful Flower"},
    "NPC_Nemesis_01":       {"name": "Nemesis",     "description": "Retribution Incarnate"},
    "NPC_Nyx_01":           {"name": "Nyx",         "description": "Night Incarnate"},
    "NPC_Nyx_Story_01":     {"name": "Nyx",         "description": "Night Incarnate"},
    # Off-screen Nyx-voice tag used for cues where she speaks without
    # appearing in the scene (the ``?`` is part of the source
    # display name, indicating uncertain attribution).
    "NPC_NyxVoice_01":      {"name": "Nyx?",        "description": None},
    "NPC_Odysseus_01":      {"name": "Odysseus",    "description": "Veteran Tactician"},
    "NPC_Orpheus_01":       {"name": "Orpheus",     "description": "Court Musician"},
    "NPC_Persephone_01":    {"name": "Persephone",  "description": "Queen of the Underworld"},
    "NPC_Poseidon_01":      {"name": "Poseidon",    "description": "God of the Sea"},
    "NPC_Prometheus_01":    {"name": "Prometheus",  "description": "Titan of Foresight"},
    "NPC_Scylla_01":        {"name": "Scylla",      "description": "Scourge of the Seas"},
    "NPC_Scylla_Unnamed_01": {"name": "? ? ? (Scylla)", "description": "Sea Monster"},
    "NPC_Selene_01":        {"name": "Selene",      "description": "Moon Incarnate"},
    # Schelemeus is H2's Skelly - same skeletal training-dummy
    # character, retconned with his true name surfaced. The
    # ``_TrueMythologicalOrigin_`` variant is for the late-game
    # reveal cues where he speaks as Schelememnon, a second judge
    # of the dead.
    "NPC_Skelly_01":        {"name": "Schelemeus",  "description": "Training Master"},
    "NPC_Skelly_TrueMythologicalOrigin_01": {"name": "Schelememnon", "description": "Second Judge of the Dead"},
    "NPC_Thanatos_01":      {"name": "Thanatos",    "description": "Death Incarnate"},
    # Bare mystery tag for first-meeting cues whose speaker has not
    # yet been disambiguated by a character-specific ``_Unnamed_``
    # variant. Quip intentionally suppressed.
    "NPC_Unnamed_01":       {"name": "? ? ?",       "description": None},
    # Zagreus appears in H2 in two contexts: ``NPC_Zagreus_01`` is
    # his canonical present-day cameo (per HelpText, used in
    # CodexData / DeathLoopData refs); ``NPC_Zagreus_Past_01`` is
    # his flashback-scene tag. Both surface as the same character.
    "NPC_Zagreus_01":       {"name": "Zagreus",     "description": "Prince of the Underworld"},
    "NPC_Zagreus_Past_01":  {"name": "Zagreus",     "description": "Prince of the Underworld"},
    "NPC_Zeus_01":          {"name": "Zeus",        "description": "King of the Olympians"},
    "NPC_Zeus_Story_01":    {"name": "Zeus (Olympus)", "description": "King of the Olympians"},

    # Boss-fight speaker entries. The H2 ``EnemyData_*.lua`` files use
    # bare character names as the boss container key
    # (``UnitSetData.Hecate.Hecate`` etc.), and the EnemyData extractor
    # keeps them as the owner id and the cue-speaker fallback. Each id
    # below gets a display name that disambiguates the boss-fight form
    # from any walking-NPC overlap: characters who also appear as a
    # hub / Crossroads NPC use ``"(Boss)"`` to separate their boss
    # dialogue from ``NPC_<Char>_01`` (Hecate, Eris, Chronos,
    # Zagreus); the Surface alt-fight ``TyphonHead`` displays as
    # ``"Chronos (Summit)"`` because Typhon never speaks and every
    # unattributed cue is Chronos taunting Melinoë via the
    # apparition, distinct from both the Erebus ``Chronos`` boss and
    # the NPC forms (``NPC_Chronos_01`` / ``_Story_01`` / ``_02``).
    # Descriptions mirror the canonical HelpText quip from the
    # matching NPC entry verbatim (no boss-form embellishment),
    # following the H1 ``Hades`` / ``Harpy`` convention - the
    # contextual flavour lives in the ``(Boss)`` / ``(Summit)``
    # display-name qualifier, not in the description.
    "Hecate":               {"name": "Hecate (Boss)",  "description": "Witch of the Crossroads"},
    "Eris":                 {"name": "Eris (Boss)",    "description": "Strife Incarnate"},
    "Chronos":              {"name": "Chronos (Boss)", "description": "Titan of Time"},
    "Zagreus":              {"name": "Zagreus (Boss)", "description": "Prince of the Underworld"},
    "TyphonHead":           {"name": "Chronos (Summit)", "description": "Titan of Time"},

    # Non-character narrative tags. ``Speaker_Anonymous`` is used
    # for unattributed system / environment lines; ``Speaker_Homer``
    # is the in-fiction narrator (the bard whose Odyssey framing is
    # threaded through the Erebus chapter).
    "Speaker_Anonymous":    {"name": "Anonymous",   "description": None},
    "Speaker_Homer":        {"name": "Homer",       "description": None},
}
