import { describe, expect, it } from "vitest";

import { REQUIRED_TACTICAL_ZONE_IDS, getTacticalMapLayout, resolveTacticalZone } from "./tactical-map.js";

describe("Phase 1.45 tactical map layouts", () => {
  it("defines required zones and valid connections for all Phase 1 maps and default layout", () => {
    for (const mapName of ["DUST2", "INFERNO", "MIRAGE", "UNKNOWN"]) {
      const layout = getTacticalMapLayout(mapName);
      const zoneIds = new Set(layout.zones.map((zone) => zone.zoneId));

      expect(layout.version).toBe(1);
      expect(layout.canvas).toEqual({ width: 1000, height: 640 });
      expect(zoneIds.has(layout.fallbackZoneId)).toBe(true);
      expect(layout.zones).toHaveLength(REQUIRED_TACTICAL_ZONE_IDS.length);
      for (const zoneId of REQUIRED_TACTICAL_ZONE_IDS) {
        expect(zoneIds.has(zoneId)).toBe(true);
      }

      for (const zone of layout.zones) {
        expect(zone.position.x).toBeGreaterThanOrEqual(0);
        expect(zone.position.x).toBeLessThanOrEqual(layout.canvas.width);
        expect(zone.position.y).toBeGreaterThanOrEqual(0);
        expect(zone.position.y).toBeLessThanOrEqual(layout.canvas.height);
        expect(zone.radius).toBeGreaterThan(0);
      }

      for (const connection of layout.connections) {
        expect(zoneIds.has(connection.fromZoneId)).toBe(true);
        expect(zoneIds.has(connection.toZoneId)).toBe(true);
      }
    }
  });

  it("falls back for unknown maps and unknown zones without crashing", () => {
    const layout = getTacticalMapLayout("ANCIENT");
    expect(layout.mapName).toBe("DEFAULT");

    const known = resolveTacticalZone(layout, "buyer_mid");
    expect(known.zone.zoneId).toBe("buyer_mid");
    expect(known.weak).toBe(false);

    const unknown = resolveTacticalZone(layout, "unknown_zone");
    expect(unknown.zone.zoneId).toBe(layout.fallbackZoneId);
    expect(unknown.requestedZoneId).toBe("unknown_zone");
    expect(unknown.weak).toBe(true);
  });
});
