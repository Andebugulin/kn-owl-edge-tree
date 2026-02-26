import type { Node, LinkType } from "./types";

export type TreeLine = {
  indent: number;
  label: string;
  nodeId: string;
  isCurrent: boolean;
  connector: string;
  edgeType?: string;
  isGhost?: boolean;
  ghostEdgeType?: string;
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
      connector: "◆",
      isGhost: true,
      ghostEdgeType: "parent",
    });
    trav(nodeId, 1, true, new Set(), r, nodeId, undefined, gt, nodes);
    return r;
  }

  trav(rootId, 0, true, new Set(), r, nodeId, preview, gt, nodes);
  return r;
}

function trav(
  id: string,
  d: number,
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
    indent: d,
    label: gt(id),
    nodeId: id,
    isCurrent: id === cur,
    connector: d === 0 ? "◆" : isLast ? "└─" : "├─",
  });

  const ch = n.edgesFrom
    .filter((e) => e.type === "parent")
    .map((e) => e.toNodeId);
  const sp = n.edgesFrom.filter((e) => e.type !== "parent");
  const gh: TreeLine[] = [];

  if (id === cur && pv) {
    if (pv.linkType === "child")
      gh.push({
        indent: d + 1,
        label: pv.targetTitle,
        nodeId: pv.targetId,
        isCurrent: false,
        connector: "└─",
        isGhost: true,
        ghostEdgeType: "parent",
      });
    else if (["reference", "example", "contradiction"].includes(pv.linkType))
      gh.push({
        indent: d + 1,
        label: pv.targetTitle,
        nodeId: pv.targetId,
        isCurrent: false,
        connector: "└╌",
        isGhost: true,
        ghostEdgeType: pv.linkType,
        edgeType: pv.linkType,
      });
  }

  const tot = ch.length + sp.length + gh.length;
  let idx = 0;
  ch.forEach((cid) => {
    idx++;
    trav(cid, d + 1, idx === tot, vis, r, cur, pv, gt, nodes);
  });
  sp.forEach((e) => {
    idx++;
    r.push({
      indent: d + 1,
      label: gt(e.toNodeId),
      nodeId: e.toNodeId,
      isCurrent: e.toNodeId === cur,
      connector: idx === tot ? "└╌" : "├╌",
      edgeType: e.type,
    });
  });
  gh.forEach((g) => {
    idx++;
    g.connector =
      idx === tot ? (g.edgeType ? "└╌" : "└─") : g.edgeType ? "├╌" : "├─";
    r.push(g);
  });
}
