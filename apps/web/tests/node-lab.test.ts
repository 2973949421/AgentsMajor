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
});
