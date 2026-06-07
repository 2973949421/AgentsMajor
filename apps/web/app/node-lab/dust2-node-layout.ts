export interface Dust2NodePosition {
  x: number;
  y: number;
  label?: string;
}

export const dust2NodePositions: Record<string, Dust2NodePosition> = {
  t_spawn: { x: 38, y: 91, label: "T Spawn" },
  ct_spawn: { x: 50, y: 38, label: "CT" },
  outside_long: { x: 78, y: 75, label: "Outside Long" },
  long_doors: { x: 73, y: 63, label: "Long Doors" },
  blue: { x: 78, y: 56, label: "Blue" },
  long_corner: { x: 86, y: 50, label: "Long Corner" },
  pit: { x: 93, y: 57, label: "Pit" },
  a_long: { x: 83, y: 42, label: "Long" },
  a_car: { x: 91, y: 34, label: "A Car" },
  a_ramp: { x: 87, y: 19, label: "Ramp" },
  a_default: { x: 77, y: 22, label: "A Default" },
  a_safe: { x: 80, y: 18, label: "Safe" },
  a_quad: { x: 73, y: 24, label: "Quad" },
  a_goose: { x: 79, y: 9, label: "Goose" },
  a_ninja: { x: 61, y: 13, label: "Ninja" },
  a_lift: { x: 67, y: 28, label: "Lift" },
  a_short: { x: 62, y: 30, label: "Short" },
  short_stairs: { x: 58, y: 43, label: "Stairs" },
  cat: { x: 50, y: 54, label: "Cat" },
  top_mid: { x: 42, y: 72, label: "Top Mid" },
  mid: { x: 43, y: 58, label: "Mid" },
  xbox: { x: 45, y: 49, label: "Xbox" },
  mid_doors: { x: 45, y: 36, label: "Mid Doors" },
  suicide: { x: 42, y: 82, label: "Suicide" },
  green: { x: 35, y: 71, label: "Green" },
  outside_tunnels: { x: 15, y: 78, label: "Outside Tunnels" },
  upper_tunnels: { x: 18, y: 58, label: "Upper" },
  lower_tunnels: { x: 31, y: 46, label: "Lower" },
  b_tunnel_exit: { x: 13, y: 41, label: "Tunnel Exit" },
  b_site: { x: 16, y: 26, label: "B Site" },
  b_default: { x: 18, y: 20, label: "B Default" },
  b_back_site: { x: 16, y: 12, label: "Back Site" },
  b_plat: { x: 6, y: 17, label: "Plat" },
  b_big_box: { x: 9, y: 29, label: "Big Box" },
  b_fence: { x: 4, y: 36, label: "Fence" },
  b_car: { x: 17, y: 39, label: "B Car" },
  b_headshot: { x: 4, y: 6, label: "Headshot" },
  b_window: { x: 31, y: 15, label: "Window" },
  b_doors: { x: 28, y: 25, label: "B Doors" }
};

export const dust2PrimaryNodeIds = new Set([
  "t_spawn",
  "ct_spawn",
  "outside_long",
  "long_doors",
  "long_corner",
  "pit",
  "a_long",
  "a_ramp",
  "a_default",
  "a_goose",
  "a_short",
  "short_stairs",
  "cat",
  "top_mid",
  "mid",
  "xbox",
  "mid_doors",
  "outside_tunnels",
  "upper_tunnels",
  "lower_tunnels",
  "b_tunnel_exit",
  "b_site",
  "b_default",
  "b_back_site",
  "b_window",
  "b_doors"
]);

export const dust2PhaseLabels: Record<string, string> = {
  default_opening: "默认展开",
  first_contact: "第一接触",
  mid_round_decision: "中盘决策",
  execute_or_retake: "进点 / 回防",
  post_plant_or_clutch: "守包 / 残局"
};
