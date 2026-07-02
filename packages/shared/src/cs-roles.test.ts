import { describe, expect, it } from "vitest";

import { formatCsRoleLabel, normalizeCsRole, normalizeCsRoleProfile, normalizeCsRoleTags } from "./cs-roles.js";

describe("CS role normalization", () => {
  it("maps legacy player primary roles into the five canonical CS roles", () => {
    expect(normalizeCsRole("support")).toBe("rifler");
    expect(normalizeCsRole("anchor")).toBe("rifler");
    expect(normalizeCsRole("flex")).toBe("rifler");
    expect(normalizeCsRole("star_rifler")).toBe("rifler");
    expect(normalizeCsRole("entry_fragger")).toBe("entry");
    expect(normalizeCsRole("stand_in")).toBe("rifler");
  });

  it("keeps star as a tag instead of a sixth primary role", () => {
    expect(normalizeCsRoleProfile("star_rifler")).toEqual({
      role: "rifler",
      tags: ["star"],
      isStar: true
    });
    expect(formatCsRoleLabel("star_rifler")).toBe("star rifler");
    expect(formatCsRoleLabel("awper", ["star"])).toBe("star awper");
  });

  it("keeps legacy support and anchor semantics as tags", () => {
    expect(normalizeCsRoleTags(["support", "anchor", "flex"])).toEqual(["supportive", "rifler", "anchor", "flex"]);
  });
});