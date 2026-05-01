import { describe, expect, it } from "vitest";

import { FakeProvider } from "./fake-provider.js";

describe("FakeProvider", () => {
  it("returns deterministic placeholder data for the same seed", async () => {
    const provider = new FakeProvider();
    const request = {
      task: "round_report" as const,
      driverModelId: "fake-driver",
      input: { roundId: "round_1" },
      schemaName: "RoundReport",
      seed: "stable-seed"
    };

    const first = await provider.generateStructured(request);
    const second = await provider.generateStructured(request);

    expect(first).toEqual(second);
  });
});
