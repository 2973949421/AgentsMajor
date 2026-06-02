# Phase 2.0-pre Defender Thesis Judge Contract

## Contract

Phase 2.0-pre judge must treat the current defending side's business plan as the half-level thesis under test.

- The defending team defends, refines, and proves its own thesis.
- The attacking team challenges the defending thesis; it does not make its own thesis the primary scoring object for this round.
- CS-like attack, defense, zones, win type, and economy remain the match grammar.
- Product and business evidence remains the scoring meaning.
- Scorecard is an audit layer. It must explain attack challenge quality and defense hold quality against the defender thesis.

## Required Judge Context

New v6 judge inputs include `defenderThesisContext`.

- `defenderTeamThesis`: defending team's half-level business plan.
- `defenderMustHoldClaims`: claims the defender must keep credible.
- `attackerChallengeBrief`: how the attacker is challenging the defender thesis this round.
- `attackerPrimaryZoneId` and `defenderPrimaryZoneId`: canonical tactical zones tied back to business meaning.
- `dimensionRequirements`: per-scorecard-dimension attack challenge and defense hold requirements.

## Field Stability Rules

- Zone ids must be canonical tactical ids such as `conversion_site_a`, `conversion_site_b`, or `buyer_mid`.
- Common aliases such as `zone_a`, `zone_a_main`, `site_a`, and `zone_mid` are normalized before validation.
- `margin` is code-derived from score delta. LLM-proposed margin may be retained only as audit metadata.
- Repair may fix structure, aliases, scorecard completeness, and evidence source names. It must not change winner facts unless the validation error is specifically about winner/side/winType consistency.

## Acceptance

- New R1-R3 judge evidence shows defender thesis, attack challenge, and defense hold.
- Attack wins explain the defender-thesis vulnerability that was exposed.
- Defense wins explain the defender-thesis claim that held.
- Old replay remains readable when `defenderThesisContext` is absent.
