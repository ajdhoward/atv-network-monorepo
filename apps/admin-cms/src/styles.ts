import type { CSSProperties } from "react";

// One palette and one set of box styles for the panel.
//
// These values were inline and had drifted: two panel borders (#ddd, #ccc), two
// radii (12, 8), a card that used #555 for its label while the summary used it
// for body text, and a font stack with no generic fallback. A screen that uses
// four greys to mean three things reads as two screens glued together.

export const colour = {
  ink: "#111",
  muted: "#555",
  rule: "#ddd",
  warn: "#8a4b00",
  danger: "#b91c1c",
  // Same three states everywhere a worker status is shown.
  status: { ok: "#0a7d32", degraded: "#b45309", unreachable: "#b91c1c" },
} as const;

export const font = 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif';

const BOX: CSSProperties = {
  border: `1px solid ${colour.rule}`,
  borderRadius: 12,
  padding: 16,
};

// A bordered block: the stat cards, the folder tree, anything that groups.
export const panel: CSSProperties = BOX;

// The panel's own description text, always the same grey.
export const muted: CSSProperties = { color: colour.muted };

export const sectionHeading: CSSProperties = { marginTop: 32 };

// A breadcrumb segment: looks like text, behaves like a button.
export const crumb: CSSProperties = {
  background: "none",
  border: 0,
  padding: 0,
  marginRight: 6,
  font: "inherit",
  color: colour.muted,
  cursor: "pointer",
};

// A folder row's name is its control, and it is a real <button> so the tree can be
// walked with Tab and opened with Enter. That means resetting the button chrome
// here instead of repeating the reset at each call site.
export const folderButton: CSSProperties = {
  background: "none",
  border: 0,
  padding: 0,
  font: "inherit",
  color: "inherit",
  textAlign: "left",
  cursor: "pointer",
};

export const grid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
  gap: 16,
};
