import { describe, expect, it } from "vitest";
import { enter } from "../src/folders";

describe("enter", () => {
  it("descends one level per click", () => {
    expect(enter([], "Idents")).toEqual(["Idents"]);
    expect(enter(["Idents"], "News")).toEqual(["Idents", "News"]);
  });

  // The bug the screenshot showed: clicking the folder you are already in used to
  // append it again, so the path grew without bound and no crumb led back out.
  it("does not duplicate the folder you are in", () => {
    expect(enter(["Idents"], "Idents")).toEqual(["Idents"]);
    expect(enter(["Idents", "News"], "News")).toEqual(["Idents", "News"]);
  });

  it("steps back to a folder already in the path", () => {
    expect(enter(["Idents", "News", "Lineup"], "News")).toEqual(["Idents", "News"]);
    expect(enter(["Idents", "News", "Lineup"], "Idents")).toEqual(["Idents"]);
  });

  it("keeps an unrelated click a descent", () => {
    expect(enter(["Idents"], "Backups")).toEqual(["Idents", "Backups"]);
  });

  it("leaves its input alone", () => {
    const crumbs = ["Idents"];
    enter(crumbs, "News");
    expect(crumbs).toEqual(["Idents"]);
  });
});
