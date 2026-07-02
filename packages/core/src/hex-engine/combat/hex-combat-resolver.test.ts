import { describe, expect, it } from "vitest";

import type { TeamEconomyPlan } from "../../economy/economy-rules.js";
import type { HexFinanceChallengeCard, HexFinanceStanceCard, HexRoundStartAgentOutputForAction } from "../action/index.js";
import { buildFixtureHexRoundBusinessDuel } from "../business/index.js";
import { buildHexRoundEconomyContext } from "../economy/index.js";
import { buildHexRoundFinanceDuel, buildSubmittedFinanceOutputs } from "../finance/index.js";
import { findHexPath } from "../path/index.js";
import { buildHexCombatContacts } from "./hex-combat-contact-builder.js";
import { applyHexCombatVariance, resolveHexCombat } from "./hex-combat-resolver.js";
import {
  buildCombatAction,
  findCellsInRegion,
  initializeCombatMemory,
  loadOfficialDust2HexMap
} from "./hex-combat-test-helpers.js";

describe("Hex combat resolver", () => {
  it("applies N64 pressure delta only through the current pressureKey", () => {
    const asset = loadOfficialDust2HexMap();
    const [attackCell, defenseCell] = findCellsInRegion(asset, "a_site", 2);
    const memory = initializeCombatMemory(asset, [
      { agentId: "t_0", side: "attack", cellId: attackCell!.cellId },
      { agentId: "ct_0", side: "defense", cellId: defenseCell!.cellId }
    ]);
    const actions = [
      buildCombatAction({ memory, agentId: "t_0", actionType: "execute_site", targetCellId: defenseCell!.cellId }),
      buildCombatAction({ memory, agentId: "ct_0", actionType: "hold_position", targetCellId: defenseCell!.cellId, valid: false })
    ];
    const contact = buildHexCombatContacts({ asset, memory, actions })[0]!;
    const pressureKey = contact.pressureKeys[0]!;

    const withoutPressure = resolveHexCombat({ asset, memory, contact, actions });
    const withPressure = resolveHexCombat({
      asset,
      memory,
      contact,
      actions,
      pressureState: {
        pressureKey,
        phaseIndex: 1,
        lastSeenPhaseIndex: 1,
        streak: 1,
        accumulatedPressure: 6,
        lastAdvantage: "attack",
        lastVerdict: "contested_suppression",
        lastContactId: contact.contactId,
        resetReasons: []
      }
    });

    expect(withPressure.audit.pressure?.pressureKey).toBe(pressureKey);
    expect(withPressure.audit.pressure?.appliedScoreDelta).toBeGreaterThan(0);
    expect(withPressure.scores.attack.totalScore).toBeGreaterThanOrEqual(withoutPressure.scores.attack.totalScore);
    expect(withPressure.csReasons).toEqual(expect.arrayContaining([expect.stringContaining("n64:pressure_delta:")]));
  });
  it("lets finance challenge evidence drive attack combat attribution while keeping business compatibility fields", () => {
    const asset = loadOfficialDust2HexMap();
    const [attackCell, defenseCell, supportCell] = findCellsInRegion(asset, "a_site", 3);
    const memory = initializeCombatMemory(asset, [
      { agentId: "t_0", side: "attack", cellId: attackCell!.cellId },
      { agentId: "t_1", side: "attack", cellId: supportCell!.cellId },
      { agentId: "ct_0", side: "defense", cellId: defenseCell!.cellId }
    ]);
    const actions = [
      buildCombatAction({
        memory,
        agentId: "t_0",
        actionType: "execute_site",
        targetCellId: defenseCell!.cellId,
        businessIntent: "质疑全球铜价代理事实 F001 不能证明国内库存，挑战守方景气上行假设并推进 A 点。"
      }),
      buildCombatAction({
        memory,
        agentId: "t_1",
        actionType: "prepare_trade",
        targetCellId: defenseCell!.cellId,
        businessIntent: "用 F002 铝价代理事实配合反证，指出 domestic_inventory 缺失会限制守方结论。"
      }),
      buildCombatAction({
        memory,
        agentId: "ct_0",
        actionType: "hold_position",
        targetCellId: defenseCell!.cellId,
        businessIntent: "",
        valid: false
      })
    ];
    const financeDuel = buildHexRoundFinanceDuel({
      roundNumber: 1,
      attackTeamId: "t",
      defenseTeamId: "ct",
      agents: [
        { agentId: "t_0", teamId: "t", side: "attack", role: "star rifler" },
        { agentId: "t_1", teamId: "t", side: "attack", role: "support" },
        { agentId: "ct_0", teamId: "ct", side: "defense", role: "anchor" }
      ]
    });
    const roundStartAgentOutputs = [
      buildResolverStanceOutput({ evidenceRefs: ["FRED002"] }),
      buildResolverChallengeOutput({ challengeId: "challenge_t_0_1", evidenceRefs: ["FRED002", "FRED003", "FRED004"] }),
      buildResolverChallengeOutput({ challengeId: "challenge_t_1_1", evidenceRefs: ["FRED002", "FRED003"] })
    ];
    const contact = buildHexCombatContacts({ asset, memory, actions })[0]!;
    const economyContext = buildHexRoundEconomyContext({
      memory,
      teamEconomyPlans: {
        t: buildPlan("t", "rifle_buy", "fullBuy", ["t_0", "t_1"]),
        ct: buildPlan("ct", "rifle_buy", "fullBuy", ["ct_0"])
      }
    });
    const submittedFinanceOutputs = buildSubmittedFinanceOutputs({ financeDuel, economyContext, roundStartAgentOutputs });

    const resolution = resolveHexCombat({ asset, memory, contact, actions, economyContext, financeDuel, roundStartAgentOutputs, submittedFinanceOutputs });

    expect(resolution.financeVerdict).toBe("challenge_landed");
    expect(resolution.businessVerdict).toBe("challenge_succeeded");
    expect(resolution.audit.financeEvidenceApplied).toBe(true);
    expect(resolution.duelPairs).toHaveLength(1);
    expect(resolution.fireLanes).toHaveLength(1);
    expect(resolution.duelPairs?.[0]?.pressureKey).toMatch(/^duelPair:/);
    expect(resolution.pressureKeys).toContain(resolution.duelPairs?.[0]?.pressureKey);
    expect(resolution.audit.duelPairing?.primaryPressureKey).not.toBe(resolution.duelPairs?.[0]?.pressureKey);
    expect(resolution.audit.duelPairing?.attributionDuelPairKey).toBe(resolution.duelPairs?.[0]?.pressureKey);
    expect(resolution.audit.duelPairing?.pressureScopeKind).toMatch(/^(objective_exposure|cell_contact|fire_lane|duel_pair)$/);
    expect(resolution.scores.attack.financeScore).toBeGreaterThan(resolution.scores.defense.financeScore ?? 0);
    expect(resolution.scores.attack.financeFirepowerScore?.appliedToCombatScore).toBeGreaterThan(0);
    expect(resolution.scores.attack.financeFirepowerScore?.participantAcceptedEvidenceRefs).toEqual(expect.arrayContaining(["FRED002", "FRED003"]));
    expect(resolution.scores.attack.financeFirepowerScore?.participantSubmittedOutputRefs).toEqual(expect.arrayContaining(["sub_fin_round_start_challenge_t_0_1"]));
    expect(resolution.scores.attack.totalScore).toBeCloseTo(resolution.scores.attack.csScore + (resolution.scores.attack.financeScore ?? 0));
    expect(resolution.scores.defense.totalScore).toBeCloseTo(resolution.scores.defense.csScore + (resolution.scores.defense.financeScore ?? 0));
    expect(resolution.financeProjection).toEqual(expect.objectContaining({
      appliedEffect: "possible_kill",
      financeMayExplainKill: true
    }));
    expect(resolution.financeReasons).toEqual(expect.arrayContaining([
      "attack:n59_accepted_evidence_present",
      expect.stringContaining("attack:n63_finance_firepower_applied"),
      "finance_verdict:challenge_landed"
    ]));
    expect(resolution.financeEvidenceAdoption?.attack.financialResult).toBe("challenge_breaks_stance");
    expect(resolution.financeEvidenceAdoption?.attack.acceptedEvidenceRefs).toEqual(expect.arrayContaining(["FRED002", "FRED003"]));
    expect(resolution.financeEvidenceAdoption?.attack.acceptedChallenges).toEqual(expect.arrayContaining(["challenge_t_0_1", "challenge_t_1_1"]));
    expect(resolution.financeReasonZh).toEqual(expect.arrayContaining([
      expect.stringContaining("挑战方采信证据")
    ]));
    expect(resolution.casualties[0]).toEqual(expect.objectContaining({
      targetAgentId: "ct_0",
      killerAgentId: "t_0",
      assisterAgentIds: ["t_1"]
    }));
  });

  it("lets defense finance thesis stand when attack falls back and lacks usable evidence", () => {
    const asset = loadOfficialDust2HexMap();
    const [attackCell, defenseCell] = findCellsInRegion(asset, "a_site", 2);
    const memory = initializeCombatMemory(asset, [
      { agentId: "t_0", side: "attack", cellId: attackCell!.cellId },
      { agentId: "ct_0", side: "defense", cellId: defenseCell!.cellId }
    ]);
    const actions = [
      buildCombatAction({
        memory,
        agentId: "t_0",
        actionType: "hold_position",
        businessIntent: "质疑文本来自 fallback，不能作为正向金融证据。",
        valid: false
      }),
      buildCombatAction({
        memory,
        agentId: "ct_0",
        actionType: "peek",
        targetCellId: attackCell!.cellId,
        businessIntent: "自证使用 F001 全球铜价代理事实支撑景气线索，同时承认 domestic_inventory 缺失和评分上限。"
      })
    ];
    const financeDuel = buildHexRoundFinanceDuel({
      roundNumber: 1,
      attackTeamId: "t",
      defenseTeamId: "ct",
      agents: [
        { agentId: "t_0", teamId: "t", side: "attack", role: "entry" },
        { agentId: "ct_0", teamId: "ct", side: "defense", role: "star rifler" }
      ]
    });
    const roundStartAgentOutputs = [
      buildResolverStanceOutput({ evidenceRefs: ["FRED002"] })
    ];
    const contact = buildHexCombatContacts({ asset, memory, actions })[0]!;

    const resolution = resolveHexCombat({ asset, memory, contact, actions, financeDuel, roundStartAgentOutputs });

    expect(resolution.financeVerdict).toBe("thesis_defended");
    expect(resolution.businessVerdict).toBe("proof_rebutted_challenge");
    expect(resolution.financeReasons).toEqual(expect.arrayContaining([
      "attack:n59_no_accepted_evidence",
      "defense:n59_accepted_evidence_present",
      "finance_verdict:thesis_defended"
    ]));
    expect(resolution.financeEvidenceAdoption?.attack.acceptedEvidenceRefs).toEqual([]);
    expect(resolution.financeEvidenceAdoption?.defense.acceptedEvidenceRefs).toContain("FRED002");
    expect(resolution.financeEvidenceAdoption?.defense.acceptedClaims).toContain("claim_ct_0_1");
    expect(resolution.scores.attack.totalScore).toBe(resolution.scores.attack.csScore);
    expect(resolution.scores.defense.financeFirepowerScore?.participantAcceptedEvidenceRefs).toEqual([]);
    expect(resolution.scores.defense.financeFirepowerScore?.appliedToCombatScore).toBe(0);
    expect(resolution.scores.defense.totalScore).toBe(resolution.scores.defense.csScore);
    expect(resolution.financeProjection).toEqual(expect.objectContaining({
      appliedEffect: "possible_kill",
      financeMayExplainKill: true
    }));
    expect(resolution.casualties[0]).toEqual(expect.objectContaining({
      targetAgentId: "t_0",
      killerAgentId: "ct_0"
    }));
  });

  it("rejects unknown or unavailable finance evidence refs instead of treating field presence as adoption", () => {
    const asset = loadOfficialDust2HexMap();
    const [attackCell, defenseCell] = findCellsInRegion(asset, "a_site", 2);
    const memory = initializeCombatMemory(asset, [
      { agentId: "t_0", side: "attack", cellId: attackCell!.cellId },
      { agentId: "ct_0", side: "defense", cellId: defenseCell!.cellId }
    ]);
    const actions = [
      buildCombatAction({
        memory,
        agentId: "t_0",
        actionType: "execute_site",
        targetCellId: defenseCell!.cellId,
        businessIntent: "质疑引用 F999 和 domestic_inventory，但没有有效事实编号，不能只靠字段存在获得采信。"
      }),
      buildCombatAction({
        memory,
        agentId: "ct_0",
        actionType: "hold_position",
        targetCellId: defenseCell!.cellId,
        businessIntent: "守方只保持位置。"
      })
    ];
    const financeDuel = buildHexRoundFinanceDuel({
      roundNumber: 1,
      attackTeamId: "t",
      defenseTeamId: "ct",
      agents: [
        { agentId: "t_0", teamId: "t", side: "attack", role: "entry" },
        { agentId: "ct_0", teamId: "ct", side: "defense", role: "anchor" }
      ]
    });
    const contact = buildHexCombatContacts({ asset, memory, actions })[0]!;

    const resolution = resolveHexCombat({ asset, memory, contact, actions, financeDuel });

    expect(resolution.financeEvidenceAdoption?.attack.acceptedEvidenceRefs).toEqual([]);
    expect(resolution.financeEvidenceAdoption?.attack.rejectedEvidenceRefs).toEqual([]);
    expect(resolution.financeEvidenceAdoption?.attack.financialResult).toBe("no_financial_win_allowed");
    expect(resolution.scores.attack.financeScore).toBe(0);
    expect(resolution.scores.attack.totalScore).toBe(resolution.scores.attack.csScore);
    expect(resolution.financeProjection).toEqual(expect.objectContaining({
      appliedEffect: "none",
      financeMayExplainKill: false
    }));
    expect(resolution.financeReasons).toEqual(expect.arrayContaining([
      "attack:n59_no_accepted_evidence",
      "finance_verdict:contested_no_finance_resolution"
    ]));
  });

  it("does not present a finance winner when neither side has accepted or missing evidence adoption", () => {
    const asset = loadOfficialDust2HexMap();
    const [attackCell, defenseCell] = findCellsInRegion(asset, "a_site", 2);
    const memory = initializeCombatMemory(asset, [
      { agentId: "t_0", side: "attack", cellId: attackCell!.cellId },
      { agentId: "ct_0", side: "defense", cellId: defenseCell!.cellId }
    ]);
    const actions = [
      buildCombatAction({
        memory,
        agentId: "t_0",
        actionType: "execute_site",
        targetCellId: defenseCell!.cellId,
        businessIntent: "进攻方执行贴近点位的战术动作，但没有引用任何可采信金融证据或证据缺口。"
      }),
      buildCombatAction({
        memory,
        agentId: "ct_0",
        actionType: "hold_position",
        targetCellId: defenseCell!.cellId,
        businessIntent: "守方保持位置，但没有引用任何可采信金融证据或证据缺口。"
      })
    ];
    const financeDuel = buildHexRoundFinanceDuel({
      roundNumber: 1,
      attackTeamId: "t",
      defenseTeamId: "ct",
      agents: [
        { agentId: "t_0", teamId: "t", side: "attack", role: "entry" },
        { agentId: "ct_0", teamId: "ct", side: "defense", role: "anchor" }
      ]
    });
    const contact = buildHexCombatContacts({ asset, memory, actions })[0]!;

    const resolution = resolveHexCombat({ asset, memory, contact, actions, financeDuel });

    expect(resolution.financeEvidenceAdoption?.attack.acceptedEvidenceRefs).toEqual([]);
    expect(resolution.financeEvidenceAdoption?.defense.acceptedEvidenceRefs).toEqual([]);
    expect(resolution.financeEvidenceAdoption?.attack.missingEvidenceApplied).toEqual(expect.arrayContaining(["commodity_price_momentum"]));
    expect(resolution.financeEvidenceAdoption?.defense.missingEvidenceApplied).toEqual(expect.arrayContaining(["commodity_price_momentum"]));
    expect(resolution.financeVerdict).toBe("contested_no_finance_resolution");
    expect(resolution.businessVerdict).toBe("contested_no_business_resolution");
    expect(resolution.scores.attack.totalScore).toBe(resolution.scores.attack.csScore);
    expect(resolution.scores.defense.totalScore).toBe(resolution.scores.defense.csScore);
    expect(resolution.financeProjection).toEqual(expect.objectContaining({
      appliedEffect: "none",
      financeMayExplainKill: false
    }));
    expect(resolution.financeReasons).toContain("finance_verdict:contested_no_finance_resolution");
  });

  it("blocks long-range abstract site contests from becoming kills even with a decisive score margin", () => {
    const asset = loadOfficialDust2HexMap();
    const [attackSiteCell, defenseSiteCell] = findFarSameRegionCells(asset, "b_site");
    const memory = initializeCombatMemory(asset, [
      { agentId: "t_0", side: "attack", cellId: attackSiteCell.cellId },
      { agentId: "ct_0", side: "defense", cellId: defenseSiteCell.cellId }
    ]);
    const actions = [
      buildCombatAction({
        memory,
        agentId: "t_0",
        actionType: "execute_site",
        targetCellId: attackSiteCell.cellId,
        businessIntent: "质疑全球铜价代理事实 F001 不能证明国内库存，挑战守方景气上行假设并远距离施压 A 点。"
      }),
      buildCombatAction({
        memory,
        agentId: "ct_0",
        actionType: "hold_position",
        targetCellId: defenseSiteCell.cellId,
        businessIntent: "",
        valid: false
      })
    ];
    const financeDuel = buildHexRoundFinanceDuel({
      roundNumber: 1,
      attackTeamId: "t",
      defenseTeamId: "ct",
      agents: [
        { agentId: "t_0", teamId: "t", side: "attack", role: "entry" },
        { agentId: "ct_0", teamId: "ct", side: "defense", role: "anchor" }
      ]
    });
    const roundStartAgentOutputs = [
      buildResolverStanceOutput({ evidenceRefs: ["FRED002"] }),
      buildResolverChallengeOutput({ challengeId: "challenge_t_0_1", evidenceRefs: ["FRED002", "FRED003", "FRED004"] }),
      buildResolverChallengeOutput({ challengeId: "challenge_t_1_1", evidenceRefs: ["FRED002", "FRED003"] })
    ];
    const contact = buildHexCombatContacts({ asset, memory, actions })[0]!;

    const resolution = resolveHexCombat({ asset, memory, contact, actions, financeDuel, roundStartAgentOutputs });

    expect(contact.minCellDistance).toBeGreaterThan(3);
    expect(contact.lethalEligible).toBe(false);
    expect(contact.contactThreatLevel).not.toBe("lethal");
    expect(resolution.verdict).not.toBe("kill");
    expect(resolution.casualties).toEqual([]);
    expect(resolution.financeProjection?.blockedEffects).toContain("possible_kill");
    expect(resolution.financeProjection?.financeMayExplainKill).toBe(false);
    expect(resolution.audit.contactThreat?.lethalGateBlockedReasons).toEqual(expect.arrayContaining([
      "distance_exceeds_lethal_gate",
      "abstract_contact_only"
    ]));
  });

  it("upgrades close high-intensity contact into wound or forced-back instead of endless suppression", () => {
    const asset = loadOfficialDust2HexMap();
    const [attackCell, defenseCell, supportCell] = findCellsInRegion(asset, "a_site", 3);
    const memory = initializeCombatMemory(asset, [
      { agentId: "t_0", side: "attack", cellId: attackCell!.cellId },
      { agentId: "t_1", side: "attack", cellId: supportCell!.cellId },
      { agentId: "ct_0", side: "defense", cellId: defenseCell!.cellId }
    ]);
    const actions = [
      buildCombatAction({
        memory,
        agentId: "t_0",
        actionType: "execute_site",
        targetCellId: defenseCell!.cellId,
        businessIntent: "Attack challenge takes direct space and applies a narrow but valid pressure point."
      }),
      buildCombatAction({
        memory,
        agentId: "t_1",
        actionType: "prepare_trade",
        targetCellId: defenseCell!.cellId,
        businessIntent: "Attack challenge prepares limited trade support without becoming the primary duel."
      }),
      buildCombatAction({
        memory,
        agentId: "ct_0",
        actionType: "hold_position",
        targetCellId: defenseCell!.cellId,
        businessIntent: "Defense holds the same point but contributes less active pressure."
      })
    ];
    const contact = buildHexCombatContacts({ asset, memory, actions })[0]!;

    const resolution = resolveHexCombat({ asset, memory, contact, actions });

    expect(contact.lethalEligible).toBe(true);
    expect(contact.contactThreatLevel).toBe("lethal");
    expect(resolution.advantage).toBe("attack");
    expect(resolution.verdict).not.toBe("contested_suppression");
    expect(["wound_or_forced_back", "kill"]).toContain(resolution.verdict);
    expect(resolution.casualties.length + resolution.suppressions.length).toBeGreaterThan(0);
  });

  it("treats open line movement as an implicit lethal duel instead of harmless movement", () => {
    const asset = loadOfficialDust2HexMap();
    const [attackCell, defenseCell] = findOpenSameRegionCells(asset, "a_site");
    const memory = initializeCombatMemory(asset, [
      { agentId: "t_0", side: "attack", cellId: attackCell.cellId },
      { agentId: "ct_0", side: "defense", cellId: defenseCell.cellId }
    ]);
    const actions = [
      buildCombatAction({
        memory,
        agentId: "t_0",
        actionType: "move",
        targetCellId: attackCell.cellId,
        businessIntent: "进攻方移动进入开阔枪线，准备清点并争取换人。"
      }),
      buildCombatAction({
        memory,
        agentId: "ct_0",
        actionType: "rotate",
        targetCellId: defenseCell.cellId,
        businessIntent: "守方转点进入同一开阔枪线，准备守住包点入口。"
      })
    ];

    const contact = buildHexCombatContacts({ asset, memory, actions })[0]!;
    const resolution = resolveHexCombat({ asset, memory, contact, actions });

    expect(contact.minCellDistance).toBeGreaterThan(3);
    expect(contact.minCellDistance).toBeLessThanOrEqual(6);
    expect(contact.openSightNoCover).toBe(true);
    expect(contact.implicitDuelFromMovement).toBe(true);
    expect(contact.lethalEligible).toBe(true);
    expect(contact.contactThreatLevel).toBe("lethal");
    expect(resolution.audit.contactThreat?.lethalGateReasons).toEqual(expect.arrayContaining([
      "open_sight_no_cover",
      "implicit_duel_from_movement"
    ]));
  });

  it("keeps fully symmetric lethal movement as suppression instead of inventing a kill", () => {
    const asset = loadOfficialDust2HexMap();
    const [attackCell, defenseCell] = findOpenSameRegionCells(asset, "a_site");
    const memory = initializeCombatMemory(asset, [
      { agentId: "t_0", side: "attack", cellId: attackCell.cellId },
      { agentId: "ct_0", side: "defense", cellId: defenseCell.cellId }
    ]);
    const actions = [
      buildCombatAction({
        memory,
        agentId: "t_0",
        actionType: "move",
        targetCellId: attackCell.cellId,
        businessIntent: "本阶段执行移动并处理开阔枪线接触风险。"
      }),
      buildCombatAction({
        memory,
        agentId: "ct_0",
        actionType: "move",
        targetCellId: defenseCell.cellId,
        businessIntent: "本阶段执行移动并处理开阔枪线接触风险。"
      })
    ];
    const contact = buildHexCombatContacts({ asset, memory, actions })[0]!;
    for (const participant of contact.participants) {
      participant.currentFlags = [];
      participant.targetFlags = [];
      participant.currentPointIds = [];
      participant.targetPointIds = [];
      participant.roleLabel = "rifler";
    }

    const resolution = resolveHexCombat({ asset, memory, contact, actions });

    expect(resolution.verdict).toBe("contested_suppression");
    expect(resolution.advantage).toBe("contested");
    expect(resolution.casualties).toEqual([]);
    expect(resolution.csReasons).toEqual(expect.arrayContaining([
      "lethal_duel_pressure_tiebreak",
      "symmetric_lethal_duel_no_advantage"
    ]));
  });

  it("uses direct duel pressure to turn tied lethal movement into a kill without randomizing", () => {
    const asset = loadOfficialDust2HexMap();
    const [attackCell, defenseCell] = findOpenSameRegionCells(asset, "a_site");
    const memory = initializeCombatMemory(asset, [
      { agentId: "t_entry", side: "attack", cellId: attackCell.cellId },
      { agentId: "ct_support", side: "defense", cellId: defenseCell.cellId }
    ]);
    const actions = [
      buildCombatAction({
        memory,
        agentId: "t_entry",
        actionType: "move",
        targetCellId: attackCell.cellId,
        businessIntent: "进攻方移动进入开阔枪线，准备争取击杀并换取包点空间。"
      }),
      buildCombatAction({
        memory,
        agentId: "ct_support",
        actionType: "rotate",
        targetCellId: defenseCell.cellId,
        businessIntent: "守方转点进入同一开阔枪线，准备延缓进攻。"
      })
    ];
    const contact = buildHexCombatContacts({ asset, memory, actions })[0]!;
    contact.participants.find((participant) => participant.agentId === "t_entry")!.roleLabel = "entry";
    contact.participants.find((participant) => participant.agentId === "ct_support")!.roleLabel = "igl";

    const resolution = resolveHexCombat({ asset, memory, contact, actions });

    expect(contact.lethalEligible).toBe(true);
    expect(contact.implicitDuelFromMovement).toBe(true);
    expect(resolution.advantage).toBe("attack");
    expect(resolution.verdict).toBe("kill");
    expect(resolution.csReasons).toEqual(expect.arrayContaining([
      "lethal_duel_pressure_tiebreak",
      "direct_duel_pressure_delta_kill"
    ]));
    expect(resolution.csReasons.some((reason) => reason.startsWith("direct_duel_pressure_attack:"))).toBe(true);
    expect(resolution.csReasons.some((reason) => reason.startsWith("direct_duel_pressure_defense:"))).toBe(true);
    expect(resolution.casualties[0]).toEqual(expect.objectContaining({
      targetAgentId: "ct_support",
      killerAgentId: "t_entry"
    }));
  });

  it("turns a one-point direct duel pressure edge into wound or forced-back instead of endless suppression", () => {
    const asset = loadOfficialDust2HexMap();
    const [attackCell, defenseCell] = findOpenSameRegionCells(asset, "a_site");
    const memory = initializeCombatMemory(asset, [
      { agentId: "t_0", side: "attack", cellId: attackCell.cellId },
      { agentId: "ct_0", side: "defense", cellId: defenseCell.cellId }
    ]);
    const actions = [
      buildCombatAction({
        memory,
        agentId: "t_0",
        actionType: "watch_angle",
        targetCellId: attackCell.cellId,
        businessIntent: "进攻方架住开阔枪线，只做有限交火准备。"
      }),
      buildCombatAction({
        memory,
        agentId: "ct_0",
        actionType: "move",
        targetCellId: defenseCell.cellId,
        businessIntent: "守方移动进入同一开阔枪线，争取把压制转成伤害。"
      })
    ];
    const contact = buildHexCombatContacts({ asset, memory, actions })[0]!;

    const resolution = resolveHexCombat({ asset, memory, contact, actions });

    expect(contact.lethalEligible).toBe(true);
    expect(contact.implicitDuelFromMovement).toBe(true);
    expect(resolution.advantage).toBe("defense");
    expect(resolution.verdict).toBe("wound_or_forced_back");
    expect(resolution.csReasons).toEqual(expect.arrayContaining([
      "lethal_duel_pressure_tiebreak",
      "direct_duel_pressure_delta_wound"
    ]));
    expect(resolution.casualties[0]).toEqual(expect.objectContaining({
      targetAgentId: "t_0",
      result: "wounded"
    }));
  });

  it("keeps covered same-region movement out of the lethal gate", () => {
    const asset = loadOfficialDust2HexMap();
    const [attackCell, defenseCell] = findCoveredSameRegionCells(asset, "a_site");
    const memory = initializeCombatMemory(asset, [
      { agentId: "t_0", side: "attack", cellId: attackCell.cellId },
      { agentId: "ct_0", side: "defense", cellId: defenseCell.cellId }
    ]);
    const actions = [
      buildCombatAction({
        memory,
        agentId: "t_0",
        actionType: "move",
        targetCellId: attackCell.cellId,
        businessIntent: "进攻方移动到有掩体的同区域位置，只形成压制试探。"
      }),
      buildCombatAction({
        memory,
        agentId: "ct_0",
        actionType: "rotate",
        targetCellId: defenseCell.cellId,
        businessIntent: "守方借掩体转点，不暴露成可直接击杀的枪线。"
      })
    ];

    const contact = buildHexCombatContacts({ asset, memory, actions })[0]!;
    const resolution = resolveHexCombat({ asset, memory, contact, actions });

    expect(contact.minCellDistance).toBeGreaterThan(3);
    expect(contact.coverBlockedLethal).toBe(true);
    expect(contact.lethalEligible).toBe(false);
    expect(resolution.verdict).not.toBe("kill");
    expect(resolution.casualties).toEqual([]);
    expect(resolution.audit.contactThreat?.lethalGateBlockedReasons).toContain("cover_blocks_lethal");
  });

  it("lets business evidence dominate the first deterministic combat verdict", () => {
    const asset = loadOfficialDust2HexMap();
    const [attackCell, defenseCell, supportCell] = findCellsInRegion(asset, "a_site", 3);
    const memory = initializeCombatMemory(asset, [
      { agentId: "t_0", side: "attack", cellId: attackCell!.cellId },
      { agentId: "t_1", side: "attack", cellId: supportCell!.cellId },
      { agentId: "ct_0", side: "defense", cellId: defenseCell!.cellId }
    ]);
    const actions = [
      buildCombatAction({
        memory,
        agentId: "t_0",
        actionType: "execute_site",
        targetCellId: defenseCell!.cellId,
        businessIntent: "Attack execute applies pressure to exploit the defense response gap at A site."
      }),
      buildCombatAction({
        memory,
        agentId: "t_1",
        actionType: "prepare_trade",
        targetCellId: defenseCell!.cellId,
        businessIntent: "Attack trade support coordinates the same A site pressure."
      }),
      buildCombatAction({
        memory,
        agentId: "ct_0",
        actionType: "hold_position",
        targetCellId: defenseCell!.cellId,
        businessIntent: "",
        valid: false
      })
    ];
    const contact = buildHexCombatContacts({ asset, memory, actions })[0]!;
    const businessDuel = buildFixtureHexRoundBusinessDuel({
      roundNumber: 1,
      attackTeamId: "t",
      defenseTeamId: "ct",
      agents: [
        { agentId: "t_0", teamId: "t", side: "attack" },
        { agentId: "t_1", teamId: "t", side: "attack" },
        { agentId: "ct_0", teamId: "ct", side: "defense" }
      ]
    });

    const resolution = resolveHexCombat({ asset, memory, contact, actions, businessDuel });

    expect(resolution.audit.businessWeight).toBe(65);
    expect(resolution.audit.csWeight).toBe(35);
    expect(resolution.businessVerdict).toBe("challenge_succeeded");
    expect(resolution.scores.attack.businessScore).toBeGreaterThan(resolution.scores.defense.businessScore);
    expect(resolution.advantage).toBe("attack");
    expect(resolution.casualties).toEqual([
      expect.objectContaining({
        agentId: "ct_0",
        targetAgentId: "ct_0",
        result: "killed",
        killerAgentId: "t_0",
        assisterAgentIds: ["t_1"]
      })
    ]);
    expect(resolution.casualties[0]?.attributionReasons).toEqual(expect.arrayContaining(["assist:t_1:support_action"]));
  });

  it("uses role-aware attribution so riflers kill and IGL setup actions assist", () => {
    const asset = loadOfficialDust2HexMap();
    const [entryCell, defenseCell, supportCell] = findCellsInRegion(asset, "a_site", 3);
    const memory = initializeCombatMemory(asset, [
      { agentId: "t_igl", side: "attack", cellId: supportCell!.cellId },
      { agentId: "t_awper", side: "attack", cellId: entryCell!.cellId },
      { agentId: "ct_anchor", side: "defense", cellId: defenseCell!.cellId }
    ]);
    const actions = [
      buildCombatAction({
        memory,
        agentId: "t_igl",
        actionType: "prepare_trade",
        targetCellId: defenseCell!.cellId,
        businessIntent: "Attack challenge coordinates trade support around the A site proof gap."
      }),
      buildCombatAction({
        memory,
        agentId: "t_awper",
        actionType: "peek",
        targetCellId: defenseCell!.cellId,
        businessIntent: "Attack challenge applies direct pick pressure to exploit the defense response gap."
      }),
      buildCombatAction({
        memory,
        agentId: "ct_anchor",
        actionType: "hold_position",
        targetCellId: defenseCell!.cellId,
        businessIntent: "",
        valid: false
      })
    ];
    const businessDuel = buildFixtureHexRoundBusinessDuel({
      roundNumber: 1,
      attackTeamId: "t",
      defenseTeamId: "ct",
      agents: [
        { agentId: "t_igl", teamId: "t", side: "attack" },
        { agentId: "t_awper", teamId: "t", side: "attack" },
        { agentId: "ct_anchor", teamId: "ct", side: "defense" }
      ]
    });
    businessDuel.agentAssignments = businessDuel.agentAssignments.map((assignment) => {
      if (assignment.agentId === "t_igl") return { ...assignment, role: "igl" };
      if (assignment.agentId === "t_awper") return { ...assignment, role: "awper" };
      return assignment;
    });
    const contact = buildHexCombatContacts({ asset, memory, actions, businessDuel })
      .find((candidate) => candidate.attackAgentIds.includes("t_igl") && candidate.attackAgentIds.includes("t_awper"))!;

    const resolution = resolveHexCombat({ asset, memory, contact, actions, businessDuel });

    expect(contact.participants.find((participant) => participant.agentId === "t_igl")?.supportParticipant).toBe(true);
    expect(resolution.casualties[0]).toEqual(expect.objectContaining({
      targetAgentId: "ct_anchor",
      killerAgentId: "t_awper",
      assisterAgentIds: ["t_igl"]
    }));
    expect(resolution.audit.roleContributions).toEqual(expect.arrayContaining([
      expect.objectContaining({ agentId: "t_awper", roleLabel: "awper", contributionType: "killer" }),
      expect.objectContaining({ agentId: "t_igl", roleLabel: "igl", contributionType: "assist" })
    ]));
  });

  it("deprioritizes a recent killer when another direct rifler can take the duel", () => {
    const asset = loadOfficialDust2HexMap();
    const [starCell, defenseCell, riflerCell] = findCellsInRegion(asset, "a_site", 3);
    const memory = initializeCombatMemory(asset, [
      { agentId: "t_star", side: "attack", cellId: starCell!.cellId },
      { agentId: "t_rifler", side: "attack", cellId: riflerCell!.cellId },
      { agentId: "ct_anchor", side: "defense", cellId: defenseCell!.cellId }
    ]);
    const actions = [
      buildCombatAction({
        memory,
        agentId: "t_star",
        actionType: "peek",
        targetCellId: defenseCell!.cellId,
        businessIntent: "Star rifler already has prior kills but still peeks the A site angle."
      }),
      buildCombatAction({
        memory,
        agentId: "t_rifler",
        actionType: "execute_site",
        targetCellId: defenseCell!.cellId,
        businessIntent: "Rifler takes the direct duel and should be available for kill attribution."
      }),
      buildCombatAction({
        memory,
        agentId: "ct_anchor",
        actionType: "hold_position",
        targetCellId: defenseCell!.cellId,
        businessIntent: "",
        valid: false
      })
    ];
    const businessDuel = buildFixtureHexRoundBusinessDuel({
      roundNumber: 1,
      attackTeamId: "t",
      defenseTeamId: "ct",
      agents: [
        { agentId: "t_star", teamId: "t", side: "attack" },
        { agentId: "t_rifler", teamId: "t", side: "attack" },
        { agentId: "ct_anchor", teamId: "ct", side: "defense" }
      ]
    });
    businessDuel.agentAssignments = businessDuel.agentAssignments.map((assignment) => {
      if (assignment.agentId === "t_star") return { ...assignment, role: "star rifler" };
      if (assignment.agentId === "t_rifler") return { ...assignment, role: "rifler" };
      return assignment;
    });
    const contacts = buildHexCombatContacts({ asset, memory, actions, businessDuel });
    const baseContact = contacts.find((candidate) => candidate.attackAgentIds.includes("t_rifler"))!;
    const starParticipant = contacts.flatMap((candidate) => candidate.participants).find((participant) => participant.agentId === "t_star")!;
    const contact = {
      ...baseContact,
      attackAgentIds: [...new Set([...baseContact.attackAgentIds, "t_star"])],
      participants: [
        ...baseContact.participants.map((participant) => participant.agentId === "t_rifler" ? { ...participant, roleLabel: "rifler" } : participant),
        { ...starParticipant, roleLabel: "star_rifler", supportParticipant: false }
      ]
    };

    const resolution = resolveHexCombat({
      asset,
      memory,
      contact,
      actions,
      businessDuel,
      attributionHistory: {
        roundKillCountsByAgent: { t_star: 2 },
        phaseKillCountsByAgent: {},
        lastKillPhaseIndexByAgent: { t_star: contact.phaseIndex }
      }
    });

    expect(resolution.casualties[0]).toEqual(expect.objectContaining({
      targetAgentId: "ct_anchor",
      killerAgentId: "t_rifler"
    }));
    expect(resolution.audit.roleContributions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        agentId: "t_star",
        reasons: expect.arrayContaining(["recent_kill_deprioritized:2", `last_phase_kill_deprioritized:${contact.phaseIndex}`])
      })
    ]));
  });

  it("only lets a setup role become killer when it is the sole direct candidate", () => {
    const asset = loadOfficialDust2HexMap();
    const [attackCell, defenseCell] = findCellsInRegion(asset, "a_site", 2);
    const memory = initializeCombatMemory(asset, [
      { agentId: "t_0", side: "attack", cellId: attackCell!.cellId },
      { agentId: "ct_support", side: "defense", cellId: defenseCell!.cellId }
    ]);
    const actions = [
      buildCombatAction({
        memory,
        agentId: "t_0",
        actionType: "hold_position",
        businessIntent: "",
        valid: false
      }),
      buildCombatAction({
        memory,
        agentId: "ct_support",
        actionType: "map_control",
        targetCellId: attackCell!.cellId,
        businessIntent: "IGL is the only valid defender in this direct contact, so attribution may fall back to it."
      })
    ];
    const contact = buildHexCombatContacts({ asset, memory, actions })[0]!;
    contact.participants.find((participant) => participant.agentId === "ct_support")!.roleLabel = "igl";

    const resolution = resolveHexCombat({ asset, memory, contact, actions });

    expect(resolution.casualties[0]).toEqual(expect.objectContaining({
      targetAgentId: "t_0",
      killerAgentId: "ct_support"
    }));
    expect(resolution.casualties[0]?.attributionReasons).toEqual(expect.arrayContaining([
      "killer:ct_support:role_setup_limited_to_assist",
      "killer:ct_support:sole_direct_candidate_allowed"
    ]));
  });
  it("lets defense proof rebut a weak attack challenge without using fallback as positive business evidence", () => {
    const asset = loadOfficialDust2HexMap();
    const [attackCell, defenseCell] = findCellsInRegion(asset, "a_site", 2);
    const memory = initializeCombatMemory(asset, [
      { agentId: "t_0", side: "attack", cellId: attackCell!.cellId },
      { agentId: "ct_0", side: "defense", cellId: defenseCell!.cellId }
    ]);
    const actions = [
      buildCombatAction({
        memory,
        agentId: "t_0",
        actionType: "hold_position",
        businessIntent: "Attack fallback text claims challenge but should not count.",
        valid: false
      }),
      buildCombatAction({
        memory,
        agentId: "ct_0",
        actionType: "peek",
        targetCellId: attackCell!.cellId,
        businessIntent: "Defense hold 自证 守住 A site and deny the attack challenge."
      })
    ];
    const contact = buildHexCombatContacts({ asset, memory, actions })[0]!;
    const businessDuel = buildFixtureHexRoundBusinessDuel({
      roundNumber: 1,
      attackTeamId: "t",
      defenseTeamId: "ct",
      agents: [
        { agentId: "t_0", teamId: "t", side: "attack" },
        { agentId: "ct_0", teamId: "ct", side: "defense" }
      ]
    });

    const resolution = resolveHexCombat({ asset, memory, contact, actions, businessDuel });

    expect(resolution.businessVerdict).toBe("proof_rebutted_challenge");
    expect(resolution.scores.attack.reasons).toContain("attack:business_fallback_not_positive_evidence");
    expect(resolution.casualties[0]).toEqual(expect.objectContaining({
      targetAgentId: "t_0",
      killerAgentId: "ct_0"
    }));
  });

  it("does not expose round winner, win type, economy delta, or database facts", () => {
    const asset = loadOfficialDust2HexMap();
    const [attackCell, defenseCell] = findCellsInRegion(asset, "b_site", 2);
    const memory = initializeCombatMemory(asset, [
      { agentId: "t_0", side: "attack", cellId: attackCell!.cellId },
      { agentId: "ct_0", side: "defense", cellId: defenseCell!.cellId }
    ]);
    const actions = [
      buildCombatAction({ memory, agentId: "t_0", actionType: "execute_site" }),
      buildCombatAction({ memory, agentId: "ct_0", actionType: "peek" })
    ];
    const contact = buildHexCombatContacts({ asset, memory, actions })[0]!;

    const resolution = resolveHexCombat({ asset, memory, contact, actions });

    expect(Object.prototype.hasOwnProperty.call(resolution, "winner")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(resolution, "roundWinType")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(resolution, "economyDelta")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(resolution, "dbFact")).toBe(false);
  });

  it("records economy evidence without turning low resources into automatic combat failure", () => {
    const asset = loadOfficialDust2HexMap();
    const [attackCell, defenseCell] = findCellsInRegion(asset, "mid_top_mid", 2);
    const memory = initializeCombatMemory(asset, [
      { agentId: "t_0", side: "attack", cellId: attackCell!.cellId },
      { agentId: "ct_0", side: "defense", cellId: defenseCell!.cellId }
    ]);
    const economyContext = buildHexRoundEconomyContext({
      memory,
      teamEconomyPlans: {
        t: buildPlan("t", "eco", "eco", ["t_0"]),
        ct: buildPlan("ct", "rifle_buy", "fullBuy", ["ct_0"])
      }
    });
    const actions = [
      buildCombatAction({
        memory,
        agentId: "t_0",
        actionType: "gather_info",
        businessIntent: "Attack gathers information to challenge the defense response gap without claiming a full execute."
      }),
      buildCombatAction({
        memory,
        agentId: "ct_0",
        actionType: "hold_position",
        businessIntent: "Defense holds mid and tries to deny attack pressure."
      })
    ];
    const contact = buildHexCombatContacts({ asset, memory, actions })[0]!;

    const resolution = resolveHexCombat({ asset, memory, contact, actions, economyContext });

    expect(resolution.audit.economy.economyEvidenceApplied).toBe(true);
    expect(resolution.audit.economy.attack.resourceTiers).toContain("low");
    expect(resolution.audit.economy.defense.resourceTiers).toContain("high");
    expect(resolution.scores.attack.reasons).toEqual(expect.arrayContaining(["attack:economy:low_resource_constraint"]));
    expect(Object.prototype.hasOwnProperty.call(resolution, "economyDelta")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(resolution, "winner")).toBe(false);
  });

  it("does not let audited variance overturn a decisive margin", () => {
    const result = applyHexCombatVariance({
      attackScore: 92,
      defenseScore: 41,
      varianceMode: "audited",
      seed: "decisive-margin"
    });

    expect(result.audit.varianceApplied).toBe(false);
    expect(result.audit.reason).toBe("margin_too_large");
    expect(result.attackScore).toBe(92);
    expect(result.defenseScore).toBe(41);
  });

  it("applies audited variance reproducibly only for close margins", () => {
    const first = applyHexCombatVariance({
      attackScore: 50,
      defenseScore: 49,
      varianceMode: "audited",
      seed: "close-margin"
    });
    const second = applyHexCombatVariance({
      attackScore: 50,
      defenseScore: 49,
      varianceMode: "audited",
      seed: "close-margin"
    });

    expect(first).toEqual(second);
    expect(first.audit.varianceApplied).toBe(true);
    expect(first.audit.varianceDelta).toBeGreaterThanOrEqual(-3);
    expect(first.audit.varianceDelta).toBeLessThanOrEqual(3);
  });

  it("falls back to no variance without an explicit seed", () => {
    const result = applyHexCombatVariance({
      attackScore: 50,
      defenseScore: 49,
      varianceMode: "audited"
    });

    expect(result.audit.varianceApplied).toBe(false);
    expect(result.audit.reason).toBe("missing_seed");
  });

  it("audits many-v-one multi-pair attribution without promoting support as primary", () => {
    const asset = loadOfficialDust2HexMap();
    const [entryCell, tradeCell, defenseCell] = findCellsInRegion(asset, "a_site", 3);
    const memory = initializeCombatMemory(asset, [
      { agentId: "t_entry", side: "attack", cellId: entryCell!.cellId },
      { agentId: "t_trade", side: "attack", cellId: tradeCell!.cellId },
      { agentId: "ct_anchor", side: "defense", cellId: defenseCell!.cellId }
    ]);
    const actions = [
      buildCombatAction({ memory, agentId: "t_entry", actionType: "execute_site", targetCellId: defenseCell!.cellId }),
      buildCombatAction({ memory, agentId: "t_trade", actionType: "peek", targetCellId: defenseCell!.cellId }),
      buildCombatAction({ memory, agentId: "ct_anchor", actionType: "hold_position", targetCellId: defenseCell!.cellId, valid: false })
    ];
    const contact = buildHexCombatContacts({ asset, memory, actions }).find((candidate) => candidate.combatShape === "many_v_one")!;

    const resolution = resolveHexCombat({ asset, memory, contact, actions });

    expect(contact).toBeDefined();
    expect(resolution.audit.multiPairing).toEqual(expect.objectContaining({
      combatShape: "many_v_one",
      attributionMode: "multi_pair",
      surroundedSide: "defense"
    }));
    expect(resolution.audit.multiPairing?.secondaryDuelPairIds.length).toBeGreaterThanOrEqual(1);
    expect(resolution.audit.roleContributions).toEqual(expect.arrayContaining([
      expect.objectContaining({ agentId: "t_entry", reasons: expect.arrayContaining(["n65_primary_duel_pair"]) }),
      expect.objectContaining({ agentId: "t_trade", reasons: expect.arrayContaining(["n65_secondary_duel_pair"]) })
    ]));
    if (resolution.casualties[0]) {
      expect(resolution.casualties[0].targetAgentId).toBe("ct_anchor");
      expect(resolution.casualties[0].killerAgentId).not.toBe("ct_anchor");
    }
  });});

function buildResolverStanceOutput(input: { evidenceRefs?: string[]; claimType?: string } = {}): HexRoundStartAgentOutputForAction {
  const evidenceRefs = input.evidenceRefs ?? ["FRED002"];
  const claimType = input.claimType ?? "commodity_price_momentum";
  const stanceCard: HexFinanceStanceCard = {
    cardId: "stance_ct_0",
    agentId: "ct_0",
    teamSide: "defense",
    decisionQuestionZh: "未来 1-3 个月 A 股有色是否应相对超配？",
    direction: "conditional_bullish",
    target: "A 股有色",
    horizon: "1-3 months",
    confidence: 0.62,
    positionSuggestion: "moderate_overweight",
    coreClaims: [{
      claimId: "claim_ct_0_1",
      claimType,
      claimZh: "商品价格动量支持有色配置线索。",
      evidenceRefs,
      reasoningBridge: "全球价格动量需要通过权益传导和估值约束后，才能支持 A 股有色配置。",
      confidence: 0.62,
      unsupportedIfEvidenceRejected: true
    }],
    riskBoundaries: ["缺少库存或权益传导证据时只能降权。"],
    invalidatingConditions: ["商品价格动量回落。"],
    auditSummaryZh: "ct_0 输出结构化立场卡。"
  };
  return {
    outputId: "round_start_ct_0",
    agentId: "ct_0",
    usableForPhaseAction: true,
    openingStatementZh: stanceCard.auditSummaryZh,
    evidenceRefs,
    riskBoundaryZh: stanceCard.riskBoundaries.join("；"),
    buyConstraintAppliedZh: "买型允许中等强度配置表达。",
    phaseActionCarryoverZh: "后续 phase 只能引用 claim_ct_0_1。",
    source: "fixture_response",
    cardKind: "stance",
    stanceCard,
    cardSummaryZh: stanceCard.auditSummaryZh,
    allowedPhaseRefs: { claimIds: ["claim_ct_0_1"], challengeIds: [] }
  };
}

function buildResolverChallengeOutput(input: { challengeId: string; evidenceRefs: string[]; reason?: string }): HexRoundStartAgentOutputForAction {
  const challengeCard: HexFinanceChallengeCard = {
    cardId: `challenge_card_${input.challengeId}`,
    agentId: "t_0",
    teamSide: "attack",
    targetClaimId: "claim_ct_0_1",
    challengeType: "proxy_mismatch",
    challengedAssumption: "全球商品价格动量可以直接推出 A 股有色配置。",
    evidenceRefs: input.evidenceRefs,
    proxyMismatch: "FRED 商品价格只能说明全球价格动量，不能确认 A 股有色盈利传导。",
    confidenceReduction: 0.25,
    challenges: [{
      challengeId: input.challengeId,
      targetClaimId: "claim_ct_0_1",
      challengeType: "proxy_mismatch",
      evidenceRefs: input.evidenceRefs,
      challengeReasonZh: input.reason ?? "该 claim 只用全球价格动量支持全有色配置，存在 proxy_mismatch，不能直接推出 A 股盈利传导。",
      expectedEffect: "降低 commodity_to_equity_transmission 的置信度。"
    }],
    auditSummaryZh: "t_0 输出结构化挑战卡。"
  };
  return {
    outputId: `round_start_${input.challengeId}`,
    agentId: "t_0",
    usableForPhaseAction: true,
    openingStatementZh: challengeCard.auditSummaryZh,
    evidenceRefs: input.evidenceRefs,
    riskBoundaryZh: challengeCard.proxyMismatch,
    buyConstraintAppliedZh: "买型允许挑战核心 claim。",
    phaseActionCarryoverZh: `后续 phase 只能引用 ${input.challengeId}。`,
    source: "fixture_response",
    cardKind: "challenge",
    challengeCard,
    cardSummaryZh: challengeCard.auditSummaryZh,
    allowedPhaseRefs: { claimIds: [], challengeIds: [input.challengeId] }
  };
}
function buildPlan(
  teamId: string,
  posture: TeamEconomyPlan["posture"],
  buyType: TeamEconomyPlan["summaryBuyType"],
  agentIds: string[]
): TeamEconomyPlan {
  return {
    teamId,
    side: teamId === "ct" ? "defense" : "attack",
    phase: "gun_round",
    lossCount: 0,
    posture,
    postureReason: "combat economy test",
    summaryBuyType: buyType,
    totalCash: buyType === "eco" ? 1000 : 12000,
    dropDecisions: [],
    decisions: agentIds.map((agentId) => ({
      agentId,
      teamId,
      tokenBankBefore: buyType === "eco" ? 1000 : 6000,
      tokenBankAfterDrop: buyType === "eco" ? 1000 : 6000,
      buyType,
      economyPosture: posture,
      loadoutPackage: buyType === "eco" ? "pistol_round_pack" : "rifle_full_t_pack",
      spend: buyType === "eco" ? 800 : 4500,
      outputBudget: buyType === "eco" ? 420 : 1200,
      dropSent: 0,
      dropReceived: 0,
      notes: []
    }))
  };
}

function findFarSameRegionCells(asset: ReturnType<typeof loadOfficialDust2HexMap>, regionId: string) {
  const candidates = asset.cells.filter((cell) => cell.playable && cell.regionId === regionId);
  for (const left of candidates) {
    for (const right of candidates) {
      if (left.cellId === right.cellId) {
        continue;
      }
      if (left.pointIds.some((pointId) => right.pointIds.includes(pointId))) {
        continue;
      }
      const path = findHexPath({ asset, fromCellId: left.cellId, toCellId: right.cellId });
      if (path.reachable && path.cellDistance > 6) {
        return [left, right] as const;
      }
    }
  }
  throw new Error(`No far ${regionId} cells found`);
}

function findOpenSameRegionCells(asset: ReturnType<typeof loadOfficialDust2HexMap>, regionId: string) {
  const candidates = asset.cells.filter((cell) =>
    cell.playable && cell.regionId === regionId && !cell.flags.includes("cover")
  );
  for (const left of candidates) {
    for (const right of candidates) {
      if (left.cellId === right.cellId) {
        continue;
      }
      const path = findHexPath({ asset, fromCellId: left.cellId, toCellId: right.cellId });
      if (path.reachable && path.cellDistance > 3 && path.cellDistance <= 6) {
        return [left, right] as const;
      }
    }
  }
  throw new Error(`No open same-region ${regionId} cells found`);
}

function findCoveredSameRegionCells(asset: ReturnType<typeof loadOfficialDust2HexMap>, regionId: string) {
  const candidates = asset.cells.filter((cell) => cell.playable && cell.regionId === regionId);
  for (const left of candidates) {
    for (const right of candidates) {
      if (left.cellId === right.cellId) {
        continue;
      }
      if (!left.flags.includes("cover") && !right.flags.includes("cover")) {
        continue;
      }
      if (left.pointIds.some((pointId) => right.pointIds.includes(pointId))) {
        continue;
      }
      const path = findHexPath({ asset, fromCellId: left.cellId, toCellId: right.cellId });
      if (path.reachable && path.cellDistance > 3 && path.cellDistance <= 6) {
        return [left, right] as const;
      }
    }
  }
  throw new Error(`No covered same-region ${regionId} cells found`);
}
