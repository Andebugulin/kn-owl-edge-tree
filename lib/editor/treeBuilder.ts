import type { Node, LinkType } from "./types";

export type TreeLine = {
  indent: number;
  label: string;
  nodeId: string;
  isCurrent: boolean;
  prefix: string;
  edgeType?: string;
  isGhost?: boolean;
  ghostEdgeType?: string;
  direction?: "in" | "out";
};

export function buildTreeWithPreview(
  nodeId: string,
  nodes: Node[],
  gt: (id: string) => string,
  preview?: { targetId: string; targetTitle: string; linkType: LinkType }
): TreeLine[] {
  const r: TreeLine[] = [];
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return r;

  function findRoot(id: string, v: Set<string>): string {
    if (v.has(id)) return id;
    v.add(id);
    const n = nodes.find((x) => x.id === id);
    if (!n) return id;
    const pe = n.edgesTo.find((e) => e.type === "parent");
    return pe ? findRoot(pe.fromNodeId, v) : id;
  }

  const rootId = findRoot(nodeId, new Set());

  if (
    preview?.linkType === "parent" &&
    !node.edgesTo.some((e) => e.type === "parent")
  ) {
    r.push({
      indent: 0,
      label: preview.targetTitle,
      nodeId: preview.targetId,
      isCurrent: false,
      prefix: "◆ ",
      isGhost: true,
      ghostEdgeType: "parent",
    });
    walk(nodeId, 1, [], true, new Set(), r, nodeId, undefined, gt, nodes);
    addIncomingEdges(r, nodeId, nodes, gt);
    return r;
  }

  walk(rootId, 0, [], true, new Set(), r, nodeId, preview, gt, nodes);
  addIncomingEdges(r, nodeId, nodes, gt);
  return r;
}

function addIncomingEdges(
  r: TreeLine[],
  nodeId: string,
  nodes: Node[],
  gt: (id: string) => string
) {
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return;
  const inEdges = node.edgesTo.filter(
    (e) => e.type !== "parent" && e.fromNodeId !== nodeId
  );
  if (inEdges.length === 0) return;
  const curIdx = r.findIndex((l) => l.isCurrent);
  if (curIdx < 0) return;
  let endIdx = curIdx + 1;
  while (endIdx < r.length && r[endIdx].indent > r[curIdx].indent) endIdx++;
  const existingIds = new Set(r.map((l) => l.nodeId));
  const base = r[curIdx].prefix
    .replace(/[◆├└]─? ?$/, "")
    .replace(/[▷◁]╌ $/, "");
  const incoming: TreeLine[] = [];
  inEdges.forEach((e) => {
    if (existingIds.has(e.fromNodeId)) return;
    incoming.push({
      indent: r[curIdx].indent + 1,
      label: gt(e.fromNodeId),
      nodeId: e.fromNodeId,
      isCurrent: false,
      prefix: base + "◁╌ ",
      edgeType: e.type,
      direction: "in",
    });
  });
  if (incoming.length > 0) r.splice(endIdx, 0, ...incoming);
}

/**
 * ancestors[i] = true means level i still has more siblings below (draw │),
 * false means level i was the last sibling (draw space).
 */
function walk(
  id: string,
  depth: number,
  ancestors: boolean[],
  isLast: boolean,
  vis: Set<string>,
  r: TreeLine[],
  cur: string,
  pv: { targetId: string; targetTitle: string; linkType: LinkType } | undefined,
  gt: (id: string) => string,
  nodes: Node[]
) {
  if (vis.has(id)) return;
  vis.add(id);
  const n = nodes.find((x) => x.id === id);
  if (!n) return;

  r.push({
    indent: depth,
    label: gt(id),
    nodeId: id,
    isCurrent: id === cur,
    prefix: mkPrefix(ancestors, isLast, depth === 0),
  });

  const ch = n.edgesFrom
    .filter((e) => e.type === "parent")
    .map((e) => e.toNodeId);
  const sp = n.edgesFrom.filter((e) => e.type !== "parent");

  type Item =
    | { k: "tree"; id: string }
    | { k: "sp"; id: string; et: string }
    | { k: "gh"; id: string; lb: string; et: string; lt: string };

  const items: Item[] = [];
  ch.forEach((cid) => items.push({ k: "tree", id: cid }));
  sp.forEach((e) => items.push({ k: "sp", id: e.toNodeId, et: e.type }));
  if (id === cur && pv) {
    if (pv.linkType === "child")
      items.push({
        k: "gh",
        id: pv.targetId,
        lb: pv.targetTitle,
        et: "parent",
        lt: pv.linkType,
      });
    else if (["reference", "example", "contradiction"].includes(pv.linkType))
      items.push({
        k: "gh",
        id: pv.targetId,
        lb: pv.targetTitle,
        et: pv.linkType,
        lt: pv.linkType,
      });
  }

  const next = [...ancestors, !isLast];

  items.forEach((item, i) => {
    const last = i === items.length - 1;
    if (item.k === "tree") {
      walk(item.id, depth + 1, next, last, vis, r, cur, pv, gt, nodes);
    } else if (item.k === "sp") {
      r.push({
        indent: depth + 1,
        label: gt(item.id),
        nodeId: item.id,
        isCurrent: item.id === cur,
        prefix: mkSpecial(next, last),
        edgeType: item.et,
        direction: "out",
      });
    } else {
      const isSp = ["reference", "example", "contradiction"].includes(item.lt);
      r.push({
        indent: depth + 1,
        label: item.lb,
        nodeId: item.id,
        isCurrent: false,
        prefix: isSp ? mkSpecial(next, last) : mkPrefix(next, last, false),
        isGhost: true,
        ghostEdgeType: item.et,
        edgeType: isSp ? item.et : undefined,
        direction: isSp ? "out" : undefined,
      });
    }
  });
}

function mkPrefix(
  ancestors: boolean[],
  isLast: boolean,
  isRoot: boolean
): string {
  if (isRoot) return "◆ ";
  let p = "";
  for (const hasMore of ancestors) p += hasMore ? "│  " : "   ";
  return p + (isLast ? "└─ " : "├─ ");
}

function mkSpecial(ancestors: boolean[], isLast: boolean): string {
  let p = "";
  for (const hasMore of ancestors) p += hasMore ? "│  " : "   ";
  return p + (isLast ? "╰╌ " : "├╌ ");
}
