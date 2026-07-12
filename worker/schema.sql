-- D1 schema for the Hades Dialogue Explorer usage analytics.
--
-- One row per counted key. The primary key is the composite
-- (game, type, id): the SAME textline name or speaker id exists in BOTH
-- Hades 1 and Hades 2, so ``game`` is part of the key to keep those counts
-- separate. Aggregate events that have no id (session_start, save_loaded)
-- use the empty-string id.
--
-- Apply with:
--   wrangler d1 execute hde-analytics --remote --file=./schema.sql
-- (drop ``--remote`` to seed the local dev database instead).

CREATE TABLE IF NOT EXISTS counts (
    game       TEXT    NOT NULL,
    type       TEXT    NOT NULL,
    id         TEXT    NOT NULL DEFAULT '',
    count      INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (game, type, id)
);

-- Serves the top-N popularity queries (ORDER BY count DESC within a type/game).
CREATE INDEX IF NOT EXISTS idx_counts_type_game_count ON counts (type, game, count DESC);
