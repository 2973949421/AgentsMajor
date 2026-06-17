import { describe, expect, it } from "vitest";

import type { TeamEconomyPlan } from "../../economy/economy-rules.js";
import { buildFixtureHexRoundBusinessDuel } from "../business/index.js";
import { buildHexRoundEconomyContext } from "../economy/index.js";
import { buildHexRoundFinanceDuel } from "../finance/index.js";
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
    const contact = buildHexCombatContacts({ asset, memory, actions })[0]!;

    const resolution = resolveHexCombat({ asset, memory, contact, actions, financeDuel });

    expect(resolution.financeVerdict).toBe("challenge_landed");
    expect(resolution.businessVerdict).toBe("challenge_succeeded");
    expect(resolution.audit.financeEvidenceApplied).toBe(true);
    expect(resolution.scores.attack.financeScore).toBeGreaterThan(resolution.scores.defense.financeScore ?? 0);
    expect(resolution.financeReasons).toEqual(expect.arrayContaining([
      "attack:finance_evidence_reference_used",
      "attack:finance_missing_evidence_applied",
      "finance_verdict:challenge_landed"
    ]));
    expect(resolution.financeEvidenceAdoption?.attack.acceptedEvidenceRefs).toEqual(expect.arrayContaining(["F001", "F002"]));
    expect(resolution.financeEvidenceAdoption?.attack.missingEvidenceApplied).toContain("domestic_inventory");
    expect(resolution.financeEvidenceAdoption?.attack.scoreCapRefs).toContain("proxy_fact_boundary");
    expect(resolution.financeReasonZh).toEqual(expect.arrayContaining([
      expect.stringContaining("攻方采信证据")
    ]));
    expect(resolution.casualties[0]).toEqual(expect.objectContaining({
      targetAgentId: "ct_0",
      killerAgentId: "t_0",
      assisterAgentIds: ["t_1"]
    }));
    expect(resolution.casualties[0]?.attributionReasons).toEqual(expect.arrayContaining(["killer:t_0:finance_evidence_reference_used"]));
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
    const contact = buildHexCombatContacts({ asset, memory, actions })[0]!;

    const resolution = resolveHexCombat({ asset, memory, contact, actions, financeDuel });

    expect(resolution.financeVerdict).toBe("thesis_defended");
    expect(resolution.businessVerdict).toBe("proof_rebutted_challenge");
    expect(resolution.financeReasons).toEqual(expect.arrayContaining([
      "attack:finance_fallback_not_positive_evidence",
      "attack:finance_no_accepted_evidence",
      "defense:finance_evidence_reference_used",
      "finance_verdict:thesis_defended"
    ]));
    expect(resolution.financeEvidenceAdoption?.attack.acceptedEvidenceRefs).toEqual([]);
    expect(resolution.financeEvidenceAdoption?.attack.rejectionReasons).toContain("fallback_not_positive_finance_evidence");
    expect(resolution.financeEvidenceAdoption?.defense.acceptedEvidenceRefs).toContain("F001");
    expect(resolution.financeEvidenceAdoption?.defense.missingEvidenceApplied).toContain("domestic_inventory");
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
    expect(resolution.financeEvidenceAdoption?.attack.rejectedEvidenceRefs).toContain("F999:unknown_evidence_ref");
    expect(resolution.financeEvidenceAdoption?.attack.missingEvidenceApplied).toContain("domestic_inventory");
    expect(resolution.scores.attack.financeScore).toBeLessThan(65);
    expect(resolution.financeReasons).toEqual(expect.arrayContaining([
      "attack:finance_evidence_ref_rejected",
      "attack:finance_score_cap_applied_without_evidence_reference"
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
    expect(resolution.financeEvidenceAdoption?.attack.missingEvidenceApplied).toEqual([]);
    expect(resolution.financeEvidenceAdoption?.defense.missingEvidenceApplied).toEqual([]);
    expect(resolution.financeVerdict).toBe("contested_no_finance_resolution");
    expect(resolution.businessVerdict).toBe("contested_no_business_resolution");
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
    const contact = buildHexCombatContacts({ asset, memory, actions })[0]!;

    const resolution = resolveHexCombat({ asset, memory, contact, actions, financeDuel });

    expect(contact.minCellDistance).toBeGreaterThan(3);
    expect(contact.lethalEligible).toBe(false);
    expect(contact.contactThreatLevel).not.toBe("lethal");
    expect(resolution.verdict).not.toBe("kill");
    expect(resolution.casualties).toEqual([]);
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

  it("uses role-aware attribution so riflers kill and IGL/support players assist", () => {
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
});

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
      if (path.reachable && path.cellDistance > 3) {
        return [left, right] as const;
      }
    }
  }
  throw new Error(`No far ${regionId} cells found`);
}
