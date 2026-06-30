// Lua value semantics shared by the per-game save-state evaluators
// (gamestate-eval.js for Hades II, gamestate-eval-h1.js for Hades 1). The game
// data is Lua, so these mirror Lua's runtime behaviour:
//
//   * truthiness - only ``nil`` and ``false`` are falsy; 0 and "" are TRUTHY.
//   * table length as the engine's ``TableLength`` / ``pairs`` key count
//     (``nil`` -> 0).
//
// (The engine's ``PathTrue`` additionally rejects 0; that special case is
// handled at its branch in the evaluator, not here.)

export function luaTruthy(v) {
    return v !== undefined && v !== null && v !== false;
}

export function tableLen(v) {
    return (v && typeof v === 'object') ? Object.keys(v).length : 0;
}
