-- Synthetic NPCData.lua fixture for integration testing.
-- Exercises the full pipeline: tokenizer -> parser -> extractor -> graph.
UnitSetData.NPCs = {
    NPC_Orpheus_01 = {
            -- Standard interact textlines with dependency chain
            InteractTextLineSets = {
                OrpheusIntro01 = {
                    PlayOnce = true,
                    { Speaker = "CharProtag", Text = "Who are you?" },
                    { Text = "I am Orpheus, my lord." },
                },
                OrpheusFollowup01 = {
                    RequiredTextLines = { "OrpheusIntro01" },
                    { Text = "Have you heard my song?" },
                },
                OrpheusSecret01 = {
                    RequiredTextLines = { "OrpheusFollowup01" },
                    RequiredFalseTextLines = { "OrpheusForbidden01" },
                    RequiredMinCompletedRuns = 5,
                    { Speaker = "CharProtag", Text = "Tell me everything." },
                    { Text = "Very well..." },
                },
            },
            -- Gift dialogue
            GiftTextLineSets = {
                OrpheusGift01 = {
                    { Text = "Many thanks, my lord!" },
                },
            },
            -- External reference - should appear in unresolvedRefs
            RepeatableTextLineSets = {
                OrpheusRepeat01 = {
                    RequiredTextLines = { "SomeExternalLine" },
                    { Text = "{#DialogueItalicFormat}Singing softly..." },
                },
            },
        },
    }
