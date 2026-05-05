import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const materialsRoot = path.resolve(__dirname, "..");
const processedRoot = path.join(materialsRoot, "processed");
const teamsRoot = path.join(processedRoot, "teams");
const indexesRoot = path.join(processedRoot, "indexes");
const styleRoot = path.join(processedRoot, "style");
const llmRoot = path.join(processedRoot, "llm");
const roleSourcePath = path.join(materialsRoot, "raw", "teams", "agent_major_player_roles.md");

const VERSION = "2026-05-03-canon-v1";
const SNAPSHOT_DATE = "2026-05-02";
const LLM_BINDING_VERSION = "2026-05-03-llm-binding-v1";
const LLM_BINDING_SCOPE = "asset_preallocation";
const LLM_RUNTIME_ENABLED = false;
const LLM_DRIVER_REGISTRY_REF = "packages/llm/src/model-registry.ts";
const LLM_ENV_CONTRACT_REFS = [
  "AGENT_MAJOR_REAL_LLM_ENABLED",
  "AGENT_MAJOR_LLM_PROVIDER",
  "DASHSCOPE_BASE_URL",
  "DASHSCOPE_API_KEY"
];

const llmModelProfiles = [
  {
    id: "llm_profile_strong_reasoning",
    label: "Strong reasoning",
    summary: "News, profile cards, round reports, and narrative judgement.",
    primary_driver_model_id: "driver_qwen_3_max_2026_01_23",
    fallback_driver_model_ids: ["driver_qwen_3_6_plus"],
    task_ids: ["profile_card_copy", "news_story_copy", "round_report_material", "tactical_analysis_note"],
    runtime_enabled: false,
    default_temperature: 0.4,
    default_max_output_tokens: 900
  },
  {
    id: "llm_profile_caster_expressive",
    label: "Caster expressive",
    summary: "Caster voice, interview voice, and high-emotion broadcast copy.",
    primary_driver_model_id: "driver_kimi_k2_5",
    fallback_driver_model_ids: ["driver_qwen_3_6_plus"],
    task_ids: ["broadcast_caster_line", "interview_voice", "spotlight_moment_copy"],
    runtime_enabled: false,
    default_temperature: 0.6,
    default_max_output_tokens: 500
  },
  {
    id: "llm_profile_barrage_chaos",
    label: "Barrage chaos",
    summary: "Live-room barrage, meme lines, short reactions, and chaotic callbacks.",
    primary_driver_model_id: "driver_minimax_m2_5",
    fallback_driver_model_ids: ["driver_qwen_3_5_plus"],
    task_ids: ["barrage_style_line", "meme_reaction_line"],
    runtime_enabled: false,
    default_temperature: 0.7,
    default_max_output_tokens: 450
  },
  {
    id: "llm_profile_conservative_judge_reserved",
    label: "Conservative judge reserved",
    summary: "Judge, arbiter, and analysis reservation only. Disabled for v1.",
    primary_driver_model_id: "driver_glm_5",
    fallback_driver_model_ids: ["driver_glm_4_7"],
    task_ids: ["judge_note_reserved", "arbiter_note_reserved"],
    runtime_enabled: false,
    default_temperature: 0.2,
    default_max_output_tokens: 900
  },
  {
    id: "llm_profile_agent_action_reserved",
    label: "Agent action reserved",
    summary: "Future agent action planning and repair reservation only. Disabled for v1.",
    primary_driver_model_id: "driver_qwen_3_coder_next",
    fallback_driver_model_ids: ["driver_qwen_3_coder_plus"],
    task_ids: ["agent_action_planning_reserved", "repair_note_reserved"],
    runtime_enabled: false,
    default_temperature: 0.3,
    default_max_output_tokens: 700
  }
];

const llmModelProfileMap = new Map(llmModelProfiles.map((profile) => [profile.id, profile]));

const llmRoleBindingTemplates = {
  igl: {
    template_id: "llm_role_template_igl",
    role: "igl",
    summary: "Strong reasoning first for calling, tactical narrative, news, and review.",
    preferred_driver_model_id: "driver_qwen_3_max_2026_01_23",
    fallback_driver_model_ids: ["driver_qwen_3_6_plus"],
    prompt_bias_tags: ["shotcaller", "system-brain", "tempo-control", "mid-round-logic"],
    task_bindings: [
      { task_id: "profile_card_copy", model_profile_id: "llm_profile_strong_reasoning" },
      { task_id: "news_story_copy", model_profile_id: "llm_profile_strong_reasoning" },
      { task_id: "tactical_analysis_note", model_profile_id: "llm_profile_strong_reasoning" },
      { task_id: "broadcast_caster_line", model_profile_id: "llm_profile_caster_expressive" }
    ],
    ops_notes: ["Use command perspective and tempo-control framing."]
  },
  awper: {
    template_id: "llm_role_template_awper",
    role: "awper",
    summary: "Expressive caster profile plus reasoning for clutch, AWP pressure, and highlight copy.",
    preferred_driver_model_id: "driver_kimi_k2_5",
    fallback_driver_model_ids: ["driver_qwen_3_6_plus"],
    prompt_bias_tags: ["precision-core", "high-leverage", "single-point-pressure", "clutch-risk"],
    task_bindings: [
      { task_id: "profile_card_copy", model_profile_id: "llm_profile_strong_reasoning" },
      { task_id: "news_story_copy", model_profile_id: "llm_profile_strong_reasoning" },
      { task_id: "broadcast_caster_line", model_profile_id: "llm_profile_caster_expressive" },
      { task_id: "spotlight_moment_copy", model_profile_id: "llm_profile_caster_expressive" }
    ],
    ops_notes: ["Prioritize key-shot, clutch, and single-round pressure hooks."]
  },
  star_rifler: {
    template_id: "llm_role_template_star_rifler",
    role: "star_rifler",
    summary: "Expressive star framing with news hooks for headline rifle impact.",
    preferred_driver_model_id: "driver_kimi_k2_5",
    fallback_driver_model_ids: ["driver_qwen_3_6_plus"],
    prompt_bias_tags: ["headline-core", "win-condition", "impact-rifle", "resource-heavy"],
    task_bindings: [
      { task_id: "profile_card_copy", model_profile_id: "llm_profile_strong_reasoning" },
      { task_id: "news_story_copy", model_profile_id: "llm_profile_strong_reasoning" },
      { task_id: "broadcast_caster_line", model_profile_id: "llm_profile_caster_expressive" },
      { task_id: "spotlight_moment_copy", model_profile_id: "llm_profile_caster_expressive" }
    ],
    ops_notes: ["Use star heat and resource-pressure framing."]
  },
  entry: {
    template_id: "llm_role_template_entry",
    role: "entry",
    summary: "Barrage and caster first for opening-duel volatility and live-room effect.",
    preferred_driver_model_id: "driver_minimax_m2_5",
    fallback_driver_model_ids: ["driver_qwen_3_5_plus"],
    prompt_bias_tags: ["frontline-instigator", "first-contact", "space-creator", "high-variance"],
    task_bindings: [
      { task_id: "profile_card_copy", model_profile_id: "llm_profile_strong_reasoning" },
      { task_id: "broadcast_caster_line", model_profile_id: "llm_profile_caster_expressive" },
      { task_id: "barrage_style_line", model_profile_id: "llm_profile_barrage_chaos" },
      { task_id: "meme_reaction_line", model_profile_id: "llm_profile_barrage_chaos" }
    ],
    ops_notes: ["Prefer first-contact, overpeek, space creation, and instant reaction hooks."]
  },
  lurker: {
    template_id: "llm_role_template_lurker",
    role: "lurker",
    summary: "Reasoning plus caster for timing, late-round logic, and map-read storytelling.",
    preferred_driver_model_id: "driver_qwen_3_max_2026_01_23",
    fallback_driver_model_ids: ["driver_qwen_3_6_plus"],
    prompt_bias_tags: ["timing-hunter", "map-reader", "late-round", "flank-punish"],
    task_bindings: [
      { task_id: "profile_card_copy", model_profile_id: "llm_profile_strong_reasoning" },
      { task_id: "news_story_copy", model_profile_id: "llm_profile_strong_reasoning" },
      { task_id: "tactical_analysis_note", model_profile_id: "llm_profile_strong_reasoning" },
      { task_id: "broadcast_caster_line", model_profile_id: "llm_profile_caster_expressive" }
    ],
    ops_notes: ["Use timing, information gap, and late-round payoff framing."]
  },
  support: {
    template_id: "llm_role_template_support",
    role: "support",
    summary: "Stable narrative for utility, trade layers, and team glue copy.",
    preferred_driver_model_id: "driver_qwen_3_6_plus",
    fallback_driver_model_ids: ["driver_qwen_3_5_plus"],
    prompt_bias_tags: ["glue-piece", "utility-worker", "trade-layer", "setup-support"],
    task_bindings: [
      { task_id: "profile_card_copy", model_profile_id: "llm_profile_strong_reasoning" },
      { task_id: "broadcast_caster_line", model_profile_id: "llm_profile_caster_expressive" },
      { task_id: "barrage_style_line", model_profile_id: "llm_profile_barrage_chaos" }
    ],
    ops_notes: ["Keep framing around utility, spacing, and invisible value."]
  },
  rifler: {
    template_id: "llm_role_template_rifler",
    role: "rifler",
    summary: "Balanced default player template and fallback for ordinary rifle roles.",
    preferred_driver_model_id: "driver_qwen_3_6_plus",
    fallback_driver_model_ids: ["driver_qwen_3_5_plus"],
    prompt_bias_tags: ["rifle-worker", "round-connector", "site-pressure", "trade-layer"],
    task_bindings: [
      { task_id: "profile_card_copy", model_profile_id: "llm_profile_strong_reasoning" },
      { task_id: "broadcast_caster_line", model_profile_id: "llm_profile_caster_expressive" },
      { task_id: "barrage_style_line", model_profile_id: "llm_profile_barrage_chaos" }
    ],
    ops_notes: ["Use as the default player fallback when no sharper role is available."]
  },
  stand_in: {
    template_id: "llm_role_template_stand_in",
    role: "stand_in",
    summary: "Temporary identity template. Avoid overfitting long-term persona.",
    preferred_driver_model_id: "driver_qwen_3_6_plus",
    fallback_driver_model_ids: ["driver_qwen_3_5_plus"],
    prompt_bias_tags: ["temporary-slot", "volatile-interface", "low-context", "adaptation"],
    task_bindings: [
      { task_id: "profile_card_copy", model_profile_id: "llm_profile_strong_reasoning" },
      { task_id: "broadcast_caster_line", model_profile_id: "llm_profile_caster_expressive" },
      { task_id: "barrage_style_line", model_profile_id: "llm_profile_barrage_chaos" }
    ],
    ops_notes: ["Do not lock permanent persona assumptions until canon confirms the slot."]
  },
  coach: {
    template_id: "llm_role_template_coach",
    role: "coach",
    summary: "Reasoning and reserved judge profile for tactical explanation, review, and interview context.",
    preferred_driver_model_id: "driver_qwen_3_max_2026_01_23",
    fallback_driver_model_ids: ["driver_qwen_3_6_plus"],
    prompt_bias_tags: ["system-adult", "timeout-fix", "prep", "review"],
    task_bindings: [
      { task_id: "profile_card_copy", model_profile_id: "llm_profile_strong_reasoning" },
      { task_id: "news_story_copy", model_profile_id: "llm_profile_strong_reasoning" },
      { task_id: "tactical_analysis_note", model_profile_id: "llm_profile_strong_reasoning" },
      { task_id: "judge_note_reserved", model_profile_id: "llm_profile_conservative_judge_reserved" }
    ],
    ops_notes: ["Runtime judge and arbiter usage stays disabled in v1."]
  }
};

const styleLabelMap = {
  machine_force_buy_shock: "强起震动",
  machine_map_point_pressure: "图点压强",
  machine_star_carry: "明星位兜底",
  machine_old_guard_command: "老将开会",
  machine_special_invite_drama: "特邀流量戏剧",
  machine_asia_charge: "亚洲冲锋",
  streamer_targeting: "主播迫害",
  player_targeting: "选手迫害",
  mutual_flame: "水友互喷",
  plus_one: "+1 复读",
  research: "研发梗",
  history_burden: "历史包袱",
  old_guard: "老登叙事",
  big_dad: "大爹兜底",
  special_invite: "特邀流量戏剧",
  cross_circle: "跨圈梗",
  official_notice: "官方公告",
  special_invite: "特邀递补",
  "title-favorite": "争冠热门",
  "upset-watch": "爆冷预警",
  "old-guard-last-dance": "老登最后一舞",
  "asia-rise": "亚洲冲锋",
  "brazil-heat": "巴西热度",
  "money-superteam": "银河战舰",
  "history-burden": "历史包袱",
  "research-chaos": "研发失控",
  band_to_superteam: "组豪阵 / 银河战舰",
  breakup_to_transfer: "双核裂开 / 转会风波",
  lifetime_to_rivalry: "宿命对位 / 再打一辈子",
  customer_service_to_cleanup: "兜底救火 / 收拾烂摊子",
  cabinet_to_live_room_chaos: "直播间群魔乱舞"
};

const roleDefaults = {
  igl: {
    personaTags: ["shotcaller", "system-brain"],
    playstyleTags: ["mid-round-call", "tempo-control"],
    casterFocusTags: ["machine_old_guard_command"],
    barrageFocusTags: ["player_targeting", "old_guard"],
    crossCircleTags: ["customer_service_to_cleanup"]
  },
  awper: {
    personaTags: ["precision-core", "high-leverage"],
    playstyleTags: ["awp-control", "single-point-pressure"],
    casterFocusTags: ["machine_star_carry"],
    barrageFocusTags: ["player_targeting", "big_dad"],
    crossCircleTags: ["customer_service_to_cleanup"]
  },
  rifler: {
    personaTags: ["rifle-worker", "round-connector"],
    playstyleTags: ["rifle-trade", "site-pressure"],
    casterFocusTags: ["machine_map_point_pressure"],
    barrageFocusTags: ["player_targeting"],
    crossCircleTags: ["customer_service_to_cleanup"]
  },
  star_rifler: {
    personaTags: ["headline-core", "win-condition"],
    playstyleTags: ["impact-rifle", "resource-heavy"],
    casterFocusTags: ["machine_star_carry"],
    barrageFocusTags: ["player_targeting"],
    crossCircleTags: ["band_to_superteam"]
  },
  entry: {
    personaTags: ["frontline-instigator", "heat-checker"],
    playstyleTags: ["first-contact", "space-creator"],
    casterFocusTags: ["machine_force_buy_shock"],
    barrageFocusTags: ["player_targeting", "research"],
    crossCircleTags: ["cabinet_to_live_room_chaos"]
  },
  star: {
    personaTags: ["headline-core", "win-condition"],
    playstyleTags: ["high-impact", "space-winning"],
    casterFocusTags: ["machine_star_carry"],
    barrageFocusTags: ["player_targeting"],
    crossCircleTags: ["band_to_superteam"]
  },
  closer: {
    personaTags: ["late-round-finisher", "calm-core"],
    playstyleTags: ["clutch-finish", "hold-angle"],
    casterFocusTags: ["machine_star_carry"],
    barrageFocusTags: ["player_targeting"],
    crossCircleTags: ["customer_service_to_cleanup"]
  },
  support: {
    personaTags: ["glue-piece", "utility-worker"],
    playstyleTags: ["trade-layer", "utility-setup"],
    casterFocusTags: ["machine_map_point_pressure"],
    barrageFocusTags: ["player_targeting"],
    crossCircleTags: ["customer_service_to_cleanup"]
  },
  lurker: {
    personaTags: ["timing-hunter", "map-reader"],
    playstyleTags: ["late-map-control", "timing-punish"],
    casterFocusTags: ["machine_star_carry"],
    barrageFocusTags: ["player_targeting"],
    crossCircleTags: ["lifetime_to_rivalry"]
  },
  anchor: {
    personaTags: ["site-anchor", "stability-checker"],
    playstyleTags: ["site-hold", "defensive-proof"],
    casterFocusTags: ["machine_map_point_pressure"],
    barrageFocusTags: ["player_targeting"],
    crossCircleTags: ["customer_service_to_cleanup"]
  },
  flex: {
    personaTags: ["role-adapter", "multi-context"],
    playstyleTags: ["flex-route", "context-fill"],
    casterFocusTags: ["machine_map_point_pressure"],
    barrageFocusTags: ["player_targeting"],
    crossCircleTags: ["customer_service_to_cleanup"]
  },
  stand_in: {
    personaTags: ["temporary-slot", "volatile-interface"],
    playstyleTags: ["adaptation", "limited-context"],
    casterFocusTags: ["machine_special_invite_drama"],
    barrageFocusTags: ["special_invite", "player_targeting"],
    crossCircleTags: ["cabinet_to_live_room_chaos"]
  },
  coach: {
    personaTags: ["system-adult", "reset-point"],
    playstyleTags: ["prep", "timeout-fix"],
    casterFocusTags: ["machine_old_guard_command"],
    barrageFocusTags: ["old_guard"],
    crossCircleTags: ["customer_service_to_cleanup"]
  }
};

const roleResponsibilityMap = {
  igl: "战术规划 / 回合策略 / 资源分配",
  awper: "高精度关键论点 / 单点突破 / 高风险高收益调用",
  entry: "首轮出击 / 激进创意 / 打开局面",
  star_rifler: "核心输出 / 关键回合 carry",
  lurker: "反制 / 偷点 / 找对手逻辑漏洞",
  support: "补全细节 / 修复方案 / 提供上下文",
  anchor: "防守型论证 / 稳定性校验",
  rifler: "通用火力 / 回合执行 / 补枪衔接",
  flex: "多场景适配 / 缺口填补 / 角色切换",
  stand_in: "临时接入 / 快速适配 / 低上下文执行",
  closer: "残局处理 / 压力判断 / 终局收束",
  coach: "战术暂停 / 赛前准备 / 赛后复盘"
};

function normalizeRoleTag(value) {
  const lower = value.trim().toLowerCase();
  if (!lower) {
    return null;
  }
  if (lower.includes("coach")) {
    return "coach";
  }
  if (lower.includes("stand-in") || lower.includes("stand in")) {
    return "stand_in";
  }
  if (lower.includes("igl") || lower.includes("caller")) {
    return "igl";
  }
  if (lower.includes("awper") || lower.includes("awp") || lower.includes("狙")) {
    return "awper";
  }
  if (lower.includes("star rifler") || lower === "star" || lower.includes("young firepower") || lower.includes("playmaker")) {
    return "star_rifler";
  }
  if (lower.includes("entry")) {
    return "entry";
  }
  if (lower.includes("lurker")) {
    return "lurker";
  }
  if (lower.includes("support")) {
    return "support";
  }
  if (lower.includes("anchor")) {
    return "anchor";
  }
  if (lower.includes("flex")) {
    return "flex";
  }
  if (lower.includes("closer")) {
    return "closer";
  }
  if (lower.includes("rifler")) {
    return "rifler";
  }
  return lower.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || null;
}

function parseRoleParts(rawPosition) {
  const rawParts = rawPosition.split("/").map((part) => part.trim()).filter(Boolean);
  const normalizedTags = uniq(rawParts.map(normalizeRoleTag));
  const primaryRole = normalizedTags[0] ?? "rifler";
  return {
    rawParts,
    normalizedTags,
    primaryRole,
    secondaryRoles: normalizedTags.slice(1)
  };
}

function roleProfileKey(teamName, inGameId) {
  return `${teamName.toLowerCase()}::${inGameId.toLowerCase()}`;
}

function loadRoleProfiles() {
  if (!fs.existsSync(roleSourcePath)) {
    return new Map();
  }

  const profiles = new Map();
  let currentTeam = null;
  const lines = fs.readFileSync(roleSourcePath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const section = line.match(/^##\s+\d+\.\s+(.+?)\s+←/);
    if (section) {
      currentTeam = section[1].trim();
      continue;
    }

    if (!currentTeam || !line.startsWith("|")) {
      continue;
    }

    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 5 || cells[0] === "成员" || cells[0].startsWith("---")) {
      continue;
    }

    const [memberType, inGameId, rawPosition, confidence, notes] = cells;
    if (!["选手", "教练"].includes(memberType)) {
      continue;
    }

    const parsed = parseRoleParts(rawPosition);
    profiles.set(roleProfileKey(currentTeam, inGameId), {
      source_path: "raw/teams/agent_major_player_roles.md",
      source_team_name: currentTeam,
      member_type: memberType === "教练" ? "coach" : "player",
      raw_position: rawPosition,
      raw_position_parts: parsed.rawParts,
      primary_role: parsed.primaryRole,
      secondary_roles: parsed.secondaryRoles,
      position_tags: parsed.normalizedTags,
      confidence,
      notes,
      agent_major_responsibilities: uniq(parsed.normalizedTags.map((tag) => roleResponsibilityMap[tag]).filter(Boolean))
    });
  }

  return profiles;
}

function uniq(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeText(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${value.trim()}\n`, "utf8");
}

function profileForTaskBinding(taskBinding) {
  const profile = llmModelProfileMap.get(taskBinding.model_profile_id);
  if (!profile) {
    throw new Error(`Unknown LLM model profile id: ${taskBinding.model_profile_id}`);
  }
  return profile;
}

function makeLlmTaskBinding(taskBinding) {
  const profile = profileForTaskBinding(taskBinding);
  return {
    task_id: taskBinding.task_id,
    model_profile_id: profile.id,
    driver_model_id: profile.primary_driver_model_id,
    fallback_driver_model_ids: [...profile.fallback_driver_model_ids],
    enabled: false,
    temperature: profile.default_temperature,
    max_output_tokens: profile.default_max_output_tokens
  };
}

function resolveLlmRoleTemplate(role, entityType) {
  return llmRoleBindingTemplates[role]
    ?? (entityType === "coach" ? llmRoleBindingTemplates.coach : llmRoleBindingTemplates.rifler);
}

function shouldApplySpotlightOverride(spec) {
  return spec.heatLevel === "high" && spec.cardPriority <= 20;
}

function makeSpotlightOverrideId(entityId) {
  return `llm_override_spotlight_${entityId}`;
}

function makeFutureDriverBinding({ entityId, entityType, role, promptBiasTags, spec }) {
  const template = resolveLlmRoleTemplate(role, entityType);
  const taskBindings = template.task_bindings.map(makeLlmTaskBinding);
  const overrideIds = [];

  if (shouldApplySpotlightOverride(spec) && !taskBindings.some((item) => item.task_id === "spotlight_moment_copy")) {
    taskBindings.push(makeLlmTaskBinding({
      task_id: "spotlight_moment_copy",
      model_profile_id: "llm_profile_caster_expressive"
    }));
    overrideIds.push(makeSpotlightOverrideId(entityId));
  } else if (shouldApplySpotlightOverride(spec)) {
    overrideIds.push(makeSpotlightOverrideId(entityId));
  }

  return {
    binding_version: LLM_BINDING_VERSION,
    binding_scope: LLM_BINDING_SCOPE,
    runtime_enabled: LLM_RUNTIME_ENABLED,
    role_template_id: template.template_id,
    preferred_driver_model_id: template.preferred_driver_model_id,
    fallback_driver_model_ids: [...template.fallback_driver_model_ids],
    task_bindings: taskBindings,
    prompt_bias_tags: uniq([...template.prompt_bias_tags, ...promptBiasTags]).slice(0, 12),
    env_contract_refs: [...LLM_ENV_CONTRACT_REFS],
    override_ids: overrideIds,
    ops_notes: template.ops_notes
  };
}

function pruneGeneratedAgentFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return;
  }
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.isFile() && /\.agent\.(json|md)$/.test(entry.name)) {
      fs.unlinkSync(path.join(dirPath, entry.name));
    }
  }
}

function relativeProcessedPath(...segments) {
  return path.posix.join("processed", ...segments);
}

function existingStrategyRelativePath(teamSlug) {
  const strategyPath = path.join(teamsRoot, teamSlug, "strategy.json");
  return fs.existsSync(strategyPath) ? relativeProcessedPath("teams", teamSlug, "strategy.json") : undefined;
}

function renderList(items) {
  return items.map((item) => `- ${item}`).join("\n");
}

function renderLabeledIds(ids) {
  return ids.map((id) => `${id} (${styleLabelMap[id] ?? "unmapped"})`);
}

function normalizeAlias(alias) {
  return alias.trim().toLowerCase();
}

function definePlayer(spec) {
  return {
    status: "active",
    aliases: [spec.inGameId],
    memeTags: [],
    personaTags: [],
    playstyleTags: [],
    casterFocusTags: [],
    barrageFocusTags: [],
    newsFocusTags: [],
    crossCircleTags: [],
    canonNotes: [],
    heatLevel: "mid",
    cardPriority: 50,
    ...spec
  };
}

function defineCoach(spec) {
  return {
    status: "active",
    aliases: [spec.inGameId],
    memeTags: [],
    personaTags: [],
    playstyleTags: [],
    casterFocusTags: [],
    barrageFocusTags: [],
    newsFocusTags: [],
    crossCircleTags: [],
    canonNotes: [],
    heatLevel: "mid",
    cardPriority: 80,
    role: "coach",
    ...spec
  };
}

function defineTeam(spec) {
  return {
    status: "confirmed",
    canonNotes: [],
    teamStyleTags: [],
    storylineTags: [],
    casterFocusTags: [],
    barrageFocusTags: [],
    newsFocusTags: [],
    crossCircleTags: [],
    hooks: {
      casterAngleIds: [],
      barrageAngleIds: [],
      newsAngleIds: [],
      crossCircleAngleIds: [],
      signatureMemes: [],
      storylineTriggers: [],
      matchupTriggers: [],
      winStateTriggers: [],
      lossStateTriggers: [],
      highlightTriggers: []
    },
    ...spec
  };
}

const teams = [
  defineTeam({
    seed: 1,
    teamId: "team_vitallmty",
    slug: "vitallmty",
    agentTeamName: "VitaLLMty",
    sourceTeamName: "Vitality",
    canonRole: "title-favorite",
    namingRationale: "在 Vitality 中嵌入 LLM，保留小蜜蜂识别度，同时把大模型感做成自然内嵌词。",
    worldviewSummary: "本届默认头号种子。核心叙事是 ZywOo 的大爹兜底、apEX 的红温指挥，以及 flameZ 是否又把比赛打成研发现场。",
    teamStyleTags: ["title-favorite", "research-pressure", "late-round-insurance"],
    storylineTags: ["zywoo-big-dad", "flamez-research", "apex-redline"],
    casterFocusTags: ["machine_star_carry", "machine_force_buy_shock", "machine_map_point_pressure"],
    barrageFocusTags: ["research", "big_dad", "player_targeting"],
    newsFocusTags: ["title-favorite", "research-chaos"],
    crossCircleTags: ["customer_service_to_cleanup", "band_to_superteam"],
    teamAliases: ["VitaLLMty", "Vitality", "小蜜蜂", "蜜蜂", "V队", "大蜜蜂"],
    canonNotes: [
      "当前视作 Agent Major 一号种子。",
      "解说和弹幕都应优先保留 ZywOo 兜底与 flameZ 研发线。"
    ],
    hooks: {
      casterAngleIds: ["machine_star_carry", "machine_force_buy_shock", "machine_map_point_pressure"],
      barrageAngleIds: ["research", "big_dad", "player_targeting"],
      newsAngleIds: ["title-favorite", "research-chaos"],
      crossCircleAngleIds: ["customer_service_to_cleanup", "band_to_superteam"],
      signatureMemes: ["载物兜底", "火÷影响研发", "apEX 红温之后强起翻盘"],
      storylineTriggers: [
        "ZywOo 连续救残局时，切入大爹兜底叙事。",
        "flameZ 首死或关键击杀时，优先挂研发梗。",
        "apEX 连续暂停后翻盘时，走红线指挥回正路线。 "
      ],
      matchupTriggers: [
        "对 Team SpirIT 时，主打 ZywOo 与 donk 的世界第一正面话题。",
        "对 Falcon-7B 时，主打双核豪阵谁更像真银河战舰。"
      ],
      winStateTriggers: [
        "如果是 ZywOo 终结系列赛，新闻标题直接上头号热门兑现。",
        "如果 flameZ 打出突破局，弹幕允许研发成功量产化。"
      ],
      lossStateTriggers: [
        "如果输给下位种子，优先写研发失控，不写单纯冷门。",
        "如果 ZywOo 高击杀仍输，突出只剩大爹一个人在补售后。"
      ],
      highlightTriggers: [
        "残局 1vX 兜底",
        "强起翻盘",
        "火÷先手双杀",
        "apEX 暂停后连拿三分"
      ]
    },
    players: [
      definePlayer({
        slug: "apex",
        inGameId: "apEX",
        role: "igl",
        aliases: ["apEX", "apex", "A队长"],
        memeTags: ["红温", "表情包", "指挥交通"],
        personaTags: ["redline-igl", "emotional-driver"],
        playstyleTags: ["front-space", "mid-round-bark"],
        barrageFocusTags: ["player_targeting", "old_guard", "research"],
        newsFocusTags: ["title-favorite", "research-chaos"],
        personaSummary: "情绪外放型指挥，强项是把节奏和舞台气压一起拉满，弱项是红温镜头永远比战术板先出圈。",
        heatLevel: "high",
        cardPriority: 5
      }),
      definePlayer({
        slug: "ropz",
        inGameId: "ropz",
        role: "lurker",
        aliases: ["ropz", "被偷正面"],
        memeTags: ["残局味", "被偷正面"],
        personaTags: ["cold-reader", "endgame-accountant"],
        playstyleTags: ["deep-lurk", "late-flank"],
        newsFocusTags: ["title-favorite"],
        personaSummary: "冷静、干净、后程发力型明星位，是队里最像保险丝的一环。",
        heatLevel: "high",
        cardPriority: 10
      }),
      definePlayer({
        slug: "zywoo",
        inGameId: "ZywOo",
        role: "closer",
        aliases: ["ZywOo", "载物", "大爹", "薯片"],
        memeTags: ["大爹兜底", "残局保险"],
        personaTags: ["mvp-engine", "soft-spoken-hammer"],
        playstyleTags: ["multikill-anchor", "late-clutch"],
        barrageFocusTags: ["player_targeting", "big_dad"],
        newsFocusTags: ["title-favorite"],
        personaSummary: "默认兜底位，也是官方新闻最容易直接抬成 MVP 头条的人。",
        heatLevel: "high",
        cardPriority: 1
      }),
      definePlayer({
        slug: "flamez",
        inGameId: "flameZ",
        role: "entry",
        aliases: ["flameZ", "火", "火÷"],
        memeTags: ["研发样本", "火÷", "影响研发"],
        personaTags: ["chaos-trigger", "research-prototype"],
        playstyleTags: ["entry-burst", "confidence-peek"],
        barrageFocusTags: ["player_targeting", "research"],
        newsFocusTags: ["research-chaos"],
        crossCircleTags: ["cabinet_to_live_room_chaos"],
        personaSummary: "最容易把比赛打成课题现场的人。打顺了是研发成功，打崩了就是火÷影响研发。",
        heatLevel: "high",
        cardPriority: 2
      }),
      definePlayer({
        slug: "mezii",
        inGameId: "mezii",
        role: "support",
        aliases: ["mezii"],
        memeTags: ["补位工兵"],
        personaTags: ["glue-player", "quiet-fixer"],
        playstyleTags: ["spacing", "late-support"],
        newsFocusTags: ["title-favorite"],
        personaSummary: "队内的静音补位块，存在感不一定最吵，但残局拼图离不开他。",
        heatLevel: "mid",
        cardPriority: 40
      })
    ],
    coach: defineCoach({
      slug: "xtqzzz",
      inGameId: "XTQZZZ",
      aliases: ["XTQZZZ", "XTQ三Z"],
      memeTags: ["老牌教练", "暂停修正"],
      personaTags: ["system-keeper"],
      playstyleTags: ["timeout-adjust", "star-enablement"],
      newsFocusTags: ["title-favorite"],
      personaSummary: "负责把头号种子的高标准维持住，输的时候先背节奏，赢的时候帮全队落地。",
      heatLevel: "mid",
      cardPriority: 70
    })
  }),
  defineTeam({
    seed: 2,
    teamId: "team_neural_vincere",
    slug: "neural-vincere",
    agentTeamName: "Neural Vincere",
    sourceTeamName: "NaVi / Natus Vincere",
    canonRole: "legacy-system-contender",
    namingRationale: "保留 Vincere 主体，在前缀上改成 Neural，把天生赢家转成更体系化的神经网络语感。",
    worldviewSummary: "这支队最强的不是单点爆炸，而是老牌豪门的系统化收束能力。观感常常不是最疯，但稳定给对手上压力。",
    teamStyleTags: ["legacy-organization", "system-play", "discipline-pressure"],
    storylineTags: ["aleksib-system", "b1ad3-culture", "new-blood-makazze"],
    casterFocusTags: ["machine_old_guard_command", "machine_map_point_pressure"],
    barrageFocusTags: ["history_burden", "player_targeting", "mutual_flame"],
    newsFocusTags: ["history-burden", "upset-watch"],
    crossCircleTags: ["breakup_to_transfer", "lifetime_to_rivalry"],
    teamAliases: ["Neural Vincere", "NaVi", "NAVI", "黄黑", "天生赢家"],
    canonNotes: [
      "本届不按单核疯队处理，重点是体系感和豪门气压。",
      "makazze 在项目里视作新血入口，不要只写成普通拼图。"
    ],
    hooks: {
      casterAngleIds: ["machine_old_guard_command", "machine_map_point_pressure"],
      barrageAngleIds: ["history_burden", "player_targeting", "mutual_flame"],
      newsAngleIds: ["history-burden", "upset-watch"],
      crossCircleAngleIds: ["breakup_to_transfer", "lifetime_to_rivalry"],
      signatureMemes: ["豪门体系作业", "黄黑纪律课", "豪门又开始让人写长文"],
      storylineTriggers: [
        "Aleksib 带节奏连续得分时，走体系指挥控场叙事。",
        "w0nderful 和 b1t 稳住后程时，强调豪门基础盘还在。",
        "makazze 首次在关键图爆发时，突出新血真正接上线。 "
      ],
      matchupTriggers: [
        "对 Mouse 时走纪律队对纪律队。",
        "对 Falcon-7B 时写系统篮球打豪阵单打。"
      ],
      winStateTriggers: [
        "赢强队时用经典豪门仍能回魂。",
        "如果全员均衡发挥，新闻不要只写某个人单核拯救。"
      ],
      lossStateTriggers: [
        "输弱队时主打历史包袱和豪门到底差哪一步。",
        "如果系统掉线，弹幕可以走懂哥互喷。"
      ],
      highlightTriggers: [
        "默认拉满后的完美夹击",
        "Aleksib 中期反清",
        "w0nderful 架点收尾",
        "makazze 首秀高光"
      ]
    },
    players: [
      definePlayer({
        slug: "aleksib",
        inGameId: "Aleksib",
        role: "igl",
        aliases: ["Aleksib", "aleksi"],
        memeTags: ["体系哥", "指挥课"],
        personaTags: ["whiteboard-caller"],
        playstyleTags: ["tempo-pivot", "read-based"],
        newsFocusTags: ["history-burden"],
        personaSummary: "典型白板型指挥，场面看着不炸，但失控局面最先找他收口。",
        heatLevel: "mid",
        cardPriority: 25
      }),
      definePlayer({
        slug: "im",
        inGameId: "iM",
        role: "entry",
        aliases: ["iM"],
        memeTags: ["抢前点", "打头阵"],
        personaTags: ["front-push"],
        playstyleTags: ["wide-swing", "entry-contact"],
        personaSummary: "把前线打穿时很像点火器，没点燃就会被弹幕拿来拷打执行质量。",
        heatLevel: "mid",
        cardPriority: 45
      }),
      definePlayer({
        slug: "bit",
        inGameId: "b1t",
        role: "support",
        aliases: ["b1t", "bit"],
        memeTags: ["黄黑老底盘"],
        personaTags: ["anchor-piece"],
        playstyleTags: ["site-hold", "stability"],
        personaSummary: "这支 NaVi 的稳定底盘之一，常常不抢镜但常常不能没有。",
        heatLevel: "mid",
        cardPriority: 35
      }),
      definePlayer({
        slug: "w0nderful",
        inGameId: "w0nderful",
        role: "closer",
        aliases: ["w0nderful", "wonderful"],
        memeTags: ["后程锁门"],
        personaTags: ["angle-keeper"],
        playstyleTags: ["awp-hold", "late-cleanup"],
        personaSummary: "后程收尾位，给这支队的体系感提供最后一道门锁。",
        heatLevel: "mid",
        cardPriority: 20
      }),
      definePlayer({
        slug: "makazze",
        inGameId: "makazze",
        role: "star",
        aliases: ["makazze"],
        memeTags: ["新血", "新窗口"],
        personaTags: ["rookie-spotlight"],
        playstyleTags: ["confidence-peek", "swingy-impact"],
        newsFocusTags: ["upset-watch"],
        personaSummary: "项目世界观里的新血窗口。只要关键图爆一场，就很适合被写成豪门下一块新砖。",
        heatLevel: "mid",
        cardPriority: 15
      })
    ],
    coach: defineCoach({
      slug: "b1ad3",
      inGameId: "B1ad3",
      aliases: ["B1ad3", "blad3"],
      memeTags: ["体系教父"],
      personaTags: ["culture-builder"],
      playstyleTags: ["prep-heavy", "identity-keeper"],
      newsFocusTags: ["history-burden"],
      personaSummary: "豪门体系的文化持有人。Neural Vincere 的很多系统感都应默认有他一份影子。",
      heatLevel: "mid",
      cardPriority: 60
    })
  }),
  defineTeam({
    seed: 3,
    teamId: "team_furia",
    slug: "furia",
    agentTeamName: "FurIA",
    sourceTeamName: "FURIA",
    canonRole: "brazilian-chaos-contender",
    namingRationale: "直接把 IA / AI 自然嵌进 FURIA，本身就自带黑豹、激情和失控感。",
    worldviewSummary: "巴西热度、老将老脸、激情和失控并存。FurIA 的好看点在于它永远像要把比赛打成情绪剧。",
    teamStyleTags: ["brazil-heat", "veteran-core", "swingy-chaos"],
    storylineTags: ["fallen-clock", "kscerato-spine", "yekindar-gamble"],
    casterFocusTags: ["machine_force_buy_shock", "machine_old_guard_command"],
    barrageFocusTags: ["player_targeting", "old_guard", "research"],
    newsFocusTags: ["brazil-heat", "old-guard-last-dance", "upset-watch"],
    crossCircleTags: ["cabinet_to_live_room_chaos", "customer_service_to_cleanup"],
    teamAliases: ["FurIA", "FURIA", "黑豹", "巴西黑豹", "老登巴西"],
    canonNotes: [
      "这支队既能打热血线，也能打抽象线。",
      "FalleN 是长期内容资产，不要被短期状态完全覆盖。"
    ],
    hooks: {
      casterAngleIds: ["machine_force_buy_shock", "machine_old_guard_command"],
      barrageAngleIds: ["player_targeting", "old_guard", "research"],
      newsAngleIds: ["brazil-heat", "old-guard-last-dance", "upset-watch"],
      crossCircleAngleIds: ["cabinet_to_live_room_chaos", "customer_service_to_cleanup"],
      signatureMemes: ["巴西教父拨回时间", "黑豹又开始热血上头", "YEKINDAR 这路线只有自己知道"],
      storylineTriggers: [
        "FalleN 连续拿狙击回合时，走老将拨钟叙事。",
        "YEKINDAR 赌点打穿或白给时，都可以触发路线学梗。",
        "KSCERATO 稳住残局时，强调黑豹脊梁仍在。 "
      ],
      matchupTriggers: [
        "对 Prompt Gaming 时优先写巴西内战热度。",
        "对 Falcon-7B 时写激情野路对豪阵名角。"
      ],
      winStateTriggers: [
        "如果是老将带队翻盘，新闻走最后一舞仍有火。",
        "如果是高波动爆冷，弹幕可以直接写巴西直播间开锅。"
      ],
      lossStateTriggers: [
        "如果前压失控，主打实验失败。",
        "如果 FalleN 被打穿，弹幕允许老将时钟失灵。"
      ],
      highlightTriggers: [
        "FalleN 首杀开图",
        "YEKINDAR 绕后赌点",
        "KSCERATO 1v2",
        "巴西队连追三分"
      ]
    },
    players: [
      definePlayer({
        slug: "fallen",
        inGameId: "FalleN",
        role: "igl",
        aliases: ["FalleN", "巴西教父", "老将"],
        memeTags: ["巴西教父", "老将拨钟"],
        personaTags: ["mentor-core", "legacy-leader"],
        playstyleTags: ["awp-calling", "slow-control"],
        barrageFocusTags: ["old_guard", "player_targeting"],
        newsFocusTags: ["old-guard-last-dance", "brazil-heat"],
        personaSummary: "巴西老将话事人，最适合被写成把时间往回拨的人。",
        heatLevel: "high",
        cardPriority: 8
      }),
      definePlayer({
        slug: "yuurih",
        inGameId: "yuurih",
        role: "lurker",
        aliases: ["yuurih"],
        memeTags: ["暗线补刀"],
        personaTags: ["quiet-killer"],
        playstyleTags: ["timing-lurk", "late-pop"],
        personaSummary: "更偏沉默的暗线处理器，常常负责把前面打出的乱局收成优势。",
        heatLevel: "mid",
        cardPriority: 30
      }),
      definePlayer({
        slug: "yekindar",
        inGameId: "YEKINDAR",
        role: "entry",
        aliases: ["YEKINDAR", "叶总"],
        memeTags: ["赌点", "冲阵", "路线只有自己知道"],
        personaTags: ["coinflip-entry", "route-gambler"],
        playstyleTags: ["aggressive-contact", "solo-open"],
        newsFocusTags: ["upset-watch", "research-chaos"],
        crossCircleTags: ["cabinet_to_live_room_chaos"],
        personaSummary: "高波动前线样本，打穿就是战神，白给就是课题失败。",
        heatLevel: "high",
        cardPriority: 6
      }),
      definePlayer({
        slug: "kscerato",
        inGameId: "KSCERATO",
        role: "star",
        aliases: ["KSCERATO", "K神"],
        memeTags: ["巴西大腿", "稳点"],
        personaTags: ["spine-player"],
        playstyleTags: ["anchor-frag", "multi-kill"],
        newsFocusTags: ["brazil-heat"],
        personaSummary: "巴西线最稳的那根脊梁，只要这支队真能走远，他必然是报道里的核心名字之一。",
        heatLevel: "high",
        cardPriority: 9
      }),
      definePlayer({
        slug: "molodoy",
        inGameId: "molodoy",
        role: "support",
        aliases: ["molodoy"],
        memeTags: ["新拼图"],
        personaTags: ["new-piece"],
        playstyleTags: ["support-spacing", "rotate-cover"],
        newsFocusTags: ["upset-watch"],
        personaSummary: "新拼图位，适合写成是否真的补齐黑豹阵容最后一块的问题。",
        heatLevel: "mid",
        cardPriority: 42
      })
    ],
    coach: defineCoach({
      slug: "sidde",
      inGameId: "sidde",
      aliases: ["sidde"],
      memeTags: ["巴西教练组"],
      personaTags: ["emotion-balancer"],
      playstyleTags: ["timeout-reset", "loose-structure"],
      newsFocusTags: ["brazil-heat"],
      personaSummary: "负责在这支热度队上头之前先把方向盘扶住的人。",
      heatLevel: "mid",
      cardPriority: 68
    })
  }),
  defineTeam({
    seed: 4,
    teamId: "team_falcon_7b",
    slug: "falcon-7b",
    agentTeamName: "Falcon-7B",
    sourceTeamName: "Falcons",
    canonRole: "money-superteam",
    namingRationale: "把 Falcons 和 7B 参数模型梗直接焊在一起，既有豪阵气质，也保留一点小模型荒谬感。",
    worldviewSummary: "本届最像银河战舰的队。明星位过于密集，任何一场输赢都天然带剧情，天然带长文。",
    teamStyleTags: ["money-superteam", "star-density", "old-guard-and-kids"],
    storylineTags: ["niko-regret", "m0nesy-child-genius", "karrigan-last-dance"],
    casterFocusTags: ["machine_star_carry", "machine_old_guard_command", "machine_force_buy_shock"],
    barrageFocusTags: ["player_targeting", "old_guard", "history_burden"],
    newsFocusTags: ["money-superteam", "old-guard-last-dance", "upset-watch"],
    crossCircleTags: ["band_to_superteam", "breakup_to_transfer", "lifetime_to_rivalry"],
    teamAliases: ["Falcon-7B", "Falcons", "猎鹰", "银河战舰", "老登队", "钱队"],
    canonNotes: [
      "这是天然的流量队，不需要额外强行加戏。",
      "报道里允许同时存在豪阵与遗憾文学。"
    ],
    hooks: {
      casterAngleIds: ["machine_star_carry", "machine_old_guard_command", "machine_force_buy_shock"],
      barrageAngleIds: ["player_targeting", "old_guard", "history_burden"],
      newsAngleIds: ["money-superteam", "old-guard-last-dance", "upset-watch"],
      crossCircleAngleIds: ["band_to_superteam", "breakup_to_transfer", "lifetime_to_rivalry"],
      signatureMemes: ["老登开会", "尼公子遗憾文学", "小孩这枪不讲道理"],
      storylineTriggers: [
        "NiKo 起势时，新闻和解说都可以往遗憾文学反打。",
        "m0NESY 连续狙开局时，直接给小孩不讲道理。",
        "karrigan 带队逆风追分时，老登仍在指挥交通。 "
      ],
      matchupTriggers: [
        "对 VitaLLMty 时是顶配豪阵对头号种子。",
        "对 PhaseClan 时是明星密度之争，也是流量队对流量队。"
      ],
      winStateTriggers: [
        "如果豪阵兑现，新闻用银河战舰终于对齐参数。",
        "如果 NiKo 收下关键图，标题允许遗憾文学暂时停更。"
      ],
      lossStateTriggers: [
        "输给下位种子时，优先走参数没调通，不要写普通失利。",
        "如果明星位数据很好仍然输，弹幕可以长文控诉谁又在写遗憾。"
      ],
      highlightTriggers: [
        "m0NESY 五杀",
        "NiKo 手枪局多杀",
        "karrigan 暂停逆转",
        "TeSeS 补枪串联"
      ]
    },
    players: [
      definePlayer({
        slug: "karrigan",
        inGameId: "karrigan",
        role: "igl",
        aliases: ["karrigan", "大表哥", "老登"],
        memeTags: ["老登", "最后一舞"],
        personaTags: ["aging-captain", "speech-driver"],
        playstyleTags: ["mid-round-voice", "hero-call"],
        newsFocusTags: ["old-guard-last-dance", "money-superteam"],
        personaSummary: "老将指挥位，越是乱战越像要靠他发言把全船拉回正轨。",
        heatLevel: "high",
        cardPriority: 7
      }),
      definePlayer({
        slug: "niko",
        inGameId: "NiKo",
        role: "star",
        aliases: ["NiKo", "尼公子", "虾"],
        memeTags: ["遗憾文学", "沙鹰", "尼公子"],
        personaTags: ["tragedy-star", "headline-engine"],
        playstyleTags: ["rifle-crash", "multi-frag"],
        barrageFocusTags: ["player_targeting", "history_burden"],
        newsFocusTags: ["money-superteam", "history-burden"],
        personaSummary: "顶级 headline 选手。赢了是战神，输了就会立刻被写回遗憾文学。",
        heatLevel: "high",
        cardPriority: 3
      }),
      definePlayer({
        slug: "teses",
        inGameId: "TeSeS",
        role: "support",
        aliases: ["TeSeS"],
        memeTags: ["补枪块"],
        personaTags: ["glue-fragger"],
        playstyleTags: ["trade-pack", "anchor-cover"],
        personaSummary: "这支豪阵里最容易被忽略，但一旦站不住就会显得整艘船都松动。",
        heatLevel: "mid",
        cardPriority: 38
      }),
      definePlayer({
        slug: "m0nesy",
        inGameId: "m0NESY",
        role: "closer",
        aliases: ["m0NESY", "小孩"],
        memeTags: ["小孩", "狙击天才"],
        personaTags: ["child-prodigy", "highlight-sniper"],
        playstyleTags: ["awp-first-pick", "clutch-swing"],
        newsFocusTags: ["money-superteam"],
        personaSummary: "豪阵里的天才位，最适合被玩机器式解说直接拉成不讲道理的镜头中心。",
        heatLevel: "high",
        cardPriority: 4
      }),
      definePlayer({
        slug: "kyousuke",
        inGameId: "kyousuke",
        role: "entry",
        aliases: ["kyousuke"],
        memeTags: ["新刃口"],
        personaTags: ["fresh-edge"],
        playstyleTags: ["entry-burst", "follow-up-space"],
        newsFocusTags: ["upset-watch"],
        personaSummary: "新刃口位，打出来就是豪阵年轻血，不行就会被反问为什么豪阵还缺最后一块。",
        heatLevel: "mid",
        cardPriority: 22
      })
    ],
    coach: defineCoach({
      slug: "zonic",
      inGameId: "zonic",
      aliases: ["zonic"],
      memeTags: ["冠军教头"],
      personaTags: ["ring-holder"],
      playstyleTags: ["prep", "legacy-maintenance"],
      newsFocusTags: ["money-superteam", "old-guard-last-dance"],
      personaSummary: "豪阵背后的冠军教头符号，天然适合被写成参数总工程师。",
      heatLevel: "high",
      cardPriority: 55
    })
  }),
  defineTeam({
    seed: 5,
    teamId: "team_parivision_omni",
    slug: "parivision-omni",
    agentTeamName: "PariVision-Omni",
    sourceTeamName: "PARIVISION",
    canonRole: "dark-horse-system",
    namingRationale: "保留 PariVision 主体，再补进 Omni，让多模态视觉感自然长在队名里。",
    worldviewSummary: "偏慢、偏稳、偏阅读。不是最热闹的一队，但很适合写成低噪音黑马，把强队拖进自己的阅读节奏里。",
    teamStyleTags: ["dark-horse", "slow-read", "macro-pressure"],
    storylineTags: ["jame-economy", "underestimated-core", "system-blackhorse"],
    casterFocusTags: ["machine_map_point_pressure", "machine_old_guard_command"],
    barrageFocusTags: ["player_targeting", "history_burden"],
    newsFocusTags: ["upset-watch", "research-chaos"],
    crossCircleTags: ["customer_service_to_cleanup", "lifetime_to_rivalry"],
    teamAliases: ["PariVision-Omni", "PARIVISION", "PariVision", "全模态队"],
    canonNotes: [
      "这支队的热度不是靠吵，而是靠让对手不舒服。",
      "Jame 不要只做保枪梗，要同时保留阅读比赛的长线价值。"
    ],
    hooks: {
      casterAngleIds: ["machine_map_point_pressure", "machine_old_guard_command"],
      barrageAngleIds: ["player_targeting", "history_burden"],
      newsAngleIds: ["upset-watch", "research-chaos"],
      crossCircleAngleIds: ["customer_service_to_cleanup", "lifetime_to_rivalry"],
      signatureMemes: ["Jame Time", "全模态慢刀", "不是慢，是在让你窒息"],
      storylineTriggers: [
        "Jame 把比赛拖慢时，直接写黑马把桌面调成自己的刷新率。",
        "年轻位补枪成形时，强调 Omni 真正接上了多点输入。",
        "如果对手开始急，说明 PariVision-Omni 的节奏已经写进对方脑子里。 "
      ],
      matchupTriggers: [
        "对 Falcon-7B 时写慢刀砍银河战舰。",
        "对 Neural Vincere 时写系统队互读。"
      ],
      winStateTriggers: [
        "爆冷强队时用黑马视角，不要硬写偶然。",
        "如果 Jame 做成经济压制，新闻角度可直接上研究型反杀。"
      ],
      lossStateTriggers: [
        "如果慢节奏被冲烂，写黑马阅读没来得及落地。",
        "如果被观众嫌慢，弹幕允许懂哥互喷。"
      ],
      highlightTriggers: [
        "Jame 关键残局",
        "慢节奏 default 拖垮对手",
        "zweih 双杀守点",
        "nota 后程收掉残局"
      ]
    },
    players: [
      definePlayer({
        slug: "jame",
        inGameId: "Jame",
        role: "igl",
        aliases: ["Jame", "Jame Time"],
        memeTags: ["Jame Time", "保枪大师"],
        personaTags: ["economy-reader", "slow-tempo-caller"],
        playstyleTags: ["economy-control", "awp-call"],
        newsFocusTags: ["upset-watch"],
        personaSummary: "自带时间感的指挥位。观众先想到的可能是保枪梗，但项目内要同时保留他的节奏阅读感。",
        heatLevel: "high",
        cardPriority: 11
      }),
      definePlayer({
        slug: "belchonokk",
        inGameId: "BELCHONOKK",
        role: "entry",
        aliases: ["BELCHONOKK"],
        memeTags: ["前线点火"],
        personaTags: ["pace-opener"],
        playstyleTags: ["entry-path", "contact-burst"],
        personaSummary: "前线点火位，决定这支慢队是不是能突然拔刀。",
        heatLevel: "mid",
        cardPriority: 46
      }),
      definePlayer({
        slug: "xielo",
        inGameId: "xiELO",
        role: "support",
        aliases: ["xiELO"],
        memeTags: ["系统补丁"],
        personaTags: ["structure-piece"],
        playstyleTags: ["utility-net", "hold-line"],
        personaSummary: "更像结构补丁的一环，让这支队的慢和稳不至于散。",
        heatLevel: "mid",
        cardPriority: 43
      }),
      definePlayer({
        slug: "nota",
        inGameId: "nota",
        role: "lurker",
        aliases: ["nota"],
        memeTags: ["暗线收尾"],
        personaTags: ["shadow-route"],
        playstyleTags: ["late-wrap", "route-punish"],
        personaSummary: "常常在最不吵的时刻补上最关键的一刀。",
        heatLevel: "mid",
        cardPriority: 34
      }),
      definePlayer({
        slug: "zweih",
        inGameId: "zweih",
        role: "star",
        aliases: ["zweih"],
        memeTags: ["关键输出"],
        personaTags: ["understated-star"],
        playstyleTags: ["impact-rifle", "site-swing"],
        personaSummary: "黑马线真正能抬头的火力点。只要连续出镜，就应该被提升成标题人物。",
        heatLevel: "mid",
        cardPriority: 18
      })
    ],
    coach: defineCoach({
      slug: "dastan",
      inGameId: "dastan",
      aliases: ["dastan"],
      memeTags: ["老牌教头"],
      personaTags: ["macro-prep"],
      playstyleTags: ["read-heavy-prep", "discipline"],
      newsFocusTags: ["upset-watch"],
      personaSummary: "负责把黑马气质固定成体系，而不是只靠一两次偶发爆冷。",
      heatLevel: "mid",
      cardPriority: 66
    })
  }),
  defineTeam({
    seed: 6,
    teamId: "team_aulora",
    slug: "aulora",
    agentTeamName: "AuLoRA",
    sourceTeamName: "Aurora",
    canonRole: "turkish-firepower",
    namingRationale: "把 Aurora 和 LoRA 融合，既有自然名词感，也有参数微调的 AI 味道。",
    worldviewSummary: "偏枪感、偏冲脸、偏手感曲线。只要气势打起来，AuLoRA 很容易把比赛变成一段持续高分贝输出。",
    teamStyleTags: ["turkish-firepower", "hand-feel-team", "punch-first"],
    storylineTags: ["xantares-power", "woxic-swing", "maj3r-command"],
    casterFocusTags: ["machine_force_buy_shock", "machine_map_point_pressure"],
    barrageFocusTags: ["player_targeting", "research"],
    newsFocusTags: ["upset-watch"],
    crossCircleTags: ["cabinet_to_live_room_chaos", "band_to_superteam"],
    teamAliases: ["AuLoRA", "Aurora", "LoRA队"],
    canonNotes: [
      "这支队优先突出手感曲线。",
      "不要把土耳其线写成纯抽象，仍要保留硬实力火力。"
    ],
    hooks: {
      casterAngleIds: ["machine_force_buy_shock", "machine_map_point_pressure"],
      barrageAngleIds: ["player_targeting", "research"],
      newsAngleIds: ["upset-watch"],
      crossCircleAngleIds: ["cabinet_to_live_room_chaos", "band_to_superteam"],
      signatureMemes: ["XANTARES 开脸", "woxic 手感线", "土耳其火力一来全场起风"],
      storylineTriggers: [
        "XANTARES 正面连发时，直接走火力横推叙事。",
        "woxic 如果高波动，允许手感曲线话题上桌。",
        "MAJ3R 叫暂停回正时，把这支高分贝队写成终于重新对焦。 "
      ],
      matchupTriggers: [
        "对 The MongolZK 时写硬仗队互撞。",
        "对 Neural Vincere 时写枪感对体系。"
      ],
      winStateTriggers: [
        "如果正面打穿强队，新闻按爆冷硬解写。",
        "如果双狙或双核起手感，弹幕可以直接刷今天真开了。"
      ],
      lossStateTriggers: [
        "如果冲脸回合频繁白给，写实验失败比写失误更合适。",
        "如果手感断电，突出这支队最怕的是自己把自己打静音。"
      ],
      highlightTriggers: [
        "XANTARES 四杀正面",
        "woxic 连续首杀",
        "Wicadia 开门双杀",
        "MAJ3R 暂停后反扑"
      ]
    },
    players: [
      definePlayer({
        slug: "maj3r",
        inGameId: "MAJ3R",
        role: "igl",
        aliases: ["MAJ3R"],
        memeTags: ["土耳其指挥"],
        personaTags: ["pace-keeper"],
        playstyleTags: ["mid-round-reset", "structure-call"],
        personaSummary: "高火力队里负责踩刹车的人，真要走远得靠他把热血转成可重复输出。",
        heatLevel: "mid",
        cardPriority: 28
      }),
      definePlayer({
        slug: "xantares",
        inGameId: "XANTARES",
        role: "star",
        aliases: ["XANTARES"],
        memeTags: ["土耳其火力", "开脸"],
        personaTags: ["frontline-star"],
        playstyleTags: ["rifle-burst", "swing-control"],
        newsFocusTags: ["upset-watch"],
        personaSummary: "最像镜头正中心的人，只要正面滚起来就能瞬间拉高整队气压。",
        heatLevel: "high",
        cardPriority: 12
      }),
      definePlayer({
        slug: "woxic",
        inGameId: "woxic",
        role: "closer",
        aliases: ["woxic"],
        memeTags: ["手感线"],
        personaTags: ["hot-cold-sniper"],
        playstyleTags: ["peek-awp", "confidence-shot"],
        personaSummary: "手感波动会被无限放大，但也正因为如此，状态一上来特别适合直播间造势。",
        heatLevel: "mid",
        cardPriority: 19
      }),
      definePlayer({
        slug: "soulfly",
        inGameId: "soulfly",
        role: "support",
        aliases: ["soulfly"],
        memeTags: ["工兵位"],
        personaTags: ["silent-worker"],
        playstyleTags: ["utility-cover", "retrade"],
        personaSummary: "更偏工兵型拼图，负责让高音量输出不至于只剩空响。",
        heatLevel: "mid",
        cardPriority: 44
      }),
      definePlayer({
        slug: "wicadia",
        inGameId: "Wicadia",
        role: "entry",
        aliases: ["Wicadia"],
        memeTags: ["前线点火"],
        personaTags: ["young-trigger"],
        playstyleTags: ["entry-poke", "double-swing"],
        personaSummary: "年轻火点位，冲开了就是队伍声浪的第一层放大器。",
        heatLevel: "mid",
        cardPriority: 27
      })
    ],
    coach: defineCoach({
      slug: "fabre",
      inGameId: "Fabre",
      aliases: ["Fabre"],
      memeTags: ["教练组修正"],
      personaTags: ["reset-coordinator"],
      playstyleTags: ["review", "timeout-reset"],
      personaSummary: "在这支高分贝队里做参数微调的人，主要职责是防止全队一起飘走。",
      heatLevel: "mid",
      cardPriority: 72
    })
  }),
  defineTeam({
    seed: 7,
    teamId: "team_mouse",
    slug: "mouse",
    agentTeamName: "Mouse",
    sourceTeamName: "MOUZ",
    canonRole: "disciplined-young-core",
    namingRationale: "MOUZ 和 mouse 天然贴合，简洁、好记，也很适合弹幕直接叫老鼠。",
    worldviewSummary: "年轻、干净、纪律感强，是很多强队的标准试金石。打顺时像流水线，打不顺时就会被问是不是被偷正面。",
    teamStyleTags: ["young-core", "discipline", "test-stone"],
    storylineTags: ["spinx-quiet-knife", "jl-fire", "torzsi-closing"],
    casterFocusTags: ["machine_map_point_pressure", "machine_star_carry"],
    barrageFocusTags: ["player_targeting", "history_burden"],
    newsFocusTags: ["upset-watch"],
    crossCircleTags: ["breakup_to_transfer", "customer_service_to_cleanup"],
    teamAliases: ["Mouse", "MOUZ", "老鼠", "鼠队"],
    canonNotes: [
      "Mouse 是纪律线，不是纯整活队。",
      "ropz 已在 VitaLLMty，Mouse 现在的内容重点转向新阵稳定性。"
    ],
    hooks: {
      casterAngleIds: ["machine_map_point_pressure", "machine_star_carry"],
      barrageAngleIds: ["player_targeting", "history_burden"],
      newsAngleIds: ["upset-watch"],
      crossCircleAngleIds: ["breakup_to_transfer", "customer_service_to_cleanup"],
      signatureMemes: ["鼠队纪律课", "被偷正面反噬", "jL 一点火全队都醒了"],
      storylineTriggers: [
        "如果 default 打得很干净，解说要强调纪律队教科书。",
        "如果 xertioN 或 jL 强行撕开正面，直播间可以把鼠队从理工男写成突然热血。",
        "如果 torzsi 连续收尾，允许把 Mouse 写成稳得像系统默认值。 "
      ],
      matchupTriggers: [
        "对 Neural Vincere 是纪律互读。",
        "对 Falcon-7B 是纪律工程对豪阵天赋。"
      ],
      winStateTriggers: [
        "赢强队时用试金石变成真刀。",
        "如果全队均衡开火，新闻避免只追一个头牌。"
      ],
      lossStateTriggers: [
        "如果正面被冲碎，主写纪律线顶不住纯火力。",
        "如果 default 执行太慢，弹幕允许懂哥互喷。"
      ],
      highlightTriggers: [
        "torzsi AWP 终结",
        "jL 突破双杀",
        "xertioN 正面开图",
        "Spinx 后程补刀"
      ]
    },
    players: [
      definePlayer({
        slug: "torzsi",
        inGameId: "torzsi",
        role: "closer",
        aliases: ["torzsi"],
        memeTags: ["收尾锁门"],
        personaTags: ["cool-finisher"],
        playstyleTags: ["awp-lock", "late-round-control"],
        personaSummary: "更偏安静的收尾位，适合在纪律队里承担把残局关门的角色。",
        heatLevel: "mid",
        cardPriority: 23
      }),
      definePlayer({
        slug: "spinx",
        inGameId: "Spinx",
        role: "lurker",
        aliases: ["Spinx"],
        memeTags: ["静音刀"],
        personaTags: ["shadow-rifler"],
        playstyleTags: ["back-half-pressure", "timing-cut"],
        personaSummary: "偏静音的刀口位，不一定最吵，但很容易在真正要命的时候出现。",
        heatLevel: "mid",
        cardPriority: 29
      }),
      definePlayer({
        slug: "jl",
        inGameId: "jL",
        role: "entry",
        aliases: ["jL"],
        memeTags: ["点火", "激情位"],
        personaTags: ["spark-plug"],
        playstyleTags: ["wide-swing", "tempo-break"],
        personaSummary: "纪律队里最带火的一位。只要 jL 打穿，整支 Mouse 的情绪线就会立刻抬起来。",
        heatLevel: "mid",
        cardPriority: 17
      }),
      definePlayer({
        slug: "xertion",
        inGameId: "xertioN",
        role: "star",
        aliases: ["xertioN"],
        memeTags: ["正面火力"],
        personaTags: ["muscle-core"],
        playstyleTags: ["rifle-crash", "site-break"],
        personaSummary: "纪律体系里负责把伤害真正灌进去的肌肉位。",
        heatLevel: "mid",
        cardPriority: 16
      }),
      definePlayer({
        slug: "xelex",
        inGameId: "xelex",
        role: "support",
        aliases: ["xelex"],
        memeTags: ["新拼图"],
        personaTags: ["system-piece"],
        playstyleTags: ["support-rotations", "utility-line"],
        personaSummary: "更偏新拼图接口位，当前的使命是融进纪律线，而不是抢走太多镜头。",
        heatLevel: "low",
        cardPriority: 48
      })
    ],
    coach: defineCoach({
      slug: "sycrone",
      inGameId: "sycrone",
      aliases: ["sycrone"],
      memeTags: ["纪律教练"],
      personaTags: ["identity-maintainer"],
      playstyleTags: ["structure", "review-loop"],
      personaSummary: "负责把这支队的纪律感固定成能长期维护的系统资产。",
      heatLevel: "mid",
      cardPriority: 73
    })
  }),
  defineTeam({
    seed: 8,
    teamId: "team_the_mongolzk",
    slug: "the-mongolzk",
    agentTeamName: "The MongolZK",
    sourceTeamName: "The MongolZ",
    canonRole: "asia-charge",
    namingRationale: "MongolZ 上补一个 ZK，既保留蒙古铁骑识别度，也带一点零知识推理的硬核味。",
    worldviewSummary: "亚洲冲锋队。正面狠、硬仗多、观众情绪好带，是最适合写成铁骑风暴的一支队。",
    teamStyleTags: ["asia-rise", "hard-fight", "momentum-team"],
    storylineTags: ["910-scope", "blitz-call", "mzinho-growth"],
    casterFocusTags: ["machine_asia_charge", "machine_force_buy_shock"],
    barrageFocusTags: ["player_targeting", "cross_circle"],
    newsFocusTags: ["asia-rise", "upset-watch"],
    crossCircleTags: ["band_to_superteam", "cabinet_to_live_room_chaos"],
    teamAliases: ["The MongolZK", "The MongolZ", "蒙古", "蒙古铁骑", "铁骑"],
    canonNotes: [
      "The MongolZK 是全局重点热队之一。",
      "不要只写亚洲之光，也要写他们真的敢正面对冲。"
    ],
    hooks: {
      casterAngleIds: ["machine_asia_charge", "machine_force_buy_shock"],
      barrageAngleIds: ["player_targeting", "cross_circle"],
      newsAngleIds: ["asia-rise", "upset-watch"],
      crossCircleAngleIds: ["band_to_superteam", "cabinet_to_live_room_chaos"],
      signatureMemes: ["蒙古铁骑启动", "910 镜子亮了", "硬仗不服就干"],
      storylineTriggers: [
        "连续前顶成功时，直接走亚洲铁骑冲锋。",
        "910 开镜起手时，弹幕可以把镜子亮了挂满屏。",
        "如果 bLitz 把节奏带疯，允许直播间群魔乱舞。 "
      ],
      matchupTriggers: [
        "对 AuLoRA 时写硬仗互撞。",
        "对 Falcon-7B 时写亚洲火力撞豪阵牌面。"
      ],
      winStateTriggers: [
        "赢强队时新闻优先亚洲冲锋，不要只写爆冷。",
        "如果 910 或 mzinho 站出来，突出年轻火力兑现。"
      ],
      lossStateTriggers: [
        "如果过于硬冲翻车，写冲锋线断档。",
        "如果后程被拖慢，解说强调还需要更稳的终结盘。"
      ],
      highlightTriggers: [
        "910 首杀三连",
        "mzinho 多杀进点",
        "bLitz 中期带转点",
        "Techno 补枪封门"
      ]
    },
    players: [
      definePlayer({
        slug: "blitz",
        inGameId: "bLitz",
        role: "igl",
        aliases: ["bLitz"],
        memeTags: ["铁骑指挥"],
        personaTags: ["momentum-caller"],
        playstyleTags: ["pace-push", "courage-call"],
        newsFocusTags: ["asia-rise"],
        personaSummary: "铁骑的节奏发令员，最擅长把全队推入高速度冲锋状态。",
        heatLevel: "mid",
        cardPriority: 24
      }),
      definePlayer({
        slug: "techno",
        inGameId: "Techno",
        role: "support",
        aliases: ["Techno"],
        memeTags: ["工兵铁骑"],
        personaTags: ["line-holder"],
        playstyleTags: ["utility-hold", "trade-work"],
        personaSummary: "铁骑体系里的工兵位，负责把硬仗落成真正能持续的回合结构。",
        heatLevel: "mid",
        cardPriority: 37
      }),
      definePlayer({
        slug: "mzinho",
        inGameId: "mzinho",
        role: "star",
        aliases: ["mzinho"],
        memeTags: ["年轻火力"],
        personaTags: ["growth-core"],
        playstyleTags: ["rifle-pop", "site-crack"],
        newsFocusTags: ["asia-rise", "upset-watch"],
        personaSummary: "亚洲线的年轻火力位之一，站出来时很适合被写成铁骑下一层推进器。",
        heatLevel: "mid",
        cardPriority: 21
      }),
      definePlayer({
        slug: "910",
        inGameId: "910",
        role: "closer",
        aliases: ["910", "蒙古狙"],
        memeTags: ["蒙古狙", "镜子亮了"],
        personaTags: ["sniper-signal"],
        playstyleTags: ["awp-entry-denial", "late-clean"],
        newsFocusTags: ["asia-rise"],
        personaSummary: "镜头感极强的狙位，是这支队最容易被直播间一眼记住的人之一。",
        heatLevel: "high",
        cardPriority: 13
      }),
      definePlayer({
        slug: "cobrazera",
        inGameId: "cobrazera",
        role: "entry",
        aliases: ["cobrazera"],
        memeTags: ["前顶位"],
        personaTags: ["charge-piece"],
        playstyleTags: ["first-contact", "entry-heat"],
        personaSummary: "前顶位，只要冲开一两个关键回合，就能让全队情绪瞬间再上一个台阶。",
        heatLevel: "mid",
        cardPriority: 31
      })
    ],
    coach: defineCoach({
      slug: "maaraa",
      inGameId: "maaRaa",
      aliases: ["maaRaa"],
      memeTags: ["铁骑教头"],
      personaTags: ["hard-fight-manager"],
      playstyleTags: ["review", "stability-patch"],
      newsFocusTags: ["asia-rise"],
      personaSummary: "负责在高速度、高冲劲之外，给铁骑补上稳定层的人。",
      heatLevel: "mid",
      cardPriority: 69
    })
  }),
  defineTeam({
    seed: 9,
    teamId: "team_team_spirit",
    slug: "team-spirit",
    agentTeamName: "Team SpirIT",
    sourceTeamName: "Team Spirit",
    canonRole: "teen-supercore",
    namingRationale: "把 Spirit 中的 IT 抬出来，既保留雪碧识别度，也让技术魂像自然变体。",
    worldviewSummary: "天赋密度拉满、强压制、观众情绪极易被点燃。只要 donk 在场，整支队的气压就自动更高一档。",
    teamStyleTags: ["title-threat", "donk-core", "high-pressure-firepower"],
    storylineTags: ["donk-meter", "sh1ro-lock", "young-core-wave"],
    casterFocusTags: ["machine_star_carry", "machine_force_buy_shock"],
    barrageFocusTags: ["player_targeting", "research", "cross_circle"],
    newsFocusTags: ["title-favorite", "upset-watch"],
    crossCircleTags: ["band_to_superteam", "cabinet_to_live_room_chaos"],
    teamAliases: ["Team SpirIT", "Team Spirit", "Spirit", "雪碧"],
    canonNotes: [
      "donk 是顶级重点资产，不能降格成普通明星位。",
      "Team SpirIT 不只是 donk 队，sh1ro 和整体压制也要保留。"
    ],
    hooks: {
      casterAngleIds: ["machine_star_carry", "machine_force_buy_shock"],
      barrageAngleIds: ["player_targeting", "research", "cross_circle"],
      newsAngleIds: ["title-favorite", "upset-watch"],
      crossCircleAngleIds: ["band_to_superteam", "cabinet_to_live_room_chaos"],
      signatureMemes: ["东子一上强度表就歪了", "研发对象登场", "雪碧压制感"],
      storylineTriggers: [
        "donk 连续突破时，直接把全场强度表抬到他身上。",
        "如果 sh1ro 后程锁门，补足不是只有一个人在杀。",
        "如果对手围绕 donk 成功布置，允许弹幕讨论研发对象终于被研究。 "
      ],
      matchupTriggers: [
        "对 VitaLLMty 是世界第一候选对世界第一候选。",
        "对 The MongolZK 是亚洲热度队对顶级火力队。"
      ],
      winStateTriggers: [
        "如果 donk 主导赢图，新闻允许直接用天才少年继续横推。",
        "如果全队接力取胜，解说要多给体系压制感。"
      ],
      lossStateTriggers: [
        "如果 donk 被限制，写研发成果终于落地。",
        "如果队伍整体断电，写高压火力被强行静音。"
      ],
      highlightTriggers: [
        "donk 正面三杀",
        "sh1ro AWP 锁门",
        "zont1x 暗线补刀",
        "hally 暂停后回正"
      ]
    },
    players: [
      definePlayer({
        slug: "donk",
        inGameId: "donk",
        role: "star",
        aliases: ["donk", "东", "东子"],
        memeTags: ["研发对象", "强度标尺", "天才少年"],
        personaTags: ["power-meter", "teen-phenom"],
        playstyleTags: ["entry-rifle", "multi-frag"],
        barrageFocusTags: ["player_targeting", "research"],
        newsFocusTags: ["title-favorite"],
        personaSummary: "当前项目里最容易成为强度标尺的人。所有人都在围着他写研发、写限制、写爆发。",
        heatLevel: "high",
        cardPriority: 14
      }),
      definePlayer({
        slug: "magixx",
        inGameId: "magixx",
        role: "support",
        aliases: ["magixx"],
        memeTags: ["雪碧拼图"],
        personaTags: ["line-support"],
        playstyleTags: ["support-angles", "trade-cover"],
        personaSummary: "更偏隐形拼图，负责让高压火力不是一波流。",
        heatLevel: "mid",
        cardPriority: 41
      }),
      definePlayer({
        slug: "sh1ro",
        inGameId: "sh1ro",
        role: "closer",
        aliases: ["sh1ro"],
        memeTags: ["锁门狙"],
        personaTags: ["cold-finish"],
        playstyleTags: ["awp-denial", "late-control"],
        personaSummary: "后程锁门位，是 Team SpirIT 从热血队变成顶队的重要原因之一。",
        heatLevel: "high",
        cardPriority: 26
      }),
      definePlayer({
        slug: "tn1r",
        inGameId: "tN1R",
        role: "entry",
        aliases: ["tN1R"],
        memeTags: ["前线齿轮"],
        personaTags: ["push-gear"],
        playstyleTags: ["entry-line", "contact-pressure"],
        personaSummary: "前线齿轮位，让 donk 的高压线更容易形成成片威胁。",
        heatLevel: "mid",
        cardPriority: 33
      }),
      definePlayer({
        slug: "zont1x",
        inGameId: "zont1x",
        role: "lurker",
        aliases: ["zont1x"],
        memeTags: ["暗线刀"],
        personaTags: ["back-half-slice"],
        playstyleTags: ["timing-walk", "late-backstab"],
        personaSummary: "雪碧阵里更安静的刀口，适合在解说里补足整队不是只会正面硬凿。",
        heatLevel: "mid",
        cardPriority: 32
      })
    ],
    coach: defineCoach({
      slug: "hally",
      inGameId: "hally",
      aliases: ["hally"],
      memeTags: ["高压教头"],
      personaTags: ["young-core-manager"],
      playstyleTags: ["prep", "pressure-balance"],
      newsFocusTags: ["title-favorite"],
      personaSummary: "负责把这支高压高天赋队伍维持在冠军线附近的人。",
      heatLevel: "mid",
      cardPriority: 64
    })
  }),
  defineTeam({
    seed: 10,
    teamId: "team_futuretoken",
    slug: "futuretoken",
    agentTeamName: "FUtureToken",
    sourceTeamName: "FUT",
    canonRole: "volatile-underdog",
    namingRationale: "从 FUT 自然长到 FUtureToken，把 token 和未来感焊进去，同时保留原始发音识别。",
    worldviewSummary: "更像高波动潜力股。观感不一定最稳，但很适合当下克上和中盘突然加速的剧情工具队。",
    teamStyleTags: ["underdog", "volatile", "swing-team"],
    storylineTags: ["demon-flash", "lauNX-hit", "wild-token-run"],
    casterFocusTags: ["machine_force_buy_shock", "machine_map_point_pressure"],
    barrageFocusTags: ["player_targeting", "research", "plus_one"],
    newsFocusTags: ["upset-watch"],
    crossCircleTags: ["breakup_to_transfer", "cabinet_to_live_room_chaos"],
    teamAliases: ["FUtureToken", "FUT", "FUT队"],
    canonNotes: [
      "这支队是后续 P3 新闻生态里的好冷门样本。",
      "先保留潜力股口径，不强抬成豪门。"
    ],
    hooks: {
      casterAngleIds: ["machine_force_buy_shock", "machine_map_point_pressure"],
      barrageAngleIds: ["player_targeting", "research", "plus_one"],
      newsAngleIds: ["upset-watch"],
      crossCircleAngleIds: ["breakup_to_transfer", "cabinet_to_live_room_chaos"],
      signatureMemes: ["Token 冲起来了", "潜力股突然拉涨停", "这队又把比赛打成高波动 K 线"],
      storylineTriggers: [
        "如果前中期突然连分，解说往潜力股冲顶写。",
        "如果 demon 或 lauNX 起枪感，弹幕可以走今天真开出来了。",
        "如果高波动崩盘，允许用 K 线跳水写法。 "
      ],
      matchupTriggers: [
        "对 AstraLLM 写新队线对历史包袱队。",
        "对 Prompt Gaming 写中下半区互相争爆冷。"
      ],
      winStateTriggers: [
        "赢强队时直接上爆冷预警兑现。",
        "如果是多点开花，新闻写全队一起拉升，而不是某人独秀。"
      ],
      lossStateTriggers: [
        "如果冲得太散，写参数波动过大。",
        "如果后程断电，强调潜力股还缺稳定现金流。"
      ],
      highlightTriggers: [
        "dem0n 正面打穿",
        "lauNX 多杀开图",
        "dziugss 收尾残局",
        "coolio 暂停后追分"
      ]
    },
    players: [
      definePlayer({
        slug: "dem0n",
        inGameId: "dem0n",
        role: "star",
        aliases: ["dem0n"],
        memeTags: ["潜力股核心"],
        personaTags: ["swing-star"],
        playstyleTags: ["impact-rifle", "burst-rounds"],
        newsFocusTags: ["upset-watch"],
        personaSummary: "最像高波动核心的人，站起来时最适合把整队写成突然拉升。",
        heatLevel: "mid",
        cardPriority: 30
      }),
      definePlayer({
        slug: "launx",
        inGameId: "lauNX",
        role: "entry",
        aliases: ["lauNX"],
        memeTags: ["前线开口"],
        personaTags: ["aggressive-open"],
        playstyleTags: ["entry-bite", "first-space"],
        personaSummary: "冲开时很能带动气氛，冲不动时也会第一时间挨弹幕拷打。",
        heatLevel: "mid",
        cardPriority: 36
      }),
      definePlayer({
        slug: "krabeni",
        inGameId: "Krabeni",
        role: "support",
        aliases: ["Krabeni"],
        memeTags: ["拼图支持"],
        personaTags: ["mid-pack-worker"],
        playstyleTags: ["utility", "trade"],
        personaSummary: "偏中段拼图位，负责让高波动队不是只有火没有骨架。",
        heatLevel: "low",
        cardPriority: 47
      }),
      definePlayer({
        slug: "cmtry",
        inGameId: "cmtry",
        role: "lurker",
        aliases: ["cmtry"],
        memeTags: ["暗线位"],
        personaTags: ["quiet-route"],
        playstyleTags: ["lurking", "late-pop"],
        personaSummary: "更安静的暗线位，适合给这支波动队补一点后手。",
        heatLevel: "low",
        cardPriority: 49
      }),
      definePlayer({
        slug: "dziugss",
        inGameId: "dziugss",
        role: "closer",
        aliases: ["dziugss"],
        memeTags: ["后程终结"],
        personaTags: ["cleanup-piece"],
        playstyleTags: ["awp-or-rifle-end", "late-round"],
        personaSummary: "后程终结位，决定这支队的高波动能否真正落成地图比分。",
        heatLevel: "low",
        cardPriority: 39
      })
    ],
    coach: defineCoach({
      slug: "coolio",
      inGameId: "coolio",
      aliases: ["coolio"],
      memeTags: ["冷却教练"],
      personaTags: ["variance-manager"],
      playstyleTags: ["timeout-balance", "review"],
      personaSummary: "给高波动队降噪的人，负责让冲劲不完全变成乱流。",
      heatLevel: "low",
      cardPriority: 75
    })
  }),
  defineTeam({
    seed: 11,
    teamId: "team_astrallm",
    slug: "astrallm",
    agentTeamName: "AstraLLM",
    sourceTeamName: "Astralis",
    canonRole: "history-burden-rebuild",
    namingRationale: "Astralis 和 LLM 融合，保留星体感和老牌豪门气质，同时把项目化 AI 味自然注入。",
    worldviewSummary: "历史豪门、王朝尾韵、重建压力。这支队的每一次赢球都像在证明自己还没有彻底掉出历史叙事。",
    teamStyleTags: ["history-burden", "rebuild", "legacy-logo"],
    storylineTags: ["hooxi-command", "danish-echo", "rebuild-pressure"],
    casterFocusTags: ["machine_old_guard_command", "machine_map_point_pressure"],
    barrageFocusTags: ["history_burden", "player_targeting", "old_guard"],
    newsFocusTags: ["history-burden", "upset-watch"],
    crossCircleTags: ["customer_service_to_cleanup", "breakup_to_transfer"],
    teamAliases: ["AstraLLM", "Astralis", "A队"],
    canonNotes: [
      "这是历史负担队，不是纯 nostalgia 队。",
      "新闻和解说都要保留王朝阴影仍在的味道。"
    ],
    hooks: {
      casterAngleIds: ["machine_old_guard_command", "machine_map_point_pressure"],
      barrageAngleIds: ["history_burden", "player_targeting", "old_guard"],
      newsAngleIds: ["history-burden", "upset-watch"],
      crossCircleAngleIds: ["customer_service_to_cleanup", "breakup_to_transfer"],
      signatureMemes: ["远古王朝尾韵", "A队还想回主舞台", "历史包袱又压上来了"],
      storylineTriggers: [
        "如果 HooXi 把中盘叫顺，突出重建线不只是混时间。",
        "如果 phzy 连续关键狙，允许写老牌豪门的新气口。",
        "如果残局没收住，弹幕可以直接上历史包袱。 "
      ],
      matchupTriggers: [
        "对 G2PT 写老牌豪门互相找状态。",
        "对 FUtureToken 写历史包袱对新潜力股。"
      ],
      winStateTriggers: [
        "赢强队时用旧王朝还在找回发条。",
        "如果是年轻位站出来，新闻写重建终于有了实证。"
      ],
      lossStateTriggers: [
        "如果输法难看，优先写历史包袱压塌回合。",
        "如果决胜图崩盘，允许老观众怀旧式长文。"
      ],
      highlightTriggers: [
        "phzy 关键狙击",
        "HooXi 指挥翻盘",
        "jabbi 冲点双杀",
        "Staehr 补枪封口"
      ]
    },
    players: [
      definePlayer({
        slug: "hooxi",
        inGameId: "HooXi",
        role: "igl",
        aliases: ["HooXi", "hooxi"],
        memeTags: ["指挥位", "重建话事人"],
        personaTags: ["rebuild-caller"],
        playstyleTags: ["pace-manage", "mid-round-fix"],
        newsFocusTags: ["history-burden"],
        personaSummary: "重建阶段的话事人，赢时被写成架构回正，输时很容易成为包袱承载点。",
        heatLevel: "mid",
        cardPriority: 20
      }),
      definePlayer({
        slug: "phzy",
        inGameId: "phzy",
        role: "closer",
        aliases: ["phzy"],
        memeTags: ["新狙线"],
        personaTags: ["reset-sniper"],
        playstyleTags: ["awp-hold", "late-round-pick"],
        personaSummary: "更像重建线的新狙接口，只要站出来就会被立刻写成新阶段证据。",
        heatLevel: "mid",
        cardPriority: 18
      }),
      definePlayer({
        slug: "jabbi",
        inGameId: "jabbi",
        role: "entry",
        aliases: ["jabbi"],
        memeTags: ["前线试错"],
        personaTags: ["risk-opener"],
        playstyleTags: ["first-hit", "burst-commit"],
        personaSummary: "前线承担试错的人，决定 A 队是不是只有旧名片，没有新冲劲。",
        heatLevel: "mid",
        cardPriority: 34
      }),
      definePlayer({
        slug: "staehr",
        inGameId: "Staehr",
        role: "support",
        aliases: ["Staehr"],
        memeTags: ["稳点工兵"],
        personaTags: ["glue-core"],
        playstyleTags: ["trade-cover", "anchor-hold"],
        personaSummary: "更偏稳点工兵，是这支重建线里的低噪音必要拼图。",
        heatLevel: "mid",
        cardPriority: 43
      }),
      definePlayer({
        slug: "ryu",
        inGameId: "ryu",
        role: "lurker",
        aliases: ["ryu"],
        memeTags: ["新暗线"],
        personaTags: ["quiet-angle"],
        playstyleTags: ["late-route", "lurking"],
        personaSummary: "新暗线窗口位，适合在后续运营里继续补人物画像。",
        heatLevel: "low",
        cardPriority: 50
      })
    ],
    coach: defineCoach({
      slug: "ruggah",
      inGameId: "ruggah",
      aliases: ["ruggah"],
      memeTags: ["重建教头"],
      personaTags: ["legacy-cleanup"],
      playstyleTags: ["prep", "reset"],
      personaSummary: "要在历史阴影里把重建线稳住的教练角色，很适合新闻线长期跟踪。",
      heatLevel: "mid",
      cardPriority: 71
    })
  }),
  defineTeam({
    seed: 12,
    teamId: "team_g2pt",
    slug: "g2pt",
    agentTeamName: "G2PT",
    sourceTeamName: "G2",
    canonRole: "volatile-star-team",
    namingRationale: "G2 和 GPT 的极短融合，既像原队名，也天然适合弹幕传播。",
    worldviewSummary: "短、响、话题多。G2PT 的核心观感是明星、整活、波动和随时可能被写成长文。",
    teamStyleTags: ["star-team", "volatile", "headline-heavy"],
    storylineTags: ["hunter-lead", "sunpayus-scope", "heavygod-fire"],
    casterFocusTags: ["machine_star_carry", "machine_force_buy_shock"],
    barrageFocusTags: ["player_targeting", "history_burden", "plus_one"],
    newsFocusTags: ["upset-watch", "money-superteam"],
    crossCircleTags: ["band_to_superteam", "breakup_to_transfer", "cabinet_to_live_room_chaos"],
    teamAliases: ["G2PT", "G2", "整活队"],
    canonNotes: [
      "G2PT 是典型 headline 队。",
      "不要把它写成纯搞笑队，仍要保留明星火力和阵容想象力。"
    ],
    hooks: {
      casterAngleIds: ["machine_star_carry", "machine_force_buy_shock"],
      barrageAngleIds: ["player_targeting", "history_burden", "plus_one"],
      newsAngleIds: ["upset-watch", "money-superteam"],
      crossCircleAngleIds: ["band_to_superteam", "breakup_to_transfer", "cabinet_to_live_room_chaos"],
      signatureMemes: ["G2 又开始整活", "今天谁来写长文", "HeavyGod 一上头全队开始响"],
      storylineTriggers: [
        "如果 huNter- 和 NertZ 同时起势，写双核正面压过去。",
        "如果 SunPayus 连续开图，给狙位稳定器口径。",
        "如果整队大起大落，允许弹幕直接复读又来了。 "
      ],
      matchupTriggers: [
        "对 AstraLLM 写老牌 logo 对老牌 logo。",
        "对 Falcon-7B 写明星阵互比天花板。"
      ],
      winStateTriggers: [
        "如果明星位高光兑现，新闻可以偏银河战舰副线。",
        "如果是下半场突然回魂，解说突出整活队终于把活整对了。"
      ],
      lossStateTriggers: [
        "如果进攻端散，写整活整到自己身上。",
        "如果关键图又掉，弹幕允许长文和复读共存。"
      ],
      highlightTriggers: [
        "SunPayus 狙开图",
        "NertZ 正面串烧",
        "huNter- 中期带转点",
        "HeavyGod 暴力补枪"
      ]
    },
    players: [
      definePlayer({
        slug: "hunter",
        inGameId: "huNter-",
        role: "igl",
        aliases: ["huNter-", "hunter"],
        memeTags: ["老牌核心"],
        personaTags: ["headline-caller"],
        playstyleTags: ["rifle-call", "pace-switch"],
        newsFocusTags: ["money-superteam"],
        personaSummary: "有老牌核心气质的指挥位，打顺时像明星队真正串起来的轴心。",
        heatLevel: "mid",
        cardPriority: 19
      }),
      definePlayer({
        slug: "nertz",
        inGameId: "NertZ",
        role: "entry",
        aliases: ["NertZ"],
        memeTags: ["爆点位"],
        personaTags: ["impact-opener"],
        playstyleTags: ["entry-bite", "mid-round-swing"],
        personaSummary: "爆点位，决定 G2PT 的进攻是不是只有名气没有冲击。",
        heatLevel: "mid",
        cardPriority: 17
      }),
      definePlayer({
        slug: "sunpayus",
        inGameId: "SunPayus",
        role: "closer",
        aliases: ["SunPayus"],
        memeTags: ["狙位稳定器"],
        personaTags: ["scope-anchor"],
        playstyleTags: ["awp-hold", "late-finish"],
        personaSummary: "偏稳定器属性的狙位，越乱越需要他把画面拉直。",
        heatLevel: "mid",
        cardPriority: 25
      }),
      definePlayer({
        slug: "heavygod",
        inGameId: "HeavyGod",
        role: "star",
        aliases: ["HeavyGod"],
        memeTags: ["火力神"],
        personaTags: ["headline-rifle"],
        playstyleTags: ["explosive-rifle", "space-winning"],
        personaSummary: "最容易把一整图音量拉起来的火力位，适合玩机器式解说直接抬成节目效果中心。",
        heatLevel: "mid",
        cardPriority: 15
      }),
      definePlayer({
        slug: "matys",
        inGameId: "MATYS",
        role: "support",
        aliases: ["MATYS"],
        memeTags: ["补位拼图"],
        personaTags: ["utility-frame"],
        playstyleTags: ["support", "retrade"],
        personaSummary: "补位拼图位，决定这支队的明星线是不是能真正稳定连续输出。",
        heatLevel: "mid",
        cardPriority: 40
      })
    ],
    coach: defineCoach({
      slug: "saw",
      inGameId: "sAw",
      aliases: ["sAw"],
      memeTags: ["教练修线"],
      personaTags: ["structure-fixer"],
      playstyleTags: ["prep", "timeout"],
      personaSummary: "负责给 G2PT 这种波动 headline 队补一条更稳定的底层执行线。",
      heatLevel: "mid",
      cardPriority: 74
    })
  }),
  defineTeam({
    seed: 13,
    teamId: "team_legacy_v1",
    slug: "legacy-v1",
    agentTeamName: "Legacy.v1",
    sourceTeamName: "Legacy",
    canonRole: "grind-underdog",
    namingRationale: "Legacy 和 v1 组合，直接把老版本、祖传代码和旧系统气味带进世界观。",
    worldviewSummary: "更偏老派 grind 队。不是牌面最大的队，但很适合做硬仗、泥地和老版本气味的内容资产。",
    teamStyleTags: ["legacy-code", "grind", "brazil-underdog"],
    storylineTags: ["art-chaos", "dumau-carry", "old-version-survival"],
    casterFocusTags: ["machine_force_buy_shock", "machine_old_guard_command"],
    barrageFocusTags: ["player_targeting", "research", "history_burden"],
    newsFocusTags: ["upset-watch", "brazil-heat"],
    crossCircleTags: ["cabinet_to_live_room_chaos", "lifetime_to_rivalry"],
    teamAliases: ["Legacy.v1", "Legacy", "祖传版"],
    canonNotes: [
      "Legacy.v1 的重点是祖传味和 grind 感。",
      "不是每次都要写成笑点，也可以写成顽强。"
    ],
    hooks: {
      casterAngleIds: ["machine_force_buy_shock", "machine_old_guard_command"],
      barrageAngleIds: ["player_targeting", "research", "history_burden"],
      newsAngleIds: ["upset-watch", "brazil-heat"],
      crossCircleAngleIds: ["cabinet_to_live_room_chaos", "lifetime_to_rivalry"],
      signatureMemes: ["祖传版还在跑", "arT 又带人冲沟里去了", "泥地硬仗味出来了"],
      storylineTriggers: [
        "arT 带快节奏时，写祖传老版本代码仍然敢跑。",
        "dumau 如果接管输出，新闻转到老派队也有真核心。",
        "如果比赛打成泥地，解说允许故意加重 grind 感。 "
      ],
      matchupTriggers: [
        "对 Prompt Gaming 是巴西线内部对冲。",
        "对 Bit8 写中后段种子泥地混战。"
      ],
      winStateTriggers: [
        "如果赢强队，新闻直接走祖传代码仍能跑通。",
        "如果靠硬仗回合拿图，弹幕可以刷今天这版本真没白维护。"
      ],
      lossStateTriggers: [
        "如果快节奏自爆，写祖传代码报错。",
        "如果残局太碎，允许研发失败口径。"
      ],
      highlightTriggers: [
        "arT 冲锋连开",
        "dumau 多杀翻图",
        "latto 补枪站住",
        "saadzin 收尾残局"
      ]
    },
    players: [
      definePlayer({
        slug: "art",
        inGameId: "arT",
        role: "igl",
        aliases: ["arT", "art"],
        memeTags: ["祖传冲锋", "快节奏"],
        personaTags: ["chaotic-caller"],
        playstyleTags: ["all-in-pace", "aggressive-mid"],
        newsFocusTags: ["brazil-heat", "upset-watch"],
        personaSummary: "最像祖传代码的人。跑起来时观感很猛，报错时也会立刻被全屏围观。",
        heatLevel: "mid",
        cardPriority: 18
      }),
      definePlayer({
        slug: "dumau",
        inGameId: "dumau",
        role: "star",
        aliases: ["dumau"],
        memeTags: ["巴西火力点"],
        personaTags: ["carry-engine"],
        playstyleTags: ["rifle-pop", "clutch-impact"],
        personaSummary: "最适合从 grind 队里被抬成 headline 的火力点。",
        heatLevel: "mid",
        cardPriority: 21
      }),
      definePlayer({
        slug: "latto",
        inGameId: "latto",
        role: "support",
        aliases: ["latto"],
        memeTags: ["补位层"],
        personaTags: ["support-frame"],
        playstyleTags: ["anchor", "utility"],
        personaSummary: "祖传版里负责把局势缝起来的人。",
        heatLevel: "low",
        cardPriority: 43
      }),
      definePlayer({
        slug: "n1ssim",
        inGameId: "n1ssim",
        role: "lurker",
        aliases: ["n1ssim"],
        memeTags: ["后手拼图"],
        personaTags: ["quiet-wrap"],
        playstyleTags: ["late-route", "lurking"],
        personaSummary: "偏安静的后手拼图，让队伍不至于只剩一股冲劲。",
        heatLevel: "low",
        cardPriority: 49
      }),
      definePlayer({
        slug: "saadzin",
        inGameId: "saadzin",
        role: "entry",
        aliases: ["saadzin"],
        memeTags: ["前顶位"],
        personaTags: ["impact-opener"],
        playstyleTags: ["entry", "space-take"],
        personaSummary: "前顶位，最容易把 Legacy.v1 的泥地味变成真实的回合优势。",
        heatLevel: "low",
        cardPriority: 35
      })
    ],
    coach: defineCoach({
      slug: "adrrr",
      inGameId: "adrrr",
      aliases: ["adrrr"],
      memeTags: ["老派教练"],
      personaTags: ["grind-keeper"],
      playstyleTags: ["prep", "review"],
      personaSummary: "负责把祖传 grind 感维护成一套能继续跑的系统。",
      heatLevel: "low",
      cardPriority: 78
    })
  }),
  defineTeam({
    seed: 14,
    teamId: "team_bit8",
    slug: "bit8",
    agentTeamName: "Bit8",
    sourceTeamName: "B8",
    canonRole: "cisdog-underdog",
    namingRationale: "B8 转成 Bit8，让 8-bit 计算机感和小体量硬拼感一起保留下来。",
    worldviewSummary: "更偏硬拼、朴素、下半区带点粗粝感的队。不是最花哨的，但很适合拿来写苦战和顽强。",
    teamStyleTags: ["cis-underdog", "rough-fight", "8bit-grit"],
    storylineTags: ["npl-redemption", "alex666-call", "small-team-grit"],
    casterFocusTags: ["machine_force_buy_shock", "machine_map_point_pressure"],
    barrageFocusTags: ["player_targeting", "plus_one", "history_burden"],
    newsFocusTags: ["upset-watch"],
    crossCircleTags: ["cabinet_to_live_room_chaos", "lifetime_to_rivalry"],
    teamAliases: ["Bit8", "B8", "8bit队"],
    canonNotes: [
      "Bit8 的价值在于朴素硬拼感。",
      "不是 headline 主队，但在淘汰赛叙事里很好用。"
    ],
    hooks: {
      casterAngleIds: ["machine_force_buy_shock", "machine_map_point_pressure"],
      barrageAngleIds: ["player_targeting", "plus_one", "history_burden"],
      newsAngleIds: ["upset-watch"],
      crossCircleAngleIds: ["cabinet_to_live_room_chaos", "lifetime_to_rivalry"],
      signatureMemes: ["8bit 也敢跟你拼", "小队硬骨头", "npl 今天要证明自己"],
      storylineTriggers: [
        "如果 npl 打出高光，优先写证明线。",
        "如果 alex666 指挥强起成功，允许低配也敢冲的语气。",
        "如果全队打成硬泥地，解说可以把粗粝感写足。 "
      ],
      matchupTriggers: [
        "对 Legacy.v1 写泥地互打。",
        "对 Neural Vincere 写小队挑战豪门体系。"
      ],
      winStateTriggers: [
        "爆冷时新闻走硬骨头咬下一块。",
        "如果是多人接力，不要只写单人奇迹。"
      ],
      lossStateTriggers: [
        "如果后程断掉，写体量差距终于显现。",
        "如果强起失败，弹幕可以全屏复读没绷住。"
      ],
      highlightTriggers: [
        "npl 正面多杀",
        "alex666 强起指挥",
        "kensizor 冲点双杀",
        "esenthial 补枪站住"
      ]
    },
    players: [
      definePlayer({
        slug: "alex666",
        inGameId: "alex666",
        role: "igl",
        aliases: ["alex666"],
        memeTags: ["小队指挥"],
        personaTags: ["grit-caller"],
        playstyleTags: ["pace-poke", "mid-round-adjust"],
        personaSummary: "小体量队伍的硬骨头指挥，强项不是牌面，而是敢拼。",
        heatLevel: "low",
        cardPriority: 29
      }),
      definePlayer({
        slug: "npl",
        inGameId: "npl",
        role: "star",
        aliases: ["npl"],
        memeTags: ["证明线"],
        personaTags: ["redemption-candidate"],
        playstyleTags: ["rifle-impact", "confidence-duel"],
        personaSummary: "最容易被写成证明线的人，只要打一场硬仗就会立刻有故事。",
        heatLevel: "mid",
        cardPriority: 22
      }),
      definePlayer({
        slug: "kensizor",
        inGameId: "kensizor",
        role: "entry",
        aliases: ["kensizor"],
        memeTags: ["前顶位"],
        personaTags: ["contact-piece"],
        playstyleTags: ["entry", "space"],
        personaSummary: "更粗粝的前顶位，冲开了就能瞬间把小队气势抬起来。",
        heatLevel: "low",
        cardPriority: 36
      }),
      definePlayer({
        slug: "esenthial",
        inGameId: "esenthial",
        role: "support",
        aliases: ["esenthial"],
        memeTags: ["补位位"],
        personaTags: ["support-glue"],
        playstyleTags: ["utility", "anchor"],
        personaSummary: "负责让 Bit8 的硬拼不至于完全失去回合结构。",
        heatLevel: "low",
        cardPriority: 45
      }),
      definePlayer({
        slug: "s1zzi",
        inGameId: "s1zzi",
        role: "lurker",
        aliases: ["s1zzi"],
        memeTags: ["后手路线"],
        personaTags: ["late-route"],
        playstyleTags: ["lurking", "flank"],
        personaSummary: "更安静的后手角色，用来给粗粝画风补一点后劲。",
        heatLevel: "low",
        cardPriority: 48
      })
    ],
    coach: defineCoach({
      slug: "maddened",
      inGameId: "maddened",
      aliases: ["maddened"],
      memeTags: ["小队教头"],
      personaTags: ["underdog-manager"],
      playstyleTags: ["review", "simplify"],
      personaSummary: "更像硬拼队的维稳器，确保这支队至少能把自己最擅长的东西打出来。",
      heatLevel: "low",
      cardPriority: 79
    })
  }),
  defineTeam({
    seed: 15,
    teamId: "team_prompt_gaming",
    slug: "prompt-gaming",
    agentTeamName: "Prompt Gaming",
    sourceTeamName: "paiN Gaming",
    canonRole: "brazil-upset-machine",
    namingRationale: "用 Prompt 替换 paiN，结构接近、传播性强，也天然贴到 AI 世界观里。",
    worldviewSummary: "巴西线的另一支重点队，更偏强度和节奏双波动。写得好时既可以热血，也可以直接节目效果化。",
    teamStyleTags: ["brazil-heat", "upset-machine", "momentum-team"],
    storylineTags: ["biguzera-core", "saffee-lock", "vsm-energy"],
    casterFocusTags: ["machine_force_buy_shock", "machine_star_carry"],
    barrageFocusTags: ["player_targeting", "research", "cross_circle"],
    newsFocusTags: ["brazil-heat", "upset-watch"],
    crossCircleTags: ["cabinet_to_live_room_chaos", "band_to_superteam"],
    teamAliases: ["Prompt Gaming", "paiN", "提示词队"],
    canonNotes: [
      "Prompt Gaming 保留巴西热度和节目效果双属性。",
      "它是正赛 16 队正式成员，不是为 PhaseClan 让位的边角料。"
    ],
    hooks: {
      casterAngleIds: ["machine_force_buy_shock", "machine_star_carry"],
      barrageAngleIds: ["player_targeting", "research", "cross_circle"],
      newsAngleIds: ["brazil-heat", "upset-watch"],
      crossCircleAngleIds: ["cabinet_to_live_room_chaos", "band_to_superteam"],
      signatureMemes: ["提示词队又写出新句子了", "biguzera 开始接管", "巴西气压拉满"],
      storylineTriggers: [
        "biguzera 带起节奏时，优先往队伍核心和情绪发动机写。",
        "如果 saffee 后程稳定开火，补足这队不是只有气势。",
        "如果巴西热度滚起来，弹幕可直接群魔乱舞。 "
      ],
      matchupTriggers: [
        "对 FurIA 是巴西热度内战。",
        "对 FUtureToken 是中后段爆冷权争夺。"
      ],
      winStateTriggers: [
        "如果爆冷强队，新闻按巴西热度点燃全场。",
        "如果全队高压进攻成片，解说要强调队伍不是一两个人在抡。"
      ],
      lossStateTriggers: [
        "如果枪感掉线，写提示词没调对。",
        "如果回合太碎，允许研发失败和巴西热度塌了并行。"
      ],
      highlightTriggers: [
        "biguzera 多杀指挥",
        "saffee 关键狙",
        "vsm 正面破点",
        "snow 补枪连锁"
      ]
    },
    players: [
      definePlayer({
        slug: "vsm",
        inGameId: "vsm",
        role: "igl",
        aliases: ["vsm"],
        memeTags: ["节奏头"],
        personaTags: ["energy-caller"],
        playstyleTags: ["pace-up", "emotion-call"],
        personaSummary: "更偏情绪发动机型指挥，起势时能把整队点燃。",
        heatLevel: "mid",
        cardPriority: 24
      }),
      definePlayer({
        slug: "biguzera",
        inGameId: "biguzera",
        role: "star",
        aliases: ["biguzera"],
        memeTags: ["巴西核心"],
        personaTags: ["centerpiece"],
        playstyleTags: ["rifle-pressure", "mid-round-impact"],
        newsFocusTags: ["brazil-heat"],
        personaSummary: "最像队伍中心的一环，只要 Prompt Gaming 真往前走，他就一定会被放进标题里。",
        heatLevel: "mid",
        cardPriority: 18
      }),
      definePlayer({
        slug: "piriajr",
        inGameId: "piriajr",
        role: "entry",
        aliases: ["piriajr"],
        memeTags: ["前顶火点"],
        personaTags: ["front-pressure"],
        playstyleTags: ["entry", "burst"],
        personaSummary: "把 Prompt 的热度转成真正破点回合的火点位。",
        heatLevel: "low",
        cardPriority: 35
      }),
      definePlayer({
        slug: "saffee",
        inGameId: "saffee",
        role: "closer",
        aliases: ["saffee"],
        memeTags: ["后程狙"],
        personaTags: ["steady-scope"],
        playstyleTags: ["awp-hold", "late-close"],
        personaSummary: "偏稳的终结位，给这支高热度队补一个能真正锁门的人。",
        heatLevel: "mid",
        cardPriority: 27
      }),
      definePlayer({
        slug: "snow",
        inGameId: "snow",
        role: "support",
        aliases: ["snow"],
        memeTags: ["辅助拼图"],
        personaTags: ["glue-piece"],
        playstyleTags: ["trade", "utility-support"],
        personaSummary: "更安静的拼图位，负责给高音量队伍补回合骨架。",
        heatLevel: "low",
        cardPriority: 44
      })
    ],
    coach: defineCoach({
      slug: "rikz",
      inGameId: "rikz",
      aliases: ["rikz"],
      memeTags: ["巴西教练线"],
      personaTags: ["heat-manager"],
      playstyleTags: ["prep", "reset"],
      personaSummary: "给巴西高热度队兜底的教练角色，适合在新闻里长期挂一条幕后线。",
      heatLevel: "low",
      cardPriority: 77
    })
  }),
  defineTeam({
    seed: 16,
    teamId: "team_phaseclan",
    slug: "phaseclan",
    agentTeamName: "PhaseClan",
    sourceTeamName: "FaZe Clan",
    status: "special-invite",
    canonRole: "special-invite-flow-team",
    namingRationale: "把 FaZe 改成 Phase，既保留语音影子，也让 inference phase、phase shift 等世界观梗天然成立。",
    worldviewSummary: "官方特邀递补队，也是天然流量队。不是最稳定的一队，但一定是最容易把直播间音量打满的一队之一。",
    teamStyleTags: ["special-invite", "flow-team", "high-variance"],
    storylineTags: ["phase-shift", "twistzz-office", "broky-clutch", "special-invite-drama"],
    casterFocusTags: ["machine_special_invite_drama", "machine_star_carry", "machine_old_guard_command"],
    barrageFocusTags: ["special_invite", "player_targeting", "old_guard", "cross_circle"],
    newsFocusTags: ["special_invite", "money-superteam", "upset-watch"],
    crossCircleTags: ["band_to_superteam", "breakup_to_transfer", "cabinet_to_live_room_chaos"],
    teamAliases: ["PhaseClan", "FaZe", "相位队", "流量队", "特邀队"],
    canonNotes: [
      "PhaseClan 以 Special Invite 递补正赛。",
      "当前教练位仍为项目保留槽，不写成已正式确认。"
    ],
    hooks: {
      casterAngleIds: ["machine_special_invite_drama", "machine_star_carry", "machine_old_guard_command"],
      barrageAngleIds: ["special_invite", "player_targeting", "old_guard", "cross_circle"],
      newsAngleIds: ["special_invite", "money-superteam", "upset-watch"],
      crossCircleAngleIds: ["band_to_superteam", "breakup_to_transfer", "cabinet_to_live_room_chaos"],
      signatureMemes: ["没进也能进", "phase shift 直接切进正赛", "流量队还是来了"],
      storylineTriggers: [
        "赛前介绍或首图开场时，先把 Special Invite 递补身份打清楚。",
        "broky 或 Twistzz 站出来时，要把流量队和真火力同时挂上。",
        "如果输赢都很戏剧，直播间可以直接走相位切换和节目组懂流量。 "
      ],
      matchupTriggers: [
        "对 Falcon-7B 是流量豪阵对流量豪阵。",
        "对 VitaLLMty 是特邀队挑战头号种子。"
      ],
      winStateTriggers: [
        "赢强队时新闻直接写特邀席位把正赛切穿了。",
        "如果是老将或明星位接管，突出流量队不是白给参赛。"
      ],
      lossStateTriggers: [
        "如果前中期乱，写相位切换过载。",
        "如果关键残局没收住，允许弹幕刷特邀通道也有尽头。"
      ],
      highlightTriggers: [
        "broky 关键残局",
        "Twistzz 多杀带图",
        "frozen 正面定点",
        "相位队逆风连追"
      ]
    },
    players: [
      definePlayer({
        slug: "broky",
        inGameId: "broky",
        role: "closer",
        aliases: ["broky"],
        memeTags: ["残局位", "流量队终结点"],
        personaTags: ["special-invite-finisher"],
        playstyleTags: ["awp-late", "clutch-finish"],
        newsFocusTags: ["special_invite"],
        personaSummary: "特邀流量队里的后程终结点，最适合在关键图里给 PhaseClan 正名。",
        heatLevel: "high",
        cardPriority: 16
      }),
      definePlayer({
        slug: "twistzz",
        inGameId: "Twistzz",
        role: "igl",
        aliases: ["Twistzz", "总监", "披肩"],
        memeTags: ["总监", "披肩"],
        personaTags: ["office-face", "style-caller"],
        playstyleTags: ["mid-round-call", "rifle-finish"],
        newsFocusTags: ["special_invite", "money-superteam"],
        personaSummary: "天然有牌面的指挥位，也是 PhaseClan 把流量感转成正式赛事叙事的第一张脸。",
        heatLevel: "high",
        cardPriority: 10
      }),
      definePlayer({
        slug: "jcobbb",
        inGameId: "jcobbb",
        role: "entry",
        aliases: ["jcobbb"],
        memeTags: ["新前线"],
        personaTags: ["fresh-opener"],
        playstyleTags: ["entry", "chaos-open"],
        personaSummary: "更年轻的新前线位，适合在 PhaseClan 里承担新鲜冲击点的职责。",
        heatLevel: "mid",
        cardPriority: 34
      }),
      definePlayer({
        slug: "frozen",
        inGameId: "frozen",
        role: "star",
        aliases: ["frozen"],
        memeTags: ["硬核火力"],
        personaTags: ["stable-star"],
        playstyleTags: ["rifle-core", "site-break"],
        newsFocusTags: ["special_invite"],
        personaSummary: "让 PhaseClan 不至于只剩流量标签的硬核火力位。",
        heatLevel: "high",
        cardPriority: 17
      }),
      definePlayer({
        slug: "neityu",
        inGameId: "Neityu",
        role: "support",
        aliases: ["Neityu"],
        memeTags: ["补位槽"],
        personaTags: ["future-interface"],
        playstyleTags: ["support", "utility"],
        personaSummary: "当前更偏未来接口位，适合作为后续继续补完人物层的一块空白板。",
        heatLevel: "low",
        cardPriority: 46
      })
    ],
    coach: defineCoach({
      slug: "coach-tbd",
      inGameId: "TBD",
      status: "tbd",
      aliases: ["TBD", "Coach TBD", "PhaseCoach TBD"],
      memeTags: ["教练待定", "保留接口"],
      personaTags: ["reserved-slot"],
      playstyleTags: ["future-binding"],
      newsFocusTags: ["special_invite"],
      crossCircleTags: ["customer_service_to_cleanup"],
      personaSummary: "PhaseClan 当前未锁定正式教练人选。该资产文件仅用于预留教练 agent、模型绑定和运营卡位接口。",
      heatLevel: "low",
      cardPriority: 90,
      canonNotes: [
        "当前不是正式确认教练，只是资产保留槽。"
      ]
    })
  })
];

const roleProfiles = loadRoleProfiles();

function buildEntity(team, spec, entityType) {
  const roleProfile = roleProfiles.get(roleProfileKey(team.agentTeamName, spec.inGameId));
  const resolvedRole = roleProfile?.primary_role ?? spec.role;
  const defaults = roleDefaults[resolvedRole] ?? roleDefaults[spec.role] ?? {};
  const entityIdPrefix = entityType === "coach" ? "coach" : "player";
  const entityId = `${entityIdPrefix}_${team.slug.replace(/-/g, "_")}_${spec.slug.replace(/-/g, "_")}`;
  const casterFocusTags = uniq([...defaults.casterFocusTags ?? [], ...spec.casterFocusTags ?? []]);
  const barrageFocusTags = uniq([...defaults.barrageFocusTags ?? [], ...spec.barrageFocusTags ?? []]);
  const crossCircleTags = uniq([...defaults.crossCircleTags ?? [], ...spec.crossCircleTags ?? []]);
  const personaTags = uniq([...defaults.personaTags ?? [], ...spec.personaTags ?? []]);
  const playstyleTags = uniq([...defaults.playstyleTags ?? [], ...spec.playstyleTags ?? []]);
  const newsFocusTags = uniq(spec.newsFocusTags.length > 0 ? spec.newsFocusTags : team.newsFocusTags);
  const memeTags = uniq(spec.memeTags);
  const status = spec.status ?? "active";

  return {
    slug: spec.slug,
    entity_id: entityId,
    entity_type: entityType,
    team_id: team.teamId,
    real_name: null,
    in_game_id: spec.inGameId,
    display_name: spec.inGameId,
    role: resolvedRole,
    status,
    cs_role_profile: roleProfile ?? {
      source_path: null,
      source_team_name: team.agentTeamName,
      member_type: entityType,
      raw_position: spec.role,
      raw_position_parts: [spec.role],
      primary_role: resolvedRole,
      secondary_roles: [],
      position_tags: [resolvedRole],
      confidence: "unverified",
      notes: "Generated from local asset fallback because no raw role profile was found.",
      agent_major_responsibilities: uniq([roleResponsibilityMap[resolvedRole]].filter(Boolean))
    },
    aliases: uniq(spec.aliases),
    meme_tags: memeTags,
    persona_tags: personaTags,
    playstyle_tags: playstyleTags,
    caster_focus_tags: casterFocusTags,
    barrage_focus_tags: barrageFocusTags,
    news_focus_tags: newsFocusTags,
    cross_circle_tags: crossCircleTags,
    future_agent_profile: {
      persona_summary: spec.personaSummary,
      voice_mode: "cn-live-room-competitive",
      narrative_axes: uniq([...newsFocusTags, ...personaTags]).slice(0, 6),
      reserved_memory_slots: ["career-arc", "role-history", "signature-rounds", "rivalries"]
    },
    future_driver_binding: makeFutureDriverBinding({
      entityId,
      entityType,
      role: resolvedRole,
      promptBiasTags: uniq([...playstyleTags, ...personaTags]),
      spec
    }),
    ops_hooks: {
      heat_level: spec.heatLevel,
      segment_tags: uniq([...memeTags, ...newsFocusTags]).slice(0, 6),
      card_priority: spec.cardPriority,
      broadcast_entry_points: casterFocusTags.slice(0, 3)
    },
    canon_notes: spec.canonNotes
  };
}

function enrichTeam(team) {
  const players = team.players.map((player) => buildEntity(team, player, "player"));
  const coach = buildEntity(team, team.coach, "coach");
  return {
    ...team,
    players,
    coach
  };
}

function makeTeamJson(team) {
  const strategyPath = existingStrategyRelativePath(team.slug);
  return {
    team_id: team.teamId,
    team_slug: team.slug,
    agent_team_name: team.agentTeamName,
    source_team_name: team.sourceTeamName,
    seed: team.seed,
    status: team.status,
    canon_role: team.canonRole,
    naming_rationale: team.namingRationale,
    worldview_summary: team.worldviewSummary,
    team_style_tags: team.teamStyleTags,
    storyline_tags: team.storylineTags,
    caster_focus_tags: team.casterFocusTags,
    barrage_focus_tags: team.barrageFocusTags,
    news_focus_tags: team.newsFocusTags,
    cross_circle_tags: team.crossCircleTags,
    processed_paths: {
      team: relativeProcessedPath("teams", team.slug, "team.json"),
      roster: relativeProcessedPath("teams", team.slug, "roster.json"),
      hooks: relativeProcessedPath("teams", team.slug, "hooks.json"),
      ...(strategyPath ? { strategy: strategyPath } : {})
    },
    version: VERSION,
    canon_notes: team.canonNotes
  };
}

function makeRosterJson(team) {
  return {
    team_id: team.teamId,
    active_players: team.players.map((player) => player.entity_id),
    head_coach: team.slug === "phaseclan" && team.coach.status === "tbd" ? null : team.coach.entity_id,
    roster_version: VERSION,
    source_snapshot_date: SNAPSHOT_DATE,
    canon_notes: team.slug === "phaseclan"
      ? [
          "PhaseClan 当前正式教练仍未在 canon 中锁定。",
          `保留教练资产槽：${team.coach.entity_id}`
        ]
      : team.canonNotes
  };
}

function makeHooksJson(team) {
  return {
    team_id: team.teamId,
    caster_angle_ids: team.hooks.casterAngleIds,
    barrage_angle_ids: team.hooks.barrageAngleIds,
    news_angle_ids: team.hooks.newsAngleIds,
    cross_circle_angle_ids: team.hooks.crossCircleAngleIds,
    signature_memes: team.hooks.signatureMemes,
    storyline_triggers: team.hooks.storylineTriggers,
    matchup_triggers: team.hooks.matchupTriggers,
    win_state_triggers: team.hooks.winStateTriggers,
    loss_state_triggers: team.hooks.lossStateTriggers,
    highlight_triggers: team.hooks.highlightTriggers
  };
}

function renderTeamMarkdown(team) {
  return `
# ${team.agentTeamName}

## Canon 摘要
- 原型队伍：${team.sourceTeamName}
- 正赛种子：${team.seed}
- 当前状态：${team.status}
- 世界观身份：${team.canonRole}

## 命名说明
${team.namingRationale}

## 世界观定位
${team.worldviewSummary}

## 主要风格标签
${renderList(team.teamStyleTags)}

## 当前故事线
${renderList(team.storylineTags)}

## 维护备注
${renderList(team.canonNotes)}
`;
}

function renderRosterMarkdown(team) {
  const playerLines = team.players.map((player) => (
    `${player.display_name} | ${player.role} | ${player.cs_role_profile.raw_position} | ${player.cs_role_profile.confidence} | ${player.entity_id}`
  ));
  const coachLine = team.slug === "phaseclan" && team.coach.status === "tbd"
    ? `- 正式教练：未锁定（保留槽 ${team.coach.entity_id}，${team.coach.cs_role_profile.raw_position}，可信度 ${team.coach.cs_role_profile.confidence}）`
    : `- 正式教练：${team.coach.display_name} (${team.coach.entity_id}，${team.coach.cs_role_profile.raw_position}，可信度 ${team.coach.cs_role_profile.confidence})`;

  return `
# ${team.agentTeamName} Roster

## Active Five
${renderList(playerLines)}

## Coach
${coachLine}

## Snapshot
- 阵容版本：${VERSION}
- 快照日期：${SNAPSHOT_DATE}

## Canon Notes
${renderList(makeRosterJson(team).canon_notes)}
`;
}

function renderHooksMarkdown(team) {
  return `
# ${team.agentTeamName} Hooks

## 解说入口
${renderList(renderLabeledIds(team.hooks.casterAngleIds))}

## 弹幕入口
${renderList(renderLabeledIds(team.hooks.barrageAngleIds))}

## 新闻入口
${renderList(renderLabeledIds(team.hooks.newsAngleIds))}

## 跨圈入口
${renderList(renderLabeledIds(team.hooks.crossCircleAngleIds))}

## 标志性梗点
${renderList(team.hooks.signatureMemes)}

## 剧情触发器
${renderList(team.hooks.storylineTriggers)}

## 对位触发器
${renderList(team.hooks.matchupTriggers)}

## 赢局触发器
${renderList(team.hooks.winStateTriggers)}

## 输局触发器
${renderList(team.hooks.lossStateTriggers)}

## 高光入口
${renderList(team.hooks.highlightTriggers)}
`;
}

function renderEntityMarkdown(team, entity) {
  return `
# ${entity.display_name}

## Snapshot
- 队伍：${team.agentTeamName}
- 类型：${entity.entity_type}
- 角色：${entity.role}
- 当前状态：${entity.status}
- 公开 ID：${entity.in_game_id}
- 法定姓名：待回填

## CS Role Profile
- 原始位置：${entity.cs_role_profile.raw_position}
- 主位置：${entity.cs_role_profile.primary_role}
- 次级位置：${entity.cs_role_profile.secondary_roles.length > 0 ? entity.cs_role_profile.secondary_roles.join(", ") : "none"}
- 可信度：${entity.cs_role_profile.confidence}
- Agent Major 职责：${entity.cs_role_profile.agent_major_responsibilities.join("；") || "待补充"}
- 备注：${entity.cs_role_profile.notes}
- 来源：${entity.cs_role_profile.source_path ?? "generated-fallback"}

## Alias
${renderList(entity.aliases)}

## Persona
${entity.future_agent_profile.persona_summary}

## Meme Tags
${renderList(entity.meme_tags)}

## Playstyle Tags
${renderList(entity.playstyle_tags)}

## Broadcast / Barrage / News
- 解说标签：${entity.caster_focus_tags.join(", ")}
- 弹幕标签：${entity.barrage_focus_tags.join(", ")}
- 新闻标签：${entity.news_focus_tags.join(", ")}
- 跨圈标签：${entity.cross_circle_tags.join(", ")}

## Future Interfaces
- agent 人格接口：${entity.future_agent_profile.narrative_axes.join(", ")}
- 模型绑定接口：${entity.future_driver_binding.role_template_id} / ${entity.future_driver_binding.preferred_driver_model_id}
- 模型运行状态：v1 asset preallocation only，runtime_enabled=false
- 产品运营接口：${entity.ops_hooks.segment_tags.join(", ")}

## Canon Notes
${renderList(entity.canon_notes.length > 0 ? entity.canon_notes : ["当前以公开比赛 ID 为主，等待后续补 legal name 与更细人物画像。"])}
`;
}

function buildTeamAliasJson(enrichedTeams) {
  return {
    glossary_id: "team-aliases",
    scope: "glossary",
    version: VERSION,
    entries: enrichedTeams.map((team) => ({
      team_id: team.teamId,
      agent_team_name: team.agentTeamName,
      aliases: team.teamAliases
    }))
  };
}

function buildPlayerAliasJson(enrichedTeams) {
  return {
    glossary_id: "player-aliases",
    scope: "glossary",
    version: VERSION,
    entries: enrichedTeams.flatMap((team) =>
      team.players.map((player) => ({
        entity_id: player.entity_id,
        team_id: team.teamId,
        in_game_id: player.in_game_id,
        aliases: player.aliases
      }))
    )
  };
}

function renderTeamAliasMarkdown(aliasJson) {
  const rows = aliasJson.entries.map(
    (entry) => `- ${entry.agent_team_name} (${entry.team_id})：${entry.aliases.join(" / ")}`
  );
  return `
# Team Aliases

${rows.join("\n")}
`;
}

function renderPlayerAliasMarkdown(aliasJson) {
  const rows = aliasJson.entries.map(
    (entry) => `- ${entry.in_game_id} (${entry.entity_id})：${entry.aliases.join(" / ")}`
  );
  return `
# Player Aliases

${rows.join("\n")}
`;
}

function buildTeamsIndex(enrichedTeams) {
  return {
    index_id: "teams-index",
    version: VERSION,
    tournament: "Agent Major",
    stage: "Playoffs",
    format: "16-team single elimination BO3",
    source_snapshot_date: SNAPSHOT_DATE,
    teams: enrichedTeams.map((team) => ({
      seed: team.seed,
      team_id: team.teamId,
      team_slug: team.slug,
      source_team_name: team.sourceTeamName,
      agent_team_name: team.agentTeamName,
      status: team.status,
      canon_role: team.canonRole,
      team_json_path: relativeProcessedPath("teams", team.slug, "team.json"),
      roster_json_path: relativeProcessedPath("teams", team.slug, "roster.json"),
      hooks_json_path: relativeProcessedPath("teams", team.slug, "hooks.json"),
      ...(existingStrategyRelativePath(team.slug) ? { strategy_json_path: existingStrategyRelativePath(team.slug) } : {})
    }))
  };
}

function buildEntitiesIndex(enrichedTeams) {
  return {
    index_id: "entities-index",
    version: VERSION,
    source_snapshot_date: SNAPSHOT_DATE,
    entities: enrichedTeams.flatMap((team) => {
      const players = team.players.map((player) => ({
        entity_id: player.entity_id,
        entity_type: player.entity_type,
        team_id: player.team_id,
        display_name: player.display_name,
        in_game_id: player.in_game_id,
        role: player.role,
        cs_role_profile: {
          raw_position: player.cs_role_profile.raw_position,
          primary_role: player.cs_role_profile.primary_role,
          confidence: player.cs_role_profile.confidence
        },
        status: player.status,
        json_path: relativeProcessedPath("teams", team.slug, "players", `${entityFileSlug(player)}.agent.json`)
      }));
      const coach = {
        entity_id: team.coach.entity_id,
        entity_type: team.coach.entity_type,
        team_id: team.coach.team_id,
        display_name: team.coach.display_name,
        in_game_id: team.coach.in_game_id,
        role: team.coach.role,
        cs_role_profile: {
          raw_position: team.coach.cs_role_profile.raw_position,
          primary_role: team.coach.cs_role_profile.primary_role,
          confidence: team.coach.cs_role_profile.confidence
        },
        status: team.coach.status,
        json_path: relativeProcessedPath("teams", team.slug, "coach", `${team.coach.slug === "coach-tbd" ? "coach-tbd" : entityFileSlug(team.coach)}.agent.json`)
      };
      return [...players, coach];
    })
  };
}

function buildAliasesIndex(enrichedTeams) {
  const aliasMap = new Map();
  const pushAlias = (alias, targetId, targetType) => {
    const normalizedAlias = normalizeAlias(alias);
    const key = `${normalizedAlias}::${targetType}`;
    if (!aliasMap.has(key)) {
      aliasMap.set(key, {
        alias,
        normalized_alias: normalizedAlias,
        target_type: targetType,
        target_ids: []
      });
    }
    aliasMap.get(key).target_ids.push(targetId);
  };

  for (const team of enrichedTeams) {
    for (const alias of team.teamAliases) {
      pushAlias(alias, team.teamId, "team");
    }
    for (const player of team.players) {
      for (const alias of player.aliases) {
        pushAlias(alias, player.entity_id, "entity");
      }
    }
    for (const alias of team.coach.aliases) {
      pushAlias(alias, team.coach.entity_id, "entity");
    }
  }

  return {
    index_id: "aliases-index",
    version: VERSION,
    entries: [...aliasMap.values()]
      .map((entry) => ({ ...entry, target_ids: uniq(entry.target_ids) }))
      .sort((a, b) => a.normalized_alias.localeCompare(b.normalized_alias))
  };
}

function buildRolesIndex(enrichedTeams) {
  return {
    index_id: "roles-index",
    version: VERSION,
    source_path: "raw/teams/agent_major_player_roles.md",
    entries: enrichedTeams.flatMap((team) => {
      const players = team.players.map((player) => ({
        team_id: team.teamId,
        team_slug: team.slug,
        agent_team_name: team.agentTeamName,
        entity_id: player.entity_id,
        entity_type: player.entity_type,
        display_name: player.display_name,
        role: player.role,
        cs_role_profile: player.cs_role_profile
      }));
      return [
        ...players,
        {
          team_id: team.teamId,
          team_slug: team.slug,
          agent_team_name: team.agentTeamName,
          entity_id: team.coach.entity_id,
          entity_type: team.coach.entity_type,
          display_name: team.coach.display_name,
          role: team.coach.role,
          cs_role_profile: team.coach.cs_role_profile
        }
      ];
    })
  };
}

function buildLlmModelProfilesRegistry() {
  return {
    registry_id: "llm-model-profiles",
    version: LLM_BINDING_VERSION,
    binding_scope: LLM_BINDING_SCOPE,
    runtime_enabled: LLM_RUNTIME_ENABLED,
    driver_registry_ref: LLM_DRIVER_REGISTRY_REF,
    env_contract_refs: [...LLM_ENV_CONTRACT_REFS],
    no_secret_policy: "Only env var names and driver model ids are stored here. Secrets stay in local runtime env files.",
    profiles: llmModelProfiles
  };
}

function buildLlmRoleBindingTemplatesRegistry() {
  return {
    registry_id: "llm-role-binding-templates",
    version: LLM_BINDING_VERSION,
    binding_scope: LLM_BINDING_SCOPE,
    runtime_enabled: LLM_RUNTIME_ENABLED,
    templates: Object.values(llmRoleBindingTemplates).map((template) => ({
      ...template,
      runtime_enabled: LLM_RUNTIME_ENABLED,
      task_bindings: template.task_bindings.map(makeLlmTaskBinding)
    }))
  };
}

function collectEntities(enrichedTeams) {
  return enrichedTeams.flatMap((team) => [...team.players, team.coach].map((entity) => ({ team, entity })));
}

function buildAgentBindingOverrides(enrichedTeams) {
  const overrides = collectEntities(enrichedTeams)
    .filter(({ entity }) => entity.future_driver_binding.override_ids.length > 0)
    .map(({ team, entity }) => ({
      override_id: entity.future_driver_binding.override_ids[0],
      entity_id: entity.entity_id,
      team_id: team.teamId,
      team_slug: team.slug,
      display_name: entity.display_name,
      role: entity.role,
      selection_reason: "heat_level=high and card_priority<=20",
      applied_task_ids: ["spotlight_moment_copy"],
      applied_model_profile_ids: ["llm_profile_caster_expressive"],
      runtime_enabled: LLM_RUNTIME_ENABLED
    }));

  return {
    registry_id: "llm-agent-binding-overrides",
    version: LLM_BINDING_VERSION,
    binding_scope: LLM_BINDING_SCOPE,
    runtime_enabled: LLM_RUNTIME_ENABLED,
    selection_policy: "Generated spotlight overrides for high-heat entities with card_priority <= 20.",
    overrides
  };
}

function buildLlmBindingsIndex(enrichedTeams) {
  return {
    index_id: "llm-bindings-index",
    version: LLM_BINDING_VERSION,
    binding_scope: LLM_BINDING_SCOPE,
    runtime_enabled: LLM_RUNTIME_ENABLED,
    driver_registry_ref: LLM_DRIVER_REGISTRY_REF,
    model_profiles_path: relativeProcessedPath("llm", "model-profiles.json"),
    role_binding_templates_path: relativeProcessedPath("llm", "role-binding-templates.json"),
    agent_binding_overrides_path: relativeProcessedPath("llm", "agent-binding-overrides.json"),
    entities: collectEntities(enrichedTeams).map(({ team, entity }) => ({
      entity_id: entity.entity_id,
      entity_type: entity.entity_type,
      team_id: team.teamId,
      team_slug: team.slug,
      display_name: entity.display_name,
      role: entity.role,
      role_template_id: entity.future_driver_binding.role_template_id,
      preferred_driver_model_id: entity.future_driver_binding.preferred_driver_model_id,
      fallback_driver_model_ids: entity.future_driver_binding.fallback_driver_model_ids,
      task_ids: entity.future_driver_binding.task_bindings.map((binding) => binding.task_id),
      model_profile_ids: uniq(entity.future_driver_binding.task_bindings.map((binding) => binding.model_profile_id)),
      override_ids: entity.future_driver_binding.override_ids,
      runtime_enabled: entity.future_driver_binding.runtime_enabled,
      json_path: relativeProcessedPath(
        "teams",
        team.slug,
        entity.entity_type === "coach" ? "coach" : "players",
        `${entity.entity_type === "coach" && entity.slug === "coach-tbd" ? "coach-tbd" : entityFileSlug(entity)}.agent.json`
      )
    }))
  };
}

function renderModelProfilesMarkdown(registry) {
  const rows = registry.profiles.map((profile) => (
    `- ${profile.id}: ${profile.summary} Primary=${profile.primary_driver_model_id}; fallback=${profile.fallback_driver_model_ids.join(", ")}; runtime_enabled=${profile.runtime_enabled}.`
  ));
  return `
# LLM Model Profiles

This registry is an asset contract. It stores driver ids and env var names only; no API keys, tokens, or secret values belong here.

## Runtime Boundary
- Binding scope: ${registry.binding_scope}
- Runtime enabled: ${registry.runtime_enabled}
- Driver registry: ${registry.driver_registry_ref}
- Env refs: ${registry.env_contract_refs.join(", ")}

## Profiles
${rows.join("\n")}
`;
}

function renderRoleBindingTemplatesMarkdown(registry) {
  const rows = registry.templates.map((template) => (
    `- ${template.template_id}: role=${template.role}; preferred=${template.preferred_driver_model_id}; tasks=${template.task_bindings.map((binding) => binding.task_id).join(", ")}.`
  ));
  return `
# LLM Role Binding Templates

Role templates are the default maintenance unit. Individual agents inherit from these templates unless a small spotlight override is generated.

${rows.join("\n")}
`;
}

function renderAgentBindingOverridesMarkdown(registry) {
  const rows = registry.overrides.length > 0
    ? registry.overrides.map((override) => `- ${override.override_id}: ${override.display_name} (${override.entity_id}) -> ${override.applied_task_ids.join(", ")}.`)
    : ["- No overrides in this version."];
  return `
# LLM Agent Binding Overrides

Overrides are intentionally small. They capture product-facing spotlight needs without turning every agent into a hand-maintained model config.

## Selection Policy
${registry.selection_policy}

## Overrides
${rows.join("\n")}
`;
}

function entityFileSlug(entity) {
  return entity.in_game_id.toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "") || entity.display_name.toLowerCase();
}

function writeTeamAssets(team) {
  const teamDir = path.join(teamsRoot, team.slug);
  const playersDir = path.join(teamDir, "players");
  const coachDir = path.join(teamDir, "coach");
  ensureDir(playersDir);
  ensureDir(coachDir);
  pruneGeneratedAgentFiles(playersDir);
  pruneGeneratedAgentFiles(coachDir);

  writeJson(path.join(teamDir, "team.json"), makeTeamJson(team));
  writeText(path.join(teamDir, "team.md"), renderTeamMarkdown(team));
  writeJson(path.join(teamDir, "roster.json"), makeRosterJson(team));
  writeText(path.join(teamDir, "roster.md"), renderRosterMarkdown(team));
  writeJson(path.join(teamDir, "hooks.json"), makeHooksJson(team));
  writeText(path.join(teamDir, "hooks.md"), renderHooksMarkdown(team));

  for (const player of team.players) {
    const fileSlug = entityFileSlug(player);
    writeJson(path.join(playersDir, `${fileSlug}.agent.json`), player);
    writeText(path.join(playersDir, `${fileSlug}.agent.md`), renderEntityMarkdown(team, player));
  }

  const coachSlug = team.coach.slug === "coach-tbd" ? "coach-tbd" : entityFileSlug(team.coach);
  writeJson(path.join(coachDir, `${coachSlug}.agent.json`), team.coach);
  writeText(path.join(coachDir, `${coachSlug}.agent.md`), renderEntityMarkdown(team, team.coach));
}

const enrichedTeams = teams.map(enrichTeam);

for (const team of enrichedTeams) {
  if (team.players.length !== 5) {
    throw new Error(`${team.agentTeamName} does not have 5 active players.`);
  }
  writeTeamAssets(team);
}

const teamsIndex = buildTeamsIndex(enrichedTeams);
const entitiesIndex = buildEntitiesIndex(enrichedTeams);
const aliasesIndex = buildAliasesIndex(enrichedTeams);
const rolesIndex = buildRolesIndex(enrichedTeams);
const llmModelProfilesRegistry = buildLlmModelProfilesRegistry();
const llmRoleBindingTemplatesRegistry = buildLlmRoleBindingTemplatesRegistry();
const agentBindingOverridesRegistry = buildAgentBindingOverrides(enrichedTeams);
const llmBindingsIndex = buildLlmBindingsIndex(enrichedTeams);
const teamAliasJson = buildTeamAliasJson(enrichedTeams);
const playerAliasJson = buildPlayerAliasJson(enrichedTeams);

writeJson(path.join(indexesRoot, "teams.index.json"), teamsIndex);
writeJson(path.join(indexesRoot, "entities.index.json"), entitiesIndex);
writeJson(path.join(indexesRoot, "aliases.index.json"), aliasesIndex);
writeJson(path.join(indexesRoot, "roles.index.json"), rolesIndex);
writeJson(path.join(indexesRoot, "llm-bindings.index.json"), llmBindingsIndex);
writeJson(path.join(llmRoot, "model-profiles.json"), llmModelProfilesRegistry);
writeText(path.join(llmRoot, "model-profiles.md"), renderModelProfilesMarkdown(llmModelProfilesRegistry));
writeJson(path.join(llmRoot, "role-binding-templates.json"), llmRoleBindingTemplatesRegistry);
writeText(path.join(llmRoot, "role-binding-templates.md"), renderRoleBindingTemplatesMarkdown(llmRoleBindingTemplatesRegistry));
writeJson(path.join(llmRoot, "agent-binding-overrides.json"), agentBindingOverridesRegistry);
writeText(path.join(llmRoot, "agent-binding-overrides.md"), renderAgentBindingOverridesMarkdown(agentBindingOverridesRegistry));
writeJson(path.join(styleRoot, "glossary", "team-aliases.json"), teamAliasJson);
writeText(path.join(styleRoot, "glossary", "team-aliases.md"), renderTeamAliasMarkdown(teamAliasJson));
writeJson(path.join(styleRoot, "glossary", "player-aliases.json"), playerAliasJson);
writeText(path.join(styleRoot, "glossary", "player-aliases.md"), renderPlayerAliasMarkdown(playerAliasJson));

console.log(`Built Agent Major materials: ${enrichedTeams.length} teams, ${entitiesIndex.entities.length} entities, ${llmBindingsIndex.entities.length} LLM bindings.`);
