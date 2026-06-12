import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { normalizeNodeLabRunRequest, retiredNodeLabResult, runNodeLab } from "../app/server-node-lab";

describe("retired Node Lab", () => {
  it("keeps old Node Lab calls retired and points users to Hex Match Lab", async () => {
    expect(normalizeNodeLabRunRequest({ scope: "map" })).toEqual({});
    await expect(runNodeLab({ scope: "map" })).resolves.toEqual(retiredNodeLabResult());
    expect(retiredNodeLabResult()).toMatchObject({
      retired: true,
      replacementPath: "/hex-lab/match"
    });
  });

  it("keeps only retired Node Lab stubs in the active app route", () => {
    const nodeLabDir = resolve(__dirname, "../app/node-lab");

    expect(existsSync(resolve(nodeLabDir, "page.tsx"))).toBe(true);
    expect(existsSync(resolve(nodeLabDir, "node-lab-client.tsx"))).toBe(false);
    expect(existsSync(resolve(nodeLabDir, "node-lab.module.css"))).toBe(false);
    expect(existsSync(resolve(nodeLabDir, "dust2-node-layout.ts"))).toBe(false);
  });
});
