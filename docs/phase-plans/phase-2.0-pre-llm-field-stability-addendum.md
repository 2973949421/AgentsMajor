# Phase 2.0-pre LLM Field Stability Addendum

## 1. Optional Field Rule

- Optional LLM fields must be omitted when unknown.
- LLM outputs must not use `null`, empty strings, or empty objects to fill optional fields.
- Core may sanitize this noise only at LLM parse boundaries.
- Business schemas remain strict and are not globally nullable.

## 2. Judge Scorecard Two-Layer Rule

- `judge_verdict` may return a lightweight scorecard intent focused on `judgeScorecard.teamScores`.
- Code owns the input `rubricProfile` and materializes the final full `judgeScorecard`.
- Required verdict facts remain strict: `winnerTeamId`, `loserTeamId`, `margin`, `roundWinType`, `mvpAgentId`, and `diagnostic.decisiveEvidence`.
- Code completion must not hide contradictions. If materialized scores imply a different winner, margin, or win side, validation fails.

## 3. Scorecard Source

Final scorecards expose `scorecardSource`:

- `llm_full`: the LLM returned a complete valid scorecard.
- `code_completed_from_verdict`: code completed a missing or lightweight scorecard from valid verdict facts.
- `deterministic_fallback`: fake/demo/test or compatibility fallback generated the scorecard.

The frontend must display this source so code-completed scorecards are not presented as pure LLM scoring.
