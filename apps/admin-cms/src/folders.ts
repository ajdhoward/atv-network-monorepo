// The panel's folder path, as a list of segments.
//
// The path is a list rather than a string because a breadcrumb has to be able to
// slice it: the string version appended unconditionally, so a second click on
// Idents gave `/ATV Network/Idents/Idents` and the only way out was a reload.

export const ROOT = "ATV Network";

// One `enter` call is one click. The visible folders are the current level, so a
// folder that is already in the path means "go back to it" — which also makes a
// double click a no-op instead of a deeper copy of the same name.
export function enter(crumbs: string[], folder: string): string[] {
  const at = crumbs.lastIndexOf(folder);
  if (at !== -1) return crumbs.slice(0, at + 1);
  return [...crumbs, folder];
}
