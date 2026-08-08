/*
  Project subtree collection — the reach of a project delete.

  Deleting a project takes its sub-projects (and their sub-projects, to any
  depth the data holds — the interface only draws two levels, R20) with it. This
  pure function computes the set of project ids to delete as one reversible unit.
  It is kept out of the query so it unit-tests without a database; the read layer
  resolves the live projects and calls it.

  Cycle-safe by construction: a `seen` set means a malformed parent chain can
  never loop. The root id is always included, even if it has no children.
*/

/** The two fields the cascade reads from a project. */
export interface ProjectNode {
  id: string;
  parentId: string | null;
}

/**
 * Every project id in the subtree rooted at `rootId` — the root plus all of its
 * descendants — from a flat list of `{ id, parentId }`. Order is the root first,
 * then a depth-first walk; callers that need a set should not depend on order.
 */
export function collectProjectSubtree(projects: ProjectNode[], rootId: string): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const p of projects) {
    if (p.parentId == null) continue;
    const kids = childrenOf.get(p.parentId);
    if (kids) kids.push(p.id);
    else childrenOf.set(p.parentId, [p.id]);
  }

  const out: string[] = [];
  const seen = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    for (const child of childrenOf.get(id) ?? []) stack.push(child);
  }
  return out;
}
