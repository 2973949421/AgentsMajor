"use client";

import type {
  HexMatchLabMapAssetView,
  HexMatchLabPhaseSummary
} from "../../server-hex-match-lab";

import styles from "./hex-match-lab.module.css";

const hexRadius = 7;
const stepX = hexRadius * 1.5;
const stepY = Math.sqrt(3) * hexRadius;

interface HexMatchMapViewerProps {
  map: HexMatchLabMapAssetView | undefined;
  phase?: HexMatchLabPhaseSummary | undefined;
  level: number;
  selectedAgentId?: string | undefined;
  showRegions: boolean;
  showPoints: boolean;
  showFlags: boolean;
  showPaths: boolean;
  showCombat: boolean;
  onSelectAgent: (agentId: string) => void;
}

export function HexMatchMapViewer(props: HexMatchMapViewerProps) {
  if (!props.map) {
    return (
      <section className={styles.mapPanel}>
        <h2>Dust2 Hex 地图</h2>
        <p className={styles.emptyInline}>正在读取官方 Hex 地图资产。</p>
      </section>
    );
  }

  const cells = props.map.cells.filter((cell) => cell.level === props.level);
  const cellById = new Map(props.map.cells.map((cell) => [cell.cellId, cell]));
  const regionById = new Map(props.map.regions.map((region) => [region.regionId, region]));
  const pointById = new Map(props.map.points.map((point) => [point.pointId, point]));
  const players = props.phase?.players.filter((player) => cellById.get(player.currentCellId)?.level === props.level) ?? [];
  const bombCellId = props.phase?.bombState.plantedCellId ?? props.phase?.players.find((player) => player.carryingC4)?.currentCellId;
  const bombCell = bombCellId ? cellById.get(bombCellId) : undefined;
  const bounds = buildViewBox(cells);
  const labelCells = buildRegionLabelCells(cells);

  return (
    <section className={styles.mapPanel} aria-label="Dust2 Hex 地图主视图">
      <div className={styles.mapTitleRow}>
        <div>
          <h2>Dust2 Hex 地图</h2>
          <p>只读比赛视图：当前 phase 的位置、C4、行动路径、交火接触和最后目击会覆盖在官方 Hex 资产上。</p>
        </div>
        <span>level {props.level}</span>
      </div>

      <svg className={styles.hexMapSvg} viewBox={bounds.viewBox} role="img" aria-label="Dust2 Hex map">
        <defs>
          <filter id="hexTextShadow">
            <feDropShadow dx="0" dy="1" stdDeviation="1" floodColor="#02060a" floodOpacity="0.95" />
          </filter>
        </defs>

        {cells.map((cell) => {
          const region = cell.regionId ? regionById.get(cell.regionId) : undefined;
          return (
            <polygon
              key={cell.cellId}
              points={hexPolygon(cell.col, cell.row)}
              className={`${styles.hexCell} ${regionClass(region?.regionType)}`}
            >
              <title>{cellTitle(cell, region?.nameCn, cell.pointIds.map((pointId) => pointById.get(pointId)?.nameCn ?? pointId))}</title>
            </polygon>
          );
        })}

        {props.showRegions
          ? [...labelCells.entries()].map(([regionId, cell]) => {
              const region = regionById.get(regionId);
              if (!region) return null;
              const pos = cellCenter(cell.col, cell.row);
              return (
                <text key={`region_${regionId}`} x={pos.x} y={pos.y + 2} className={styles.mapRegionLabel} filter="url(#hexTextShadow)">
                  {region.nameCn}
                </text>
              );
            })
          : null}

        {props.showPoints
          ? cells.flatMap((cell) => cell.pointIds.slice(0, 1).map((pointId) => {
              const point = pointById.get(pointId);
              if (!point) return null;
              const pos = cellCenter(cell.col, cell.row);
              return (
                <circle key={`point_${cell.cellId}_${pointId}`} cx={pos.x} cy={pos.y} r="2.6" className={styles.mapPoint}>
                  <title>{point.nameCn}</title>
                </circle>
              );
            }))
          : null}

        {props.showFlags
          ? cells.filter((cell) => cell.flags.some((flag) => flag !== "playable")).map((cell) => {
              const pos = cellCenter(cell.col, cell.row);
              return (
                <text key={`flag_${cell.cellId}`} x={pos.x} y={pos.y - 4} className={styles.mapFlagLabel} filter="url(#hexTextShadow)">
                  {flagGlyph(cell.flags)}
                </text>
              );
            })
          : null}

        {props.showPaths && props.phase
          ? props.phase.actions.map((action) => {
              const from = action.currentCellId ? cellById.get(action.currentCellId) : undefined;
              const to = action.targetCellId ? cellById.get(action.targetCellId) : undefined;
              if (!from || !to || from.level !== props.level || to.level !== props.level || from.cellId === to.cellId) return null;
              const a = cellCenter(from.col, from.row);
              const b = cellCenter(to.col, to.row);
              return (
                <line
                  key={`path_${action.agentId}_${action.currentCellId}_${action.targetCellId}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  className={action.valid ? styles.mapPath : styles.mapPathRejected}
                />
              );
            })
          : null}

        {props.showCombat && props.phase
          ? props.phase.combats.flatMap((combat) => combat.participants.map((agentId) => {
              const player = props.phase?.players.find((candidate) => candidate.agentId === agentId);
              const cell = player ? cellById.get(player.currentCellId) : undefined;
              if (!cell || cell.level !== props.level) return null;
              const pos = cellCenter(cell.col, cell.row);
              return (
                <circle key={`combat_${combat.contactId}_${agentId}`} cx={pos.x} cy={pos.y} r="7.5" className={styles.mapCombat}>
                  <title>{combat.contactId}</title>
                </circle>
              );
            }))
          : null}

        {bombCell && bombCell.level === props.level ? (
          <text x={cellCenter(bombCell.col, bombCell.row).x} y={cellCenter(bombCell.col, bombCell.row).y - 8} className={styles.mapBomb} filter="url(#hexTextShadow)">
            C4
          </text>
        ) : null}

        {players.map((player, index) => {
          const cell = cellById.get(player.currentCellId);
          if (!cell) return null;
          const pos = cellCenter(cell.col, cell.row);
          const selected = props.selectedAgentId === player.agentId;
          return (
            <g key={player.agentId} className={selected ? styles.mapAgentSelected : styles.mapAgent} onClick={() => props.onSelectAgent(player.agentId)}>
              <circle cx={pos.x + offset(index).x} cy={pos.y + offset(index).y} r={selected ? 6.8 : 5.4} className={player.side === "attack" ? styles.mapAgentAttack : styles.mapAgentDefense} />
              <text x={pos.x + offset(index).x} y={pos.y + offset(index).y + 1.8} className={styles.mapAgentText}>
                {agentInitial(player.displayName ?? player.agentId)}
              </text>
              <title>{player.displayName ?? player.agentId} - {player.currentRegionName ?? player.currentCellId}</title>
            </g>
          );
        })}
      </svg>
    </section>
  );
}

function cellCenter(col: number, row: number): { x: number; y: number } {
  return {
    x: col * stepX,
    y: row * stepY + (col % 2 === 0 ? 0 : stepY / 2)
  };
}

function hexPolygon(col: number, row: number): string {
  const center = cellCenter(col, row);
  return Array.from({ length: 6 }, (_, index) => {
    const angle = Math.PI / 180 * (60 * index + 30);
    return `${(center.x + hexRadius * Math.cos(angle)).toFixed(2)},${(center.y + hexRadius * Math.sin(angle)).toFixed(2)}`;
  }).join(" ");
}

function buildViewBox(cells: HexMatchLabMapAssetView["cells"]): { viewBox: string } {
  if (cells.length === 0) return { viewBox: "0 0 100 100" };
  const centers = cells.map((cell) => cellCenter(cell.col, cell.row));
  const padding = hexRadius * 1.4;
  const minX = Math.min(...centers.map((center) => center.x)) - padding;
  const minY = Math.min(...centers.map((center) => center.y)) - padding;
  const maxX = Math.max(...centers.map((center) => center.x)) + padding;
  const maxY = Math.max(...centers.map((center) => center.y)) + padding;
  return { viewBox: `${minX.toFixed(1)} ${minY.toFixed(1)} ${(maxX - minX).toFixed(1)} ${(maxY - minY).toFixed(1)}` };
}

function buildRegionLabelCells(cells: HexMatchLabMapAssetView["cells"]): Map<string, HexMatchLabMapAssetView["cells"][number]> {
  const byRegion = new Map<string, HexMatchLabMapAssetView["cells"]>();
  for (const cell of cells) {
    if (!cell.regionId) continue;
    byRegion.set(cell.regionId, [...(byRegion.get(cell.regionId) ?? []), cell]);
  }
  const labels = new Map<string, HexMatchLabMapAssetView["cells"][number]>();
  for (const [regionId, regionCells] of byRegion.entries()) {
    const labelCell = regionCells[Math.floor(regionCells.length / 2)] ?? regionCells[0];
    if (labelCell) labels.set(regionId, labelCell);
  }
  return labels;
}

function regionClass(regionType: string | undefined): string {
  if (regionType?.includes("spawn")) return styles.hexRegionSpawn ?? "";
  if (regionType?.includes("site")) return styles.hexRegionSite ?? "";
  if (regionType?.includes("route")) return styles.hexRegionRoute ?? "";
  return styles.hexRegionNeutral ?? "";
}

function flagGlyph(flags: string[]): string {
  if (flags.includes("spawn_t")) return "T";
  if (flags.includes("spawn_ct")) return "CT";
  if (flags.includes("bombsite_a")) return "A";
  if (flags.includes("bombsite_b")) return "B";
  if (flags.includes("choke")) return "窄";
  if (flags.includes("cover")) return "掩";
  if (flags.includes("high_risk")) return "险";
  return "";
}

function cellTitle(cell: HexMatchLabMapAssetView["cells"][number], regionName: string | undefined, pointNames: string[]): string {
  return `${cell.cellId}\n${regionName ?? "未分区"}\n${pointNames.join(", ") || "无点位"}\n${cell.flags.join(", ") || "无标记"}`;
}

function offset(index: number): { x: number; y: number } {
  const fallback = { x: 0, y: 0 };
  const offsets = [
    fallback,
    { x: 4, y: -3 },
    { x: -4, y: -3 },
    { x: 4, y: 3 },
    { x: -4, y: 3 }
  ];
  return offsets[index % offsets.length] ?? fallback;
}

function agentInitial(name: string): string {
  return name.trim().slice(0, 2).toUpperCase();
}
