import { describe, it, expect } from "vitest";
import { collectProjectSubtree, type ProjectNode } from "./projects";

/*
  The delete cascade's reach. A silent bug here either orphans a sub-project on
  delete (it survives when its parent is gone) or over-reaches into an unrelated
  project, so each case is pinned.
*/

const projects: ProjectNode[] = [
  { id: "root", parentId: null },
  { id: "child-a", parentId: "root" },
  { id: "child-b", parentId: "root" },
  { id: "grandchild", parentId: "child-a" },
  { id: "other", parentId: null },
  { id: "other-child", parentId: "other" },
];

describe("collectProjectSubtree", () => {
  it("includes the root and every descendant, to any depth", () => {
    const set = new Set(collectProjectSubtree(projects, "root"));
    expect(set).toEqual(new Set(["root", "child-a", "child-b", "grandchild"]));
  });

  it("does not reach into an unrelated tree", () => {
    const set = new Set(collectProjectSubtree(projects, "root"));
    expect(set.has("other")).toBe(false);
    expect(set.has("other-child")).toBe(false);
  });

  it("returns just the root when it has no children", () => {
    expect(collectProjectSubtree(projects, "grandchild")).toEqual(["grandchild"]);
  });

  it("collects a mid-tree node with its own descendants", () => {
    expect(new Set(collectProjectSubtree(projects, "child-a"))).toEqual(
      new Set(["child-a", "grandchild"])
    );
  });

  it("includes the root id even if it is not in the list", () => {
    expect(collectProjectSubtree([], "gone")).toEqual(["gone"]);
  });

  it("is cycle-safe against a malformed parent chain", () => {
    const cyclic: ProjectNode[] = [
      { id: "a", parentId: "b" },
      { id: "b", parentId: "a" },
    ];
    const set = new Set(collectProjectSubtree(cyclic, "a"));
    expect(set).toEqual(new Set(["a", "b"]));
  });
});
