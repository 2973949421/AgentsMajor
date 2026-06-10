"use client";

import type {
  HexMatchLabMapAssetView,
  HexMatchLabPhaseSummary,
  HexMatchLabPlayerCard
} from "../../server-hex-match-lab";

import styles from "./hex-match-lab.module.css";

const hexRadius = 5.8;
const stepX = hexRadius * 1.5;
const stepY = Math.sqrt(3) * hexRadius;
const viewBoxPadding = 16;
const viewBoxWidth = stepX * 49 + hexRadius * 2 + viewBoxPadding * 2;
const viewBoxHeight = stepY * 50 + stepY / 2 + viewBoxPadding * 2;

interface HexMatchMapViewerProps {
  map: HexMatchLabMapAssetView;
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
  const phase = props.phase;
  const cells = props.map.cells.filter((cell) => cell.level === props.level);
  const cellById = new Map(props.map.cells.map((cell) => [cell.cellId, cell]));
  const regionById = new Map(props.map.regions.map((region) => [region.regionId, region]));
  const pointById = new Map(props.map.points.map((point) => [point.pointId, point]));
  const players = phase?.players.filter((player) => cellById.get(player.currentCellId)?.level === props.level) ?? [];
  const bombCellId = phase?.bombState.plantedCellId ?? phase?.players.find((player) => player.carryingC4)?.currentCellId;
  const bombCell = bombCellId ? cellById.get(bombCellId) : undefined;
  const labelCells = buildRegionLabelCells(cells);

  return (
    <section className={styles.mapPanel} aria-label="Dust2 Hex 地图主视图">
      <div className={styles.mapTitleRow}>
        <div>
          <h2>Dust2 Hex 地图</h2>
          <p>只读验收视图：显示官方 Hex 资产、选手位置、C4、交火和行动路径预览。</p>
        </div>
        <span>level {props.level}</span>
      </div>

      <svg className={styles.hexMapSvg} viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`} role="img" aria-label="Dust2 Hex map">
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
              className={`${styles.hexCell ?? ""} ${regionClass(region?.regionType)}`}
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
                <circle key={`point_${cell.cellId}_${pointId}`} cx={pos.x} cy={pos.y} r="2.1" className={styles.mapPoint}>
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

        {props.showPaths && phase
          ? phase.actions.map((action) => {
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
                  className={action.valid ? styles.actionPath : styles.actionPathRejected}
                />
              );
            })
          : null}

        {props.showCombat && phase
          ? phase.combats.map((combat, index) => {
              const participant = combat.participants
                .map((agentId) => phase.players.find((player) => player.agentId === agentId))
                .find((player): player is HexMatchLabPlayerCard => Boolean(player && cellById.get(player.currentCellId)?.level === props.level));
              const cell = participant ? cellById.get(participant.currentCellId) : undefined;
              if (!cell) return null;
              const pos = cellCenter(cell.col, cell.row);
              return (
                <g key={`combat_${combat.contactId}_${index}`}>
                  <circle cx={pos.x} cy={pos.y} r="8" className={styles.combatPulse} />
                  <text x={pos.x} y={pos.y + 3} className={styles.combatLabel} filter="url(#hexTextShadow)">交火</text>
                </g>
              );
            })
          : null}

        {bombCell && bombCell.level === props.level ? (
          <g>
            <circle cx={cellCenter(bombCell.col, bombCell.row).x} cy={cellCenter(bombCell.col, bombCell.row).y} r="7" className={styles.bombMarker} />
            <text x={cellCenter(bombCell.col, bombCell.row).x} y={cellCenter(bombCell.col, bombCell.row).y + 4} className={styles.bombText}>C4</text>
          </g>
        ) : null}

        {players.map((player) => {
          const cell = cellById.get(player.currentCellId);
          if (!cell) return null;
          const pos = cellCenter(cell.col, cell.row);
          const selected = props.selectedAgentId === player.agentId;
          return (
            <g
              key={player.agentId}
              className={styles.agentMarkerGroup}
              onClick={() => props.onSelectAgent(player.agentId)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") props.onSelectAgent(player.agentId);
              }}
              role="button"
              tabIndex={0}
            >
              <circle
                cx={pos.x}
                cy={pos.y}
                r={selected ? 7.7 : 6.1}
                className={`${styles.agentMarker ?? ""} ${player.side === "attack" ? styles.agentAttack ?? "" : styles.agentDefense ?? ""} ${selected ? styles.agentSelected ?? "" : ""}`}
              />
              <text x={pos.x} y={pos.y + 3} className={styles.agentText} filter="url(#hexTextShadow)">
                {shortAgentName(player)}
              </text>
              {player.lastSeenEnemyCount > 0 ? <circle cx={pos.x + 7} cy={pos.y - 7} r="2.8" className={styles.lastSeenDot} /> : null}
            </g>
          );
        })}
      </svg>

      <div className={styles.mapLegend}>
        <span className={styles.legendAttack}>T 选手</span>
        <span className={styles.legendDefense}>CT 选手</span>
        <span className={styles.legendBomb}>C4</span>
        <span className={styles.legendCombat}>交火</span>
        <span>路径线来自 trace，不由前端重新计算。</span>
      </div>
    </section>
  );
}

function cellCenter(col: number, row: number) {
  const x = viewBoxPadding + hexRadius + col * stepX;
  const y = viewBoxPadding + hexRadius + row * stepY + (col % 2 === 1 ? stepY / 2 : 0);
  return { x, y };
}

function hexPolygon(col: number, row: number): string {
  const center = cellCenter(col, row);
  return Array.from({ length: 6 }, (_, index) => {
    const angle = (Math.PI / 180) * (60 * index + 30);
    return `${(center.x + hexRadius * Math.cos(angle)).toFixed(2)},${(center.y + hexRadius * Math.sin(angle)).toFixed(2)}`;
  }).join(" ");
}

function regionClass(regionType: string | undefined): string {
  if (regionType === "a_site" || regionType === "long") return styles.hexRegionA ?? "";
  if (regionType === "b_site" || regionType === "tunnel") return styles.hexRegionB ?? "";
  if (regionType === "mid" || regionType === "connector") return styles.hexRegionMid ?? "";
  if (regionType === "spawn") return styles.hexRegionSpawn ?? "";
  if (regionType === "rotate") return styles.hexRegionRotate ?? "";
  return styles.hexRegionOther ?? "";
}

function flagGlyph(flags: string[]): string {
  if (flags.includes("spawn_t")) return "T";
  if (flags.includes("spawn_ct")) return "CT";
  if (flags.includes("bombsite_a")) return "A";
  if (flags.includes("bombsite_b")) return "B";
  if (flags.includes("choke")) return "窄";
  if (flags.includes("cover")) return "掩";
  if (flags.includes("high_risk")) return "险";
  if (flags.includes("route_hint")) return "线";
  return "";
}

function shortAgentName(player: HexMatchLabPlayerCard): string {
  const name = player.displayName ?? player.agentId;
  return name.replace(/^agent_/, "").slice(0, 3).toUpperCase();
}

function cellTitle(cell: HexMatchLabMapAssetView["cells"][number], regionName: string | undefined, pointNames: string[]): string {
  return [
    cell.cellId,
    regionName ? `区域: ${regionName}` : undefined,
    pointNames.length ? `点位: ${pointNames.join(", ")}` : undefined,
    cell.flags.length ? `标记: ${cell.flags.join(", ")}` : undefined
  ].filter(Boolean).join("\n");
}

function buildRegionLabelCells(cells: HexMatchLabMapAssetView["cells"]): Map<string, HexMatchLabMapAssetView["cells"][number]> {
  const grouped = new Map<string, HexMatchLabMapAssetView["cells"]>();
  for (const cell of cells) {
    if (!cell.regionId) continue;
    const list = grouped.get(cell.regionId) ?? [];
    list.push(cell);
    grouped.set(cell.regionId, list);
  }
  const labels = new Map<string, HexMatchLabMapAssetView["cells"][number]>();
  for (const [regionId, list] of grouped.entries()) {
    const sorted = [...list].sort((left, right) => left.row - right.row || left.col - right.col);
    labels.set(regionId, sorted[Math.floor(sorted.length / 2)]!);
  }
  return labels;
}
