export const canonicalCsPlayerRoles = ["igl", "awper", "entry", "lurker", "rifler"] as const;
export type CanonicalCsPlayerRole = (typeof canonicalCsPlayerRoles)[number];

export type CanonicalCsRole = CanonicalCsPlayerRole | "coach";

export interface NormalizedCsRole {
  role: CanonicalCsRole;
  tags: string[];
  isStar: boolean;
}

const canonicalRoleSet = new Set<string>(canonicalCsPlayerRoles);

export function isCanonicalCsPlayerRole(value: string | undefined): value is CanonicalCsPlayerRole {
  return Boolean(value && canonicalRoleSet.has(value));
}

export function normalizeCsRole(value: unknown, fallback: CanonicalCsRole = "rifler"): CanonicalCsRole {
  const text = normalizeRoleText(value);
  if (!text) return fallback;
  if (text.includes("coach")) return "coach";
  if (text.includes("igl") || text.includes("leader") || text.includes("caller") || text.includes("指挥")) return "igl";
  if (text.includes("awper") || text.includes("awp") || text.includes("sniper") || text.includes("狙")) return "awper";
  if (text.includes("entry") || text.includes("opener") || text.includes("突破")) return "entry";
  if (text.includes("lurker") || text.includes("自由人") || text.includes("lurk")) return "lurker";
  if (
    text.includes("rifler")
    || text.includes("rifle")
    || text.includes("star")
    || text.includes("support")
    || text.includes("anchor")
    || text.includes("flex")
    || text.includes("closer")
    || text.includes("stand_in")
    || text.includes("standin")
    || text.includes("stand-in")
  ) {
    return "rifler";
  }
  return fallback;
}

export function normalizeCsRoleTags(values: unknown): string[] {
  const rawValues = Array.isArray(values) ? values : [values];
  const tags = rawValues.flatMap((value) => normalizeOneCsRoleTags(value));
  return [...new Set(tags)];
}

export function normalizeCsRoleProfile(roleValue: unknown, tagValues: unknown = []): NormalizedCsRole {
  const role = normalizeCsRole(roleValue);
  const tags = normalizeCsRoleTags([roleValue, ...(Array.isArray(tagValues) ? tagValues : [tagValues])])
    .filter((tag) => tag !== role && tag !== "coach");
  return {
    role,
    tags,
    isStar: tags.includes("star")
  };
}

export function formatCsRoleLabel(roleValue: unknown, tagValues: unknown = []): string {
  const normalized = normalizeCsRoleProfile(roleValue, tagValues);
  if (normalized.role === "coach") return "coach";
  if (normalized.isStar && normalized.role !== "igl") {
    return `star ${normalized.role}`;
  }
  return normalized.role;
}

function normalizeOneCsRoleTags(value: unknown): string[] {
  const text = normalizeRoleText(value);
  if (!text) return [];
  const tags: string[] = [];
  if (text.includes("star") || text.includes("明星") || text.includes("大腿") || text.includes("carry")) tags.push("star");
  if (text.includes("support") || text.includes("utility") || text.includes("辅助") || text.includes("补位")) tags.push("supportive");
  if (text.includes("anchor") || text.includes("site_hold") || text.includes("site-hold") || text.includes("守点")) tags.push("anchor");
  if (text.includes("flex") || text.includes("adapter") || text.includes("补缺")) tags.push("flex");
  if (text.includes("stand_in") || text.includes("standin") || text.includes("stand-in") || text.includes("临时")) tags.push("stand_in");
  if (text.includes("closer") || text.includes("clutch") || text.includes("残局")) tags.push("closer");
  if (text.includes("system_architect")) tags.push("system_architect");
  const role = normalizeCsRole(text);
  if (role !== "coach") tags.push(role);
  return [...new Set(tags)];
}

function normalizeRoleText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}
