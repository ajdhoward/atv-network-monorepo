// One palette for the 10-foot UI.
//
// The grid, the player and the overlays each carried their own hex values:
// `#d3e429` lived in `grid.ts`, `#9a9a9a` and `#666` were both "muted", and the
// two scrims (behind the ident loop and behind the dog) were two different
// blacks. On a TV that reads as three different products. These are the values
// the interface was tuned against, named once so a change moves the whole
// screen instead of one corner of it.

export const colour = {
  // Text, in three weights of importance.
  text: "#fff",
  muted: "#9a9a9a",
  faint: "#666",
  // The one accent: focus rings, borders, the active tile.
  accent: "#d3e429",
  // Surfaces, darkest first.
  surface: "#0d0d0d",
  surfaceRaised: "#101010",
  // Hairlines: a tile's edge, a chip's edge.
  rule: "#242424",
  ruleStrong: "#333",
  // Blacks over video: the ident loop's backdrop, the dog's badge.
  scrim: "rgba(0,0,0,.6)",
  scrimLight: "rgba(0,0,0,.4)",
} as const;

export const font = "Inter, system-ui, sans-serif";

export const radius = {
  tile: 14,
  chip: 20,
  badge: 8,
} as const;
