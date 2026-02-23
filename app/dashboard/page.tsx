"use client";

import { trpc } from "@/lib/trpc";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { signOut, useSession } from "next-auth/react";
import dynamic from "next/dynamic";
import type { JSX } from "react";

const GraphView = dynamic(() => import("@/components/GraphView"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-[#0b0e14] text-[#6e7681]">
      Loading…
    </div>
  ),
});

// ━━━ Types ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
type Node = {
  id: string;
  title: string;
  content: string;
  userId: string;
  importanceScore: number;
  createdAt: Date;
  updatedAt: Date;
  edgesFrom: Array<{
    id: string;
    type: string;
    fromNodeId: string;
    toNodeId: string;
    weight: number;
  }>;
  edgesTo: Array<{
    id: string;
    type: string;
    fromNodeId: string;
    toNodeId: string;
    weight: number;
  }>;
};
type VimMode = "NORMAL" | "INSERT" | "VISUAL";
type UIFocus = "list" | "editor";
type LinkType = "parent" | "child" | "reference" | "example" | "contradiction";
type LinkerFocus = "conns" | "type" | "candidates" | "filter";
type Pos = { line: number; col: number };
type DocSnapshot = { lines: string[]; cursor: Pos };

// ━━━ Constants ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const LINK_TYPES: {
  type: LinkType;
  label: string;
  color: string;
  icon: string;
}[] = [
  { type: "child", label: "Child", color: "#bf4070", icon: "↓" },
  { type: "parent", label: "Parent", color: "#bf4070", icon: "↑" },
  { type: "reference", label: "Reference", color: "#3d8b55", icon: "↔" },
  { type: "example", label: "Example", color: "#3d7a9e", icon: "◇" },
  {
    type: "contradiction",
    label: "Contradiction",
    color: "#9e7a22",
    icon: "⊥",
  },
];
const EDGE_COLORS: Record<string, string> = {
  parent: "#bf4070",
  reference: "#3d8b55",
  example: "#3d7a9e",
  contradiction: "#9e7a22",
};
const EDGE_COLORS_BRIGHT: Record<string, string> = {
  parent: "#FF6B9D",
  reference: "#7ee787",
  example: "#79c0ff",
  contradiction: "#d29922",
};

// ━━━ Helpers ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function getNodeColor(n: Node): string {
  const sp = n.edgesTo.find((e) =>
    ["reference", "example", "contradiction"].includes(e.type)
  );
  if (sp)
    return sp.type === "example"
      ? "#3d7a9e"
      : sp.type === "contradiction"
      ? "#9e7a22"
      : "#3d8b55";
  const c =
    n.edgesFrom.filter(
      (e) => !["reference", "example", "contradiction"].includes(e.type)
    ).length +
    n.edgesTo.filter(
      (e) => !["reference", "example", "contradiction"].includes(e.type)
    ).length;
  return c > 5 ? "#da3633" : c > 2 ? "#a33030" : "#8b5cf6";
}
function wouldCreateCircle(
  fromId: string,
  toId: string,
  nodes: Node[]
): boolean {
  const vis = new Set<string>();
  const go = (id: string): boolean => {
    if (vis.has(id)) return false;
    if (id === fromId) return true;
    vis.add(id);
    const n = nodes.find((x) => x.id === id);
    if (n)
      for (const e of n.edgesTo)
        if (e.type === "parent" && go(e.fromNodeId)) return true;
    return false;
  };
  return go(toId);
}
function nextWord(l: string, c: number): number {
  let i = c;
  if (i < l.length && /\w/.test(l[i]))
    while (i < l.length && /\w/.test(l[i])) i++;
  else while (i < l.length && !/\w/.test(l[i]) && l[i] !== " ") i++;
  while (i < l.length && /\s/.test(l[i])) i++;
  return Math.min(i, l.length);
}
function endOfWord(l: string, c: number): number {
  let i = c + 1;
  while (i < l.length && /\s/.test(l[i])) i++;
  while (i < l.length && /\w/.test(l[i])) i++;
  return Math.min(Math.max(i - 1, c), l.length - 1);
}
function prevWord(l: string, c: number): number {
  let i = c - 1;
  while (i > 0 && /\s/.test(l[i])) i--;
  while (i > 0 && /\w/.test(l[i - 1])) i--;
  return Math.max(0, i);
}
function findChar(l: string, c: number, ch: string, fwd: boolean): number {
  if (fwd) {
    const i = l.indexOf(ch, c + 1);
    return i >= 0 ? i : c;
  } else {
    const i = l.lastIndexOf(ch, c - 1);
    return i >= 0 ? i : c;
  }
}
function clampCol(ls: string[], ln: number, c: number, ins: boolean): number {
  const len = ls[ln]?.length ?? 0;
  return ins ? Math.min(c, len) : Math.min(c, Math.max(0, len - 1));
}
function posMin(a: Pos, b: Pos): Pos {
  return a.line < b.line || (a.line === b.line && a.col <= b.col) ? a : b;
}
function posMax(a: Pos, b: Pos): Pos {
  return a.line > b.line || (a.line === b.line && a.col >= b.col) ? a : b;
}
function findMatchingPair(
  l: string,
  c: number,
  o: string,
  cl: string
): [number, number] | null {
  let s = c,
    e = c;
  while (s >= 0 && l[s] !== o) s--;
  while (e < l.length && l[e] !== cl) e++;
  return s >= 0 && e < l.length ? [s, e] : null;
}
function getBracketCtx(
  t: string,
  c: number
): { query: string; start: number } | null {
  const b = t.slice(0, c);
  const i = b.lastIndexOf("[[");
  if (i === -1 || b.slice(i + 2).includes("]]")) return null;
  return { query: b.slice(i + 2), start: i };
}

// ━━━ Tree builder with ghost ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
type TreeLine = {
  indent: number;
  label: string;
  nodeId: string;
  isCurrent: boolean;
  connector: string;
  edgeType?: string;
  isGhost?: boolean;
  ghostEdgeType?: string;
};

function buildTreeWithPreview(
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
    _trav(nodeId, 1, true, new Set(), r, nodeId, undefined, gt, nodes);
    return r;
  }
  _trav(rootId, 0, true, new Set(), r, nodeId, preview, gt, nodes);
  return r;
}
function _trav(
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
    _trav(cid, d + 1, idx === tot, vis, r, cur, pv, gt, nodes);
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

// ━━━ Markdown ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function renderFmt(t: string): {
  className?: string;
  content: (string | JSX.Element)[];
} {
  if (t.startsWith("### "))
    return {
      className: "text-[#e6edf3] font-bold text-[13px]",
      content: renderInl(t.slice(4)),
    };
  if (t.startsWith("## "))
    return {
      className: "text-[#e6edf3] font-bold text-[15px]",
      content: renderInl(t.slice(3)),
    };
  if (t.startsWith("# "))
    return {
      className: "text-[#e6edf3] font-bold text-[17px]",
      content: renderInl(t.slice(2)),
    };
  if (/^\s*[-*]\s/.test(t))
    return {
      content: [
        <span key="b" className="text-[#6e7681]">
          {" "}
          •{" "}
        </span>,
        ...renderInl(t.replace(/^\s*[-*]\s/, "")),
      ],
    };
  if (t.trim() === "") return { content: [] };
  return { content: renderInl(t) };
}
function renderInl(t: string): (string | JSX.Element)[] {
  const o: (string | JSX.Element)[] = [];
  let k = 0;
  const re = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`(.+?)`)|(\[\[(.+?)\]\])/g;
  let li = 0,
    m;
  while ((m = re.exec(t)) !== null) {
    if (m.index > li) o.push(t.slice(li, m.index));
    if (m[1])
      o.push(
        <span key={k++} className="text-[#e6edf3] font-bold">
          {m[2]}
        </span>
      );
    else if (m[3])
      o.push(
        <span key={k++} className="text-[#e6edf3] italic">
          {m[4]}
        </span>
      );
    else if (m[5])
      o.push(
        <code key={k++} className="bg-[#1c2030] text-[#f0883e] px-1 rounded">
          {m[6]}
        </code>
      );
    else if (m[7])
      o.push(
        <span
          key={k++}
          className="text-[#da3633] underline decoration-[#da3633]/30"
        >
          [[{m[8]}]]
        </span>
      );
    li = m.index + m[0].length;
  }
  if (li < t.length) o.push(t.slice(li));
  return o.length > 0 ? o : [t];
}

// ━━━ Help content ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const HELP_SECTIONS = [
  {
    title: "Navigation",
    items: [
      ["j / k", "Move down / up"],
      ["h / l", "Move left / right"],
      ["w / b / e", "Next / prev / end word"],
      ["0 / $ / ^", "Line start / end / first char"],
      ["gg / G", "Document top / bottom"],
    ],
  },
  {
    title: "Editing",
    items: [
      ["i / a / A / I", "Insert before / after / end / start"],
      ["o / O", "New line below / above"],
      ["dd / dw / D", "Delete line / word / to end"],
      ["cc / cw / C", "Change line / word / to end"],
      ['ci" ci( ci[', "Change inside pair"],
      ["x / r{c} / ~", "Delete char / replace / toggle case"],
      ["J", "Join lines"],
      ["u / Ctrl+R", "Undo / redo"],
      ["v → d/y/c", "Visual select → action"],
      ["yy / p / P", "Yank line / paste below / above"],
    ],
  },
  {
    title: "App",
    items: [
      ["Space", "Open link panel"],
      ["g", "Toggle graph / notes view"],
      ["q", "Close note → list"],
      ["n", "Create new node"],
      ["dd", "Delete node"],
      ["/", "Search nodes"],
      ["Ctrl+S", "Save current note"],
      ["Esc", "Exit mode (INSERT→NORMAL)"],
      ["[[", "Wiki-link autocomplete"],
      ["?", "This help panel"],
    ],
  },
  {
    title: "Link Panel",
    items: [
      ["h / l", "Change link type"],
      ["j / k", "Navigate vertically through sections"],
      ["f", "Focus filter input"],
      ["d", "Delete connection"],
      ["Enter / Space", "Create link"],
      ["Esc", "Close panel"],
    ],
  },
];

function buildDoc(t: string, c: string): string[] {
  return ["## " + t, "", ...(c ? c.split("\n") : [""])];
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export default function Dashboard() {
  const { data: session } = useSession();
  const [view, setView] = useState<"notes" | "graph">("notes");
  const [uiFocus, setUIFocus] = useState<UIFocus>("list");
  const [listIdx, setListIdx] = useState(0);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [vimMode, setVimMode] = useState<VimMode>("NORMAL");
  const [lines, setLines] = useState<string[]>([]);
  const [cursor, setCursor] = useState<Pos>({ line: 0, col: 0 });
  const [visualAnchor, setVisualAnchor] = useState<Pos | null>(null);
  const [yankReg, setYankReg] = useState("");
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const desiredCol = useRef(0);
  const [undoStack, setUndoStack] = useState<DocSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<DocSnapshot[]>([]);

  // ★ Refs for latest state — fixes stale closure in rapid keypresses
  const linesRef = useRef(lines);
  const cursorRef = useRef(cursor);
  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);
  useEffect(() => {
    cursorRef.current = cursor;
  }, [cursor]);

  const pushUndo = useCallback(() => {
    setUndoStack((p) => [
      ...p.slice(-50),
      { lines: [...linesRef.current], cursor: { ...cursorRef.current } },
    ]);
    setRedoStack([]);
  }, []); // stable — reads from refs

  // Linker
  const [showLinker, setShowLinker] = useState(false);
  const [linkerFocus, setLinkerFocus] = useState<LinkerFocus>("type");
  const [linkTypeIdx, setLinkTypeIdx] = useState(0);
  const [linkSearch, setLinkSearch] = useState("");
  const [linkCandIdx, setLinkCandIdx] = useState(0);
  const [connIdx, setConnIdx] = useState(0);
  const linkSearchRef = useRef<HTMLInputElement>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchIdx, setSearchIdx] = useState(0);
  const [showSearch, setShowSearch] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [bracketSugs, setBracketSugs] = useState<Node[]>([]);
  const [bracketIdx, setBracketIdx] = useState(0);
  const [isCreating, setIsCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const newTitleRef = useRef<HTMLInputElement>(null);
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });
  const [showHelp, setShowHelp] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const flashT = useRef<NodeJS.Timeout | null>(null);
  const flash = useCallback((m: string) => {
    setStatusMsg(m);
    if (flashT.current) clearTimeout(flashT.current);
    flashT.current = setTimeout(() => setStatusMsg(""), 2500);
  }, []);
  const gTimerRef = useRef<NodeJS.Timeout | null>(null);

  // tRPC optimistic
  const utils = trpc.useUtils();
  const { data: nodes, isLoading } = trpc.node.getAll.useQuery();

  const createNode = trpc.node.create.useMutation({
    onMutate: async (input) => {
      await utils.node.getAll.cancel();
      const prev = utils.node.getAll.getData();
      const fid = "tmp-" + crypto.randomUUID();
      const fake: Node = {
        id: fid,
        title: input.title,
        content: input.content ?? "",
        userId: "",
        importanceScore: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        edgesFrom: [],
        edgesTo: [],
      };
      utils.node.getAll.setData(undefined, (old) =>
        old ? [fake, ...old] : [fake]
      );
      setIsCreating(false);
      setNewTitle("");
      setSelectedNodeId(fid);
      setLines(buildDoc(input.title, input.content || ""));
      setCursor({ line: 0, col: 0 });
      setUIFocus("editor");
      setVimMode("NORMAL");
      setUndoStack([]);
      setRedoStack([]);
      return { prev, fid };
    },
    onSuccess: (real, _, ctx) => {
      utils.node.getAll.setData(undefined, (old) =>
        old?.map((n) =>
          n.id === ctx?.fid
            ? { ...n, ...real, edgesFrom: n.edgesFrom, edgesTo: n.edgesTo }
            : n
        )
      );
      if (selectedNodeId === ctx?.fid) {
        setSelectedNodeId(real.id);
        setLines(buildDoc(real.title, real.content || ""));
      }
      setTimeout(() => utils.node.getAll.invalidate(), 300);
    },
    onError: (_, __, ctx) => {
      if (ctx?.prev) utils.node.getAll.setData(undefined, ctx.prev);
    },
  });
  const updateNode = trpc.node.update.useMutation({
    onMutate: async (input) => {
      await utils.node.getAll.cancel();
      const prev = utils.node.getAll.getData();
      utils.node.getAll.setData(undefined, (old) =>
        old?.map((n) =>
          n.id === input.id
            ? {
                ...n,
                title: input.title ?? n.title,
                content: input.content ?? n.content,
              }
            : n
        )
      );
      return { prev };
    },
    onError: (_, __, ctx) => {
      if (ctx?.prev) utils.node.getAll.setData(undefined, ctx.prev);
    },
    onSettled: () => setTimeout(() => utils.node.getAll.invalidate(), 500),
  });
  const deleteNode = trpc.node.delete.useMutation({
    onMutate: async (input) => {
      await utils.node.getAll.cancel();
      const prev = utils.node.getAll.getData();
      utils.node.getAll.setData(undefined, (old) =>
        old?.filter((n) => n.id !== input.id)
      );
      setSelectedNodeId(null);
      setUIFocus("list");
      setVimMode("NORMAL");
      setLines([]);
      return { prev };
    },
    onError: (_, __, ctx) => {
      if (ctx?.prev) utils.node.getAll.setData(undefined, ctx.prev);
    },
    onSettled: () => setTimeout(() => utils.node.getAll.invalidate(), 300),
  });
  const createEdge = trpc.edge.create.useMutation({
    onMutate: async (input) => {
      await utils.node.getAll.cancel();
      const prev = utils.node.getAll.getData();
      const fe = {
        id: "tmp-e-" + Date.now(),
        type: input.type ?? "reference",
        fromNodeId: input.fromNodeId,
        toNodeId: input.toNodeId,
        weight: input.weight ?? 1.0,
      };
      utils.node.getAll.setData(undefined, (old) =>
        old?.map((n) => {
          if (n.id === input.fromNodeId)
            return { ...n, edgesFrom: [...n.edgesFrom, fe] };
          if (n.id === input.toNodeId)
            return { ...n, edgesTo: [...n.edgesTo, fe] };
          return n;
        })
      );
      setLinkCandIdx(0);
      setLinkSearch("");
      return { prev };
    },
    onError: (_, __, ctx) => {
      if (ctx?.prev) utils.node.getAll.setData(undefined, ctx.prev);
      flash("Link failed");
    },
    onSettled: () => setTimeout(() => utils.node.getAll.invalidate(), 300),
  });
  const deleteEdge = trpc.edge.delete.useMutation({
    onMutate: async (input) => {
      await utils.node.getAll.cancel();
      const prev = utils.node.getAll.getData();
      utils.node.getAll.setData(undefined, (old) =>
        old?.map((n) => ({
          ...n,
          edgesFrom: n.edgesFrom.filter((e) => e.id !== input.id),
          edgesTo: n.edgesTo.filter((e) => e.id !== input.id),
        }))
      );
      return { prev };
    },
    onError: (_, __, ctx) => {
      if (ctx?.prev) utils.node.getAll.setData(undefined, ctx.prev);
      flash("Unlink failed");
    },
    onSettled: () => setTimeout(() => utils.node.getAll.invalidate(), 300),
  });

  // Derived
  const sortedNodes = useMemo(
    () =>
      nodes
        ? [...nodes].sort(
            (a, b) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          )
        : [],
    [nodes]
  );
  const selectedNode = selectedNodeId
    ? nodes?.find((n) => n.id === selectedNodeId)
    : null;
  const hoverNode = hoverNodeId
    ? nodes?.find((n) => n.id === hoverNodeId)
    : null;
  const allConns = useMemo(() => {
    if (!selectedNode) return [];
    return [
      ...selectedNode.edgesFrom.map((e) => ({ ...e, dir: "out" as const })),
      ...selectedNode.edgesTo.map((e) => ({ ...e, dir: "in" as const })),
    ];
  }, [selectedNode]);
  const linkCandidates = useMemo(() => {
    if (!selectedNodeId || !nodes) return [];
    const src = nodes.find((n) => n.id === selectedNodeId);
    if (!src) return [];
    const linked = new Set([
      ...src.edgesFrom.map((e) => e.toNodeId),
      ...src.edgesTo.map((e) => e.fromNodeId),
    ]);
    let c = nodes.filter((n) => n.id !== selectedNodeId && !linked.has(n.id));
    if (linkSearch) {
      const q = linkSearch.toLowerCase();
      c = c.filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          n.content.toLowerCase().includes(q)
      );
    }
    return c.slice(0, 20);
  }, [selectedNodeId, nodes, linkSearch]);
  const searchResults = useMemo(() => {
    if (!searchQuery.trim() || !sortedNodes.length) return [];
    const q = searchQuery.toLowerCase();
    return sortedNodes.filter(
      (n) =>
        n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q)
    );
  }, [searchQuery, sortedNodes]);
  const focusedCand =
    showLinker && linkerFocus === "candidates" && linkCandidates[linkCandIdx]
      ? linkCandidates[linkCandIdx]
      : null;
  const treeLines = useMemo(() => {
    if (!selectedNodeId || !nodes) return [];
    const gt = (id: string) => nodes.find((n) => n.id === id)?.title || "?";
    const pv = focusedCand
      ? {
          targetId: focusedCand.id,
          targetTitle: focusedCand.title,
          linkType: LINK_TYPES[linkTypeIdx].type,
        }
      : undefined;
    return buildTreeWithPreview(selectedNodeId, nodes, gt, pv);
  }, [selectedNodeId, nodes, focusedCand, linkTypeIdx]);
  const getNodeTitle = useCallback(
    (id: string) => nodes?.find((n) => n.id === id)?.title || "?",
    [nodes]
  );

  function extractDoc(d: string[]): { title: string; content: string } {
    return {
      title: (d[0] || "").replace(/^#+\s*/, "").trim() || "Untitled",
      content: d.slice(2).join("\n"),
    };
  }
  const saveDoc = useCallback(() => {
    if (!selectedNodeId || linesRef.current.length === 0) return;
    const { title, content } = extractDoc(linesRef.current);
    updateNode.mutate({ id: selectedNodeId, title, content });
  }, [selectedNodeId, updateNode]);
  const selectNode = useCallback(
    (nodeId: string) => {
      if (
        selectedNodeId &&
        selectedNodeId !== nodeId &&
        linesRef.current.length > 0
      ) {
        const { title, content } = extractDoc(linesRef.current);
        updateNode.mutate({ id: selectedNodeId, title, content });
      }
      const node = nodes?.find((n) => n.id === nodeId);
      if (!node) return;
      setSelectedNodeId(nodeId);
      setLines(buildDoc(node.title, node.content));
      setCursor({ line: 0, col: 0 });
      desiredCol.current = 0;
      setVimMode("NORMAL");
      setVisualAnchor(null);
      setUndoStack([]);
      setRedoStack([]);
      const idx = sortedNodes.findIndex((n) => n.id === nodeId);
      if (idx >= 0) setListIdx(idx);
    },
    [nodes, sortedNodes, selectedNodeId, updateNode]
  );

  const validateAndLink = useCallback(
    (targetId: string) => {
      if (!selectedNodeId || !nodes) return;
      const src = nodes.find((n) => n.id === selectedNodeId)!,
        tgt = nodes.find((n) => n.id === targetId)!;
      if (!src || !tgt) return;
      const lt = LINK_TYPES[linkTypeIdx].type;
      if (
        src.edgesTo.some((e) =>
          ["reference", "example", "contradiction"].includes(e.type)
        )
      ) {
        flash("Source is special node");
        return;
      }
      if (
        tgt.edgesTo.some((e) =>
          ["reference", "example", "contradiction"].includes(e.type)
        )
      ) {
        flash("Target is special node");
        return;
      }
      let from = selectedNodeId,
        to = targetId,
        et: string = lt;
      if (lt === "parent" || lt === "child") {
        const check = lt === "parent" ? src : tgt;
        if (check.edgesTo.some((e) => e.type === "parent")) {
          flash("Already has parent");
          return;
        }
        if (
          wouldCreateCircle(
            lt === "parent" ? targetId : selectedNodeId,
            lt === "parent" ? selectedNodeId : targetId,
            nodes
          )
        ) {
          flash("Would create cycle");
          return;
        }
        if (lt === "parent") [from, to] = [to, from];
        et = "parent";
      } else {
        const sI =
          !src.edgesFrom.some((e) => e.type === "parent") &&
          !src.edgesTo.some((e) => e.type === "parent");
        const tI =
          !tgt.edgesFrom.some((e) => e.type === "parent") &&
          !tgt.edgesTo.some((e) => e.type === "parent");
        if (!sI && !tI) {
          flash("One node must be isolated");
          return;
        }
        if (sI && !tI) [from, to] = [to, from];
      }
      createEdge.mutate({
        fromNodeId: from,
        toNodeId: to,
        type: et as "reference" | "parent" | "example" | "contradiction",
      });
      flash("Linked ✓");
    },
    [selectedNodeId, nodes, linkTypeIdx, createEdge, flash]
  );

  useEffect(() => {
    if (nodes && nodes.length === 0 && !isCreating && !isLoading) {
      queueMicrotask(() => {
        setIsCreating(true);
        setTimeout(() => newTitleRef.current?.focus(), 100);
      });
    }
  }, [nodes, isCreating, isLoading]);

  useEffect(() => {
    if (uiFocus === "editor")
      document
        .getElementById(`ed-line-${cursor.line}`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [cursor.line, uiFocus]);

  // ★ Vim helpers — all use linesRef/cursorRef for freshness
  function insertChar(ch: string) {
    pushUndo();
    const cur = cursorRef.current;
    setLines((p) => {
      const nl = [...p];
      nl[cur.line] =
        nl[cur.line].slice(0, cur.col) + ch + nl[cur.line].slice(cur.col);
      return nl;
    });
    setCursor({ line: cur.line, col: cur.col + ch.length });
    desiredCol.current = cur.col + ch.length;
  }
  function checkBracket() {
    setTimeout(() => {
      const cl = linesRef.current;
      const cc = cursorRef.current;
      const ln = cl[cc.line] || "";
      const ctx = getBracketCtx(ln, cc.col + 1);
      if (ctx && ctx.query.length > 0 && nodes) {
        setBracketSugs(
          nodes
            .filter(
              (n) =>
                n.id !== selectedNodeId &&
                n.title.toLowerCase().includes(ctx.query.toLowerCase())
            )
            .slice(0, 6)
        );
        setBracketIdx(0);
      } else setBracketSugs([]);
    }, 0);
  }
  function insertBracketLink(node: Node) {
    const cur = cursorRef.current;
    const cl = linesRef.current;
    const lt = cl[cur.line] || "";
    const ctx = getBracketCtx(lt, cur.col);
    if (!ctx) return;
    pushUndo();
    const nt = lt.slice(0, ctx.start) + `[[${node.title}]]` + lt.slice(cur.col);
    setLines((p) => {
      const nl = [...p];
      nl[cur.line] = nt;
      return nl;
    });
    setCursor({ line: cur.line, col: ctx.start + node.title.length + 4 });
    setBracketSugs([]);
  }
  function doUndo() {
    if (!undoStack.length) return;
    const s = undoStack[undoStack.length - 1];
    setRedoStack((p) => [
      ...p,
      { lines: [...linesRef.current], cursor: { ...cursorRef.current } },
    ]);
    setUndoStack((p) => p.slice(0, -1));
    setLines(s.lines);
    setCursor(s.cursor);
  }
  function doRedo() {
    if (!redoStack.length) return;
    const s = redoStack[redoStack.length - 1];
    setUndoStack((p) => [
      ...p,
      { lines: [...linesRef.current], cursor: { ...cursorRef.current } },
    ]);
    setRedoStack((p) => p.slice(0, -1));
    setLines(s.lines);
    setCursor(s.cursor);
  }
  function deleteLine() {
    pushUndo();
    const cur = cursorRef.current;
    setLines((p) => {
      const nl = [...p];
      setYankReg(nl[cur.line] || "");
      if (nl.length === 1) {
        nl[0] = "";
        setCursor({ line: 0, col: 0 });
      } else {
        nl.splice(cur.line, 1);
        setCursor({ line: Math.min(cur.line, nl.length - 1), col: 0 });
      }
      return nl;
    });
  }
  function deleteToEOL() {
    pushUndo();
    const cur = cursorRef.current;
    setLines((p) => {
      const nl = [...p];
      setYankReg(nl[cur.line].slice(cur.col));
      nl[cur.line] = nl[cur.line].slice(0, cur.col);
      return nl;
    });
  }
  function changeLine() {
    pushUndo();
    const cur = cursorRef.current;
    setYankReg(linesRef.current[cur.line]);
    setLines((p) => {
      const nl = [...p];
      nl[cur.line] = "";
      return nl;
    });
    setCursor({ ...cur, col: 0 });
    setVimMode("INSERT");
  }
  function deleteWord() {
    pushUndo();
    const cur = cursorRef.current;
    const l = linesRef.current[cur.line] || "";
    const end = nextWord(l, cur.col);
    setYankReg(l.slice(cur.col, end));
    setLines((p) => {
      const nl = [...p];
      nl[cur.line] = l.slice(0, cur.col) + l.slice(end);
      return nl;
    });
  }
  function changeWord() {
    deleteWord();
    setVimMode("INSERT");
  }
  function deleteInsidePair(o: string, c: string) {
    const cur = cursorRef.current;
    const l = linesRef.current[cur.line] || "";
    const p = findMatchingPair(l, cur.col, o, c);
    if (!p) return;
    pushUndo();
    setYankReg(l.slice(p[0] + 1, p[1]));
    setLines((pr) => {
      const nl = [...pr];
      nl[cur.line] = l.slice(0, p[0] + 1) + l.slice(p[1]);
      return nl;
    });
    setCursor({ ...cur, col: p[0] + 1 });
  }
  function changeInsidePair(o: string, c: string) {
    deleteInsidePair(o, c);
    setVimMode("INSERT");
  }
  function joinLines() {
    const cur = cursorRef.current;
    if (cur.line >= linesRef.current.length - 1) return;
    pushUndo();
    setLines((p) => {
      const nl = [...p];
      const jc = nl[cur.line].length;
      nl[cur.line] += " " + nl[cur.line + 1].trimStart();
      nl.splice(cur.line + 1, 1);
      setCursor({ ...cur, col: jc });
      return nl;
    });
  }
  function replaceChar(ch: string) {
    pushUndo();
    const cur = cursorRef.current;
    setLines((p) => {
      const nl = [...p];
      const l = nl[cur.line];
      if (cur.col < l.length)
        nl[cur.line] = l.slice(0, cur.col) + ch + l.slice(cur.col + 1);
      return nl;
    });
  }
  function toggleCase() {
    const cur = cursorRef.current;
    const l = linesRef.current[cur.line] || "";
    const ch = l[cur.col];
    if (!ch) return;
    pushUndo();
    setLines((p) => {
      const nl = [...p];
      nl[cur.line] =
        l.slice(0, cur.col) +
        (ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase()) +
        l.slice(cur.col + 1);
      return nl;
    });
    setCursor({ ...cur, col: Math.min(cur.col + 1, l.length - 1) });
  }
  function deleteSelection() {
    if (!visualAnchor) return;
    pushUndo();
    const cur = cursorRef.current;
    const s = posMin(visualAnchor, cur),
      e = posMax(visualAnchor, cur);
    setLines((p) => {
      const nl = [...p];
      if (s.line === e.line) {
        setYankReg(nl[s.line].slice(s.col, e.col + 1));
        nl[s.line] = nl[s.line].slice(0, s.col) + nl[s.line].slice(e.col + 1);
      } else {
        const ch = [nl[s.line].slice(s.col)];
        for (let i = s.line + 1; i < e.line; i++) ch.push(nl[i]);
        ch.push(nl[e.line].slice(0, e.col + 1));
        setYankReg(ch.join("\n"));
        nl[s.line] = nl[s.line].slice(0, s.col) + nl[e.line].slice(e.col + 1);
        nl.splice(s.line + 1, e.line - s.line);
      }
      return nl;
    });
    setCursor(posMin(visualAnchor, cur));
    setVimMode("NORMAL");
    setVisualAnchor(null);
  }
  function yankSelection() {
    if (!visualAnchor) return;
    const cur = cursorRef.current;
    const cl = linesRef.current;
    const s = posMin(visualAnchor, cur),
      e = posMax(visualAnchor, cur);
    if (s.line === e.line) setYankReg(cl[s.line].slice(s.col, e.col + 1));
    else {
      const ch = [cl[s.line].slice(s.col)];
      for (let i = s.line + 1; i < e.line; i++) ch.push(cl[i]);
      ch.push(cl[e.line].slice(0, e.col + 1));
      setYankReg(ch.join("\n"));
    }
    setCursor(posMin(visualAnchor, cur));
    setVimMode("NORMAL");
    setVisualAnchor(null);
    flash("Yanked");
  }
  function isSelected(li: number, ci: number): boolean {
    if (vimMode !== "VISUAL" || !visualAnchor) return false;
    const s = posMin(visualAnchor, cursor),
      e = posMax(visualAnchor, cursor);
    if (li < s.line || li > e.line) return false;
    if (li === s.line && li === e.line) return ci >= s.col && ci <= e.col;
    if (li === s.line) return ci >= s.col;
    if (li === e.line) return ci <= e.col;
    return true;
  }
  function moveCursor(dir: string) {
    const cur = cursorRef.current;
    const cl = linesRef.current;
    let nl = cur.line,
      nc = cur.col;
    if (dir === "h") nc = Math.max(0, nc - 1);
    if (dir === "l")
      nc = Math.min(Math.max(0, (cl[nl]?.length ?? 1) - 1), nc + 1);
    if (dir === "j" && nl < cl.length - 1) {
      nl++;
      nc = clampCol(cl, nl, desiredCol.current, false);
    }
    if (dir === "k" && nl > 0) {
      nl--;
      nc = clampCol(cl, nl, desiredCol.current, false);
    }
    if (dir === "h" || dir === "l") desiredCol.current = nc;
    setCursor({ line: nl, col: nc });
  }
  function moveCursorWord(dir: "w" | "b") {
    const cur = cursorRef.current;
    const cl = linesRef.current;
    const l = cl[cur.line] || "";
    if (dir === "w") {
      const nc = nextWord(l, cur.col);
      if (nc >= l.length && cur.line < cl.length - 1) {
        setCursor({ line: cur.line + 1, col: 0 });
        return;
      }
      desiredCol.current = nc;
      setCursor({ ...cur, col: clampCol(cl, cur.line, nc, false) });
    } else {
      const nc = prevWord(l, cur.col);
      if (nc === 0 && cur.col === 0 && cur.line > 0) {
        setCursor({
          line: cur.line - 1,
          col: Math.max(0, (cl[cur.line - 1]?.length ?? 1) - 1),
        });
        return;
      }
      desiredCol.current = nc;
      setCursor({ ...cur, col: nc });
    }
  }
  const switchToGraph = useCallback(() => {
    saveDoc();
    setView((v) => (v === "notes" ? "graph" : "notes"));
  }, [saveDoc]);
  const onGraphClick = useCallback(
    (nodeId: string) => {
      selectNode(nodeId);
      setUIFocus("editor");
      setView("notes");
    },
    [selectNode]
  );
  const onGraphHover = useCallback(
    (nodeId: string | null, x: number, y: number) => {
      setHoverNodeId(nodeId);
      setHoverPos({ x, y });
    },
    []
  );

  // ━━━ KEYBOARD ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        saveDoc();
        return;
      }
      if (showHelp) {
        if (e.key === "Escape" || e.key === "?") {
          e.preventDefault();
          setShowHelp(false);
        }
        return;
      }
      if (isCreating) {
        if (e.key === "Escape") {
          e.preventDefault();
          setIsCreating(false);
          setNewTitle("");
        }
        return;
      }
      if (showSearch) {
        if (e.key === "Escape") {
          e.preventDefault();
          setShowSearch(false);
          setSearchQuery("");
          return;
        }
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSearchIdx((i) => Math.min(i + 1, searchResults.length - 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSearchIdx((i) => Math.max(i - 1, 0));
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          if (searchResults[searchIdx]) {
            selectNode(searchResults[searchIdx].id);
            setUIFocus("editor");
            setView("notes");
            setShowSearch(false);
            setSearchQuery("");
          }
          return;
        }
        return;
      }

      // ━━ LINKER ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      if (showLinker) {
        if (linkerFocus === "filter") {
          if (e.key === "Escape") {
            e.preventDefault();
            (document.activeElement as HTMLElement)?.blur();
            setLinkerFocus("type");
            return;
          }
          if (e.key === "Enter" || e.key === "ArrowDown") {
            e.preventDefault();
            (document.activeElement as HTMLElement)?.blur();
            setLinkerFocus("candidates");
            setLinkCandIdx(0);
            return;
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            (document.activeElement as HTMLElement)?.blur();
            setLinkerFocus("type");
            return;
          }
          return;
        }
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT") return;
        if (e.key === "Escape") {
          e.preventDefault();
          setShowLinker(false);
          return;
        }
        if (e.key === "?") {
          e.preventDefault();
          setShowHelp(true);
          return;
        }
        if (e.key === "h") {
          e.preventDefault();
          setLinkTypeIdx((i) => Math.max(0, i - 1));
          return;
        }
        if (e.key === "l") {
          e.preventDefault();
          setLinkTypeIdx((i) => Math.min(LINK_TYPES.length - 1, i + 1));
          return;
        }
        if (e.key === "f" || e.key === "/") {
          e.preventDefault();
          setLinkerFocus("filter");
          setTimeout(() => {
            linkSearchRef.current?.focus();
            linkSearchRef.current?.select();
          }, 20);
          return;
        }

        if (linkerFocus === "conns") {
          if (e.key === "j") {
            e.preventDefault();
            if (connIdx < allConns.length - 1) setConnIdx((i) => i + 1);
            else setLinkerFocus("type");
            return;
          }
          if (e.key === "k") {
            e.preventDefault();
            setConnIdx((i) => Math.max(i - 1, 0));
            return;
          }
          if ((e.key === "d" || e.key === "x") && allConns[connIdx]) {
            e.preventDefault();
            deleteEdge.mutate({ id: allConns[connIdx].id });
            flash("Unlinked");
            return;
          }
          if (e.key === "Enter" && allConns[connIdx]) {
            e.preventDefault();
            const c = allConns[connIdx];
            const tid = c.dir === "out" ? c.toNodeId : c.fromNodeId;
            setShowLinker(false);
            saveDoc();
            selectNode(tid);
            return;
          }
          return;
        }
        if (linkerFocus === "type") {
          if (e.key === "k") {
            e.preventDefault();
            if (allConns.length > 0) {
              setLinkerFocus("conns");
              setConnIdx(allConns.length - 1);
            }
            return;
          }
          if (e.key === "j") {
            e.preventDefault();
            setLinkerFocus("candidates");
            setLinkCandIdx(0);
            return;
          }
          return;
        }
        if (linkerFocus === "candidates") {
          if (e.key === "j") {
            e.preventDefault();
            setLinkCandIdx((i) => Math.min(i + 1, linkCandidates.length - 1));
            return;
          }
          if (e.key === "k") {
            e.preventDefault();
            if (linkCandIdx > 0) setLinkCandIdx((i) => i - 1);
            else setLinkerFocus("type");
            return;
          }
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (linkCandidates[linkCandIdx])
              validateAndLink(linkCandidates[linkCandIdx].id);
            return;
          }
          return;
        }
        return;
      }

      // ━━ Escape ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      if (e.key === "Escape") {
        e.preventDefault();
        if (vimMode === "VISUAL") {
          setVimMode("NORMAL");
          setVisualAnchor(null);
          return;
        }
        if (vimMode === "INSERT") {
          setVimMode("NORMAL");
          setBracketSugs([]);
          setCursor((c) => ({
            ...c,
            col: clampCol(linesRef.current, c.line, c.col, false),
          }));
          return;
        }
        if (uiFocus === "list" && selectedNodeId) {
          saveDoc();
          setSelectedNodeId(null);
          setLines([]);
          return;
        }
        setPendingKey(null);
        return;
      }
      if (e.key === "?" && uiFocus !== "editor") {
        e.preventDefault();
        setShowHelp(true);
        return;
      }

      // ━━ LIST ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      if (uiFocus === "list") {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        // dd to delete node in list
        if (pendingKey === "d" && e.key === "d") {
          e.preventDefault();
          setPendingKey(null);
          const n = sortedNodes[listIdx];
          if (n && confirm(`Delete "${n.title}" and all its connections?`)) {
            deleteNode.mutate({ id: n.id });
            flash("Deleted");
            setListIdx((i) => Math.max(0, i - 1));
          }
          return;
        }
        if (e.key === "d") {
          e.preventDefault();
          setPendingKey("d");
          return;
        }
        if (pendingKey) {
          setPendingKey(null);
        }
        if (e.key === "j") {
          e.preventDefault();
          setListIdx((i) => Math.min(i + 1, sortedNodes.length - 1));
          return;
        }
        if (e.key === "k") {
          e.preventDefault();
          setListIdx((i) => Math.max(i - 1, 0));
          return;
        }
        if (e.key === "l" || e.key === "Enter") {
          e.preventDefault();
          if (sortedNodes[listIdx]) {
            selectNode(sortedNodes[listIdx].id);
            setUIFocus("editor");
          }
          return;
        }
        if (e.key === "n") {
          e.preventDefault();
          setIsCreating(true);
          setTimeout(() => newTitleRef.current?.focus(), 30);
          return;
        }
        if (e.key === "/") {
          e.preventDefault();
          setShowSearch(true);
          setSearchQuery("");
          setSearchIdx(0);
          setTimeout(() => searchRef.current?.focus(), 20);
          return;
        }
        if (e.key === "g" || e.key === "Tab") {
          e.preventDefault();
          switchToGraph();
          return;
        }
        return;
      }

      // ★ INSERT — all reads via cursorRef for freshness
      if (vimMode === "INSERT") {
        const cur = cursorRef.current;
        const cl = linesRef.current;
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          setCursor({ ...cur, col: Math.max(0, cur.col - 1) });
          return;
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          setCursor({
            ...cur,
            col: Math.min(cur.col + 1, cl[cur.line]?.length ?? 0),
          });
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          const nl = Math.max(0, cur.line - 1);
          setCursor({ line: nl, col: clampCol(cl, nl, cur.col, true) });
          return;
        }
        if (e.key === "ArrowDown") {
          e.preventDefault();
          const nl = Math.min(cl.length - 1, cur.line + 1);
          setCursor({ line: nl, col: clampCol(cl, nl, cur.col, true) });
          return;
        }
        if (bracketSugs.length > 0 && (e.key === "Tab" || e.key === "Enter")) {
          e.preventDefault();
          insertBracketLink(bracketSugs[bracketIdx]);
          return;
        }
        if (e.key === "Backspace") {
          e.preventDefault();
          pushUndo();
          const c = cursorRef.current;
          const cl2 = linesRef.current;
          setLines(() => {
            const nl = [...cl2];
            if (c.col > 0) {
              nl[c.line] =
                nl[c.line].slice(0, c.col - 1) + nl[c.line].slice(c.col);
              setCursor({ line: c.line, col: c.col - 1 });
            } else if (c.line > 0) {
              const pL = nl[c.line - 1].length;
              nl[c.line - 1] += nl[c.line];
              nl.splice(c.line, 1);
              setCursor({ line: c.line - 1, col: pL });
            }
            return nl;
          });
          checkBracket();
          return;
        }
        if (e.key === "Delete") {
          e.preventDefault();
          pushUndo();
          const c = cursorRef.current;
          const cl2 = linesRef.current;
          setLines(() => {
            const nl = [...cl2];
            if (c.col < nl[c.line].length)
              nl[c.line] =
                nl[c.line].slice(0, c.col) + nl[c.line].slice(c.col + 1);
            else if (c.line < nl.length - 1) {
              nl[c.line] += nl[c.line + 1];
              nl.splice(c.line + 1, 1);
            }
            return nl;
          });
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          pushUndo();
          const c = cursorRef.current;
          const cl2 = linesRef.current;
          setLines(() => {
            const nl = [...cl2];
            const rest = nl[c.line].slice(c.col);
            nl[c.line] = nl[c.line].slice(0, c.col);
            nl.splice(c.line + 1, 0, rest);
            setCursor({ line: c.line + 1, col: 0 });
            return nl;
          });
          setBracketSugs([]);
          return;
        }
        if (e.key === "Tab") {
          e.preventDefault();
          insertChar("  ");
          return;
        }
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
          e.preventDefault();
          insertChar(e.key);
          checkBracket();
          return;
        }
        return;
      }

      // ━━ VISUAL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      if (vimMode === "VISUAL") {
        if ("hjkl".includes(e.key)) {
          e.preventDefault();
          moveCursor(e.key);
          return;
        }
        if (e.key === "w") {
          e.preventDefault();
          moveCursorWord("w");
          return;
        }
        if (e.key === "b") {
          e.preventDefault();
          moveCursorWord("b");
          return;
        }
        if (e.key === "d" || e.key === "x") {
          e.preventDefault();
          deleteSelection();
          return;
        }
        if (e.key === "y") {
          e.preventDefault();
          yankSelection();
          return;
        }
        if (e.key === "c") {
          e.preventDefault();
          deleteSelection();
          setVimMode("INSERT");
          return;
        }
        return;
      }

      // ━━ NORMAL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const cur = cursorRef.current;
      const cl = linesRef.current;

      if (pendingKey) {
        e.preventDefault();
        const combo = pendingKey + e.key;
        setPendingKey(null);
        if (gTimerRef.current) {
          clearTimeout(gTimerRef.current);
          gTimerRef.current = null;
        }
        if (combo === "dd") {
          deleteLine();
          return;
        }
        if (combo === "yy") {
          setYankReg(cl[cur.line] || "");
          flash("Yanked");
          return;
        }
        if (combo === "gg") {
          setCursor({ line: 0, col: 0 });
          desiredCol.current = 0;
          return;
        }
        if (combo === "cc") {
          changeLine();
          return;
        }
        if (combo === "dw") {
          deleteWord();
          return;
        }
        if (combo === "cw") {
          changeWord();
          return;
        }
        if (combo === "de") {
          deleteWord();
          return;
        }
        if (combo.startsWith("di") || combo.startsWith("ci")) {
          const pairs: Record<string, [string, string]> = {
            '"': ['"', '"'],
            "'": ["'", "'"],
            "(": ["(", ")"],
            ")": ["(", ")"],
            "[": ["[", "]"],
            "]": ["[", "]"],
            "{": ["{", "}"],
            "}": ["{", "}"],
          };
          const p = pairs[e.key];
          if (p) {
            combo.startsWith("ci")
              ? changeInsidePair(p[0], p[1])
              : deleteInsidePair(p[0], p[1]);
            return;
          }
        }
        if (pendingKey === "f" || pendingKey === "F") {
          const nc = findChar(
            cl[cur.line] || "",
            cur.col,
            e.key,
            pendingKey === "f"
          );
          setCursor({ ...cur, col: nc });
          desiredCol.current = nc;
          return;
        }
        if (pendingKey === "r") {
          replaceChar(e.key);
          return;
        }
        if (pendingKey === "g") {
          switchToGraph();
          return;
        }
        return;
      }

      if (e.key === "d") {
        e.preventDefault();
        setPendingKey("d");
        return;
      }
      if (e.key === "y") {
        e.preventDefault();
        setPendingKey("y");
        return;
      }
      if (e.key === "c") {
        e.preventDefault();
        setPendingKey("c");
        return;
      }
      if (e.key === "f") {
        e.preventDefault();
        setPendingKey("f");
        return;
      }
      if (e.key === "F") {
        e.preventDefault();
        setPendingKey("F");
        return;
      }
      if (e.key === "r") {
        e.preventDefault();
        setPendingKey("r");
        return;
      }

      if (e.key === "g") {
        e.preventDefault();
        setPendingKey("g");
        if (gTimerRef.current) clearTimeout(gTimerRef.current);
        gTimerRef.current = setTimeout(() => {
          setPendingKey(null);
          switchToGraph();
          gTimerRef.current = null;
        }, 350);
        return;
      }
      if (e.key === "G") {
        e.preventDefault();
        setCursor({
          line: cl.length - 1,
          col: clampCol(cl, cl.length - 1, 0, false),
        });
        desiredCol.current = 0;
        return;
      }

      if (e.key === "h") {
        e.preventDefault();
        const nc = Math.max(0, cur.col - 1);
        setCursor({ ...cur, col: nc });
        desiredCol.current = nc;
        return;
      }
      if (e.key === "l") {
        e.preventDefault();
        const mx = Math.max(0, (cl[cur.line]?.length ?? 1) - 1);
        const nc = Math.min(cur.col + 1, mx);
        setCursor({ ...cur, col: nc });
        desiredCol.current = nc;
        return;
      }
      if (e.key === "j") {
        e.preventDefault();
        if (cur.line < cl.length - 1)
          setCursor({
            line: cur.line + 1,
            col: clampCol(cl, cur.line + 1, desiredCol.current, false),
          });
        return;
      }
      if (e.key === "k") {
        e.preventDefault();
        if (cur.line > 0)
          setCursor({
            line: cur.line - 1,
            col: clampCol(cl, cur.line - 1, desiredCol.current, false),
          });
        return;
      }
      if (e.key === "w") {
        e.preventDefault();
        moveCursorWord("w");
        return;
      }
      if (e.key === "b") {
        e.preventDefault();
        moveCursorWord("b");
        return;
      }
      if (e.key === "e") {
        e.preventDefault();
        const nc = endOfWord(cl[cur.line] || "", cur.col);
        setCursor({ ...cur, col: nc });
        desiredCol.current = nc;
        return;
      }
      if (e.key === "0") {
        e.preventDefault();
        setCursor({ ...cur, col: 0 });
        desiredCol.current = 0;
        return;
      }
      if (e.key === "$") {
        e.preventDefault();
        const end = Math.max(0, (cl[cur.line]?.length ?? 1) - 1);
        setCursor({ ...cur, col: end });
        desiredCol.current = end;
        return;
      }
      if (e.key === "^") {
        e.preventDefault();
        const first = (cl[cur.line] || "").search(/\S/);
        setCursor({ ...cur, col: first >= 0 ? first : 0 });
        return;
      }

      if (e.key === "i") {
        e.preventDefault();
        setVimMode("INSERT");
        return;
      }
      if (e.key === "a") {
        e.preventDefault();
        setCursor({
          ...cur,
          col: Math.min(cur.col + 1, cl[cur.line]?.length ?? 0),
        });
        setVimMode("INSERT");
        return;
      }
      if (e.key === "A") {
        e.preventDefault();
        setCursor({ ...cur, col: cl[cur.line]?.length ?? 0 });
        setVimMode("INSERT");
        return;
      }
      if (e.key === "I") {
        e.preventDefault();
        const first = (cl[cur.line] || "").search(/\S/);
        setCursor({ ...cur, col: first >= 0 ? first : 0 });
        setVimMode("INSERT");
        return;
      }
      if (e.key === "o") {
        e.preventDefault();
        pushUndo();
        setLines((p) => {
          const nl = [...p];
          nl.splice(cur.line + 1, 0, "");
          return nl;
        });
        setCursor({ line: cur.line + 1, col: 0 });
        setVimMode("INSERT");
        return;
      }
      if (e.key === "O") {
        e.preventDefault();
        pushUndo();
        setLines((p) => {
          const nl = [...p];
          nl.splice(cur.line, 0, "");
          return nl;
        });
        setCursor({ ...cur, col: 0 });
        setVimMode("INSERT");
        return;
      }
      if (e.key === "x") {
        e.preventDefault();
        pushUndo();
        setLines((p) => {
          const nl = [...p];
          const ln = nl[cur.line];
          if (ln.length > 0) {
            nl[cur.line] = ln.slice(0, cur.col) + ln.slice(cur.col + 1);
            if (cur.col >= nl[cur.line].length && cur.col > 0)
              setCursor({ ...cur, col: cur.col - 1 });
          }
          return nl;
        });
        return;
      }
      if (e.key === "J") {
        e.preventDefault();
        joinLines();
        return;
      }
      if (e.key === "~") {
        e.preventDefault();
        toggleCase();
        return;
      }
      if (e.key === "D") {
        e.preventDefault();
        deleteToEOL();
        return;
      }
      if (e.key === "C") {
        e.preventDefault();
        deleteToEOL();
        setVimMode("INSERT");
        return;
      }
      if (e.key === "p") {
        e.preventDefault();
        if (yankReg) {
          pushUndo();
          if (yankReg.includes("\n")) {
            setLines((p) => {
              const nl = [...p];
              nl.splice(cur.line + 1, 0, yankReg);
              return nl;
            });
            setCursor({ line: cur.line + 1, col: 0 });
          } else {
            setLines((p) => {
              const nl = [...p];
              nl[cur.line] =
                nl[cur.line].slice(0, cur.col + 1) +
                yankReg +
                nl[cur.line].slice(cur.col + 1);
              return nl;
            });
            setCursor({ ...cur, col: cur.col + 1 });
          }
        }
        return;
      }
      if (e.key === "P") {
        e.preventDefault();
        if (yankReg) {
          pushUndo();
          if (yankReg.includes("\n")) {
            setLines((p) => {
              const nl = [...p];
              nl.splice(cur.line, 0, yankReg);
              return nl;
            });
          } else {
            setLines((p) => {
              const nl = [...p];
              nl[cur.line] =
                nl[cur.line].slice(0, cur.col) +
                yankReg +
                nl[cur.line].slice(cur.col);
              return nl;
            });
          }
        }
        return;
      }
      if (e.key === "u") {
        e.preventDefault();
        doUndo();
        return;
      }
      if (e.ctrlKey && e.key === "r") {
        e.preventDefault();
        doRedo();
        return;
      }
      if (e.key === "v") {
        e.preventDefault();
        setVimMode("VISUAL");
        setVisualAnchor({ ...cur });
        return;
      }
      if (e.key === " ") {
        e.preventDefault();
        setShowLinker(true);
        setLinkerFocus("type");
        setLinkTypeIdx(0);
        setLinkSearch("");
        setLinkCandIdx(0);
        setConnIdx(0);
        return;
      }
      if (e.key === "q") {
        e.preventDefault();
        saveDoc();
        setUIFocus("list");
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        setShowSearch(true);
        setSearchQuery("");
        setSearchIdx(0);
        setTimeout(() => searchRef.current?.focus(), 20);
        return;
      }
      if (e.key === "n" && !e.ctrlKey) {
        e.preventDefault();
        saveDoc();
        setIsCreating(true);
        setTimeout(() => newTitleRef.current?.focus(), 30);
        return;
      }
      if (e.key === "?") {
        e.preventDefault();
        setShowHelp(true);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        switchToGraph();
        return;
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [
    vimMode,
    uiFocus,
    pendingKey,
    listIdx,
    sortedNodes,
    selectedNodeId,
    showSearch,
    searchResults,
    searchIdx,
    isCreating,
    bracketSugs,
    bracketIdx,
    yankReg,
    showLinker,
    linkerFocus,
    linkTypeIdx,
    linkCandIdx,
    linkCandidates,
    connIdx,
    allConns,
    undoStack,
    redoStack,
    saveDoc,
    selectNode,
    validateAndLink,
    flash,
    pushUndo,
    switchToGraph,
    showHelp,
  ]);

  // ━━━ RENDER ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (isLoading)
    return (
      <div className="h-screen bg-[#0b0e14] flex items-center justify-center">
        <span className="text-[#6e7681] font-mono text-sm">Loading…</span>
      </div>
    );
  const modeColor =
    vimMode === "NORMAL"
      ? "#7ee787"
      : vimMode === "INSERT"
      ? "#d29922"
      : "#79c0ff";

  function renderEditorLine(lineText: string, lineIdx: number) {
    const isCurLine =
      uiFocus === "editor" && lineIdx === cursor.line && !showLinker;
    const lineNum = lineIdx + 1;
    const relNum = Math.abs(lineIdx - cursor.line);
    if (isCurLine) {
      const chars = lineText.split("");
      return (
        <div
          key={lineIdx}
          id={`ed-line-${lineIdx}`}
          className="ed-line flex items-start bg-[#12151e]"
        >
          <span className="ed-gutter select-none flex-shrink-0 w-[44px] text-right pr-3 text-[12px] leading-[22px] text-[#8b949e]">
            {lineNum}
          </span>
          <span className="flex-1 whitespace-pre font-mono text-[14px] leading-[22px] text-[#c9d1d9]">
            {chars.length === 0 ? (
              vimMode === "INSERT" ? (
                <span className="ed-cursor-line" />
              ) : (
                <span className="ed-cursor-block">&nbsp;</span>
              )
            ) : (
              chars.map((ch, ci) => {
                const isCur = ci === cursor.col;
                if (isCur && vimMode === "INSERT")
                  return (
                    <span key={ci}>
                      <span className="ed-cursor-line" />
                      {ch}
                    </span>
                  );
                if (isCur && vimMode === "NORMAL")
                  return (
                    <span key={ci} className="ed-cursor-block">
                      {ch}
                    </span>
                  );
                if (isCur && vimMode === "VISUAL")
                  return (
                    <span key={ci} className="bg-[#79c0ff] text-[#0b0e14]">
                      {ch}
                    </span>
                  );
                if (isSelected(lineIdx, ci))
                  return (
                    <span key={ci} className="bg-[#79c0ff]/20">
                      {ch}
                    </span>
                  );
                return <span key={ci}>{ch}</span>;
              })
            )}
            {vimMode === "INSERT" &&
              cursor.col >= chars.length &&
              chars.length > 0 && <span className="ed-cursor-line" />}
          </span>
        </div>
      );
    }
    if (vimMode === "VISUAL" && visualAnchor) {
      const s = posMin(visualAnchor, cursor),
        ep = posMax(visualAnchor, cursor);
      if (lineIdx >= s.line && lineIdx <= ep.line) {
        const chars = lineText.split("");
        return (
          <div
            key={lineIdx}
            id={`ed-line-${lineIdx}`}
            className="ed-line flex items-start"
          >
            <span className="ed-gutter select-none flex-shrink-0 w-[44px] text-right pr-3 text-[12px] leading-[22px] text-[#6e7681]">
              {relNum || lineNum}
            </span>
            <span className="flex-1 whitespace-pre font-mono text-[14px] leading-[22px] text-[#c9d1d9]">
              {chars.length === 0 ? (
                <span className="bg-[#79c0ff]/20 inline-block w-2 h-[22px]" />
              ) : (
                chars.map((ch, ci) => (
                  <span
                    key={ci}
                    className={isSelected(lineIdx, ci) ? "bg-[#79c0ff]/20" : ""}
                  >
                    {ch}
                  </span>
                ))
              )}
            </span>
          </div>
        );
      }
    }
    const fmt = renderFmt(lineText);
    return (
      <div
        key={lineIdx}
        id={`ed-line-${lineIdx}`}
        className={`ed-line flex items-start ${
          lineText.trim() === "" ? "h-[22px]" : ""
        }`}
      >
        <span className="ed-gutter select-none flex-shrink-0 w-[44px] text-right pr-3 text-[12px] leading-[22px] text-[#6e7681]">
          {relNum || lineNum}
        </span>
        <div
          className={`flex-1 font-mono text-[14px] leading-[22px] text-[#c9d1d9] ${
            fmt.className || ""
          }`}
        >
          {fmt.content}
        </div>
      </div>
    );
  }

  const sectionIndicator = (section: LinkerFocus, label: string) => (
    <div
      className={`flex items-center gap-1.5 mb-1.5 ${
        linkerFocus === section ? "" : "opacity-50"
      }`}
    >
      {linkerFocus === section && (
        <span className="w-1.5 h-1.5 rounded-full bg-[#7ee787]" />
      )}
      <span className="text-[11px] text-[#7d8590] font-mono uppercase tracking-wider">
        {label}
      </span>
    </div>
  );

  return (
    <div className="h-screen flex flex-col bg-[#0b0e14] text-[#c9d1d9] overflow-hidden">
      {/* ━━ HEADER ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <header className="bg-[#0d1117] border-b border-[#21262d] flex-shrink-0 h-11 flex items-center px-4 gap-3">
        {/* Left */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="text-[#8b5cf6] text-[16px]">◆</span>
          <span className="text-[14px] font-semibold text-[#e6edf3] tracking-tight">
            Knowledge Tree
          </span>
        </div>

        {/* View tabs */}
        <div className="flex items-center bg-[#161b22] rounded-md border border-[#21262d] overflow-hidden flex-shrink-0">
          <button
            onClick={() => setView("notes")}
            className={`px-3 py-1 text-[12px] font-medium transition-colors ${
              view === "notes"
                ? "bg-[#21262d] text-[#e6edf3]"
                : "text-[#7d8590] hover:text-[#c9d1d9]"
            }`}
          >
            <span className="mr-1.5">☰</span>Notes
          </button>
          <button
            onClick={() => {
              saveDoc();
              setView("graph");
            }}
            className={`px-3 py-1 text-[12px] font-medium transition-colors ${
              view === "graph"
                ? "bg-[#21262d] text-[#e6edf3]"
                : "text-[#7d8590] hover:text-[#c9d1d9]"
            }`}
          >
            <span className="mr-1.5">◇</span>Graph
          </button>
        </div>

        <span className="text-[11px] text-[#6e7681] font-mono flex-shrink-0">
          {nodes?.length || 0} nodes
        </span>

        {/* Spacer — always present */}
        <div className="flex-1 min-w-0 flex justify-center">
          {selectedNode && view === "notes" && (
            <span className="text-[12px] text-[#8b949e] font-mono truncate max-w-[300px]">
              {selectedNode.title}
            </span>
          )}
        </div>

        {/* Right — always anchored */}
        <div className="flex items-center gap-2.5 flex-shrink-0">
          <button
            onClick={() => setShowHelp(true)}
            className="w-6 h-6 rounded-md flex items-center justify-center text-[12px] text-[#7d8590] hover:text-[#c9d1d9] hover:bg-[#161b22] border border-transparent hover:border-[#21262d] transition-all font-mono font-bold"
            title="Shortcuts (?)"
          >
            ?
          </button>
          <span className="text-[11px] text-[#7d8590] font-mono hidden sm:inline">
            {session?.user?.email}
          </span>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="text-[11px] text-[#7d8590] hover:text-[#c9d1d9] font-mono transition-colors"
          >
            logout
          </button>
        </div>
      </header>

      {/* Search */}
      {showSearch && (
        <div className="bg-[#0d1117] border-b border-[#21262d] flex-shrink-0">
          <div className="max-w-lg mx-auto px-4 py-2">
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#79c0ff] text-[13px] font-mono">
                /
              </span>
              <input
                ref={searchRef}
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSearchIdx(0);
                }}
                placeholder="search…"
                autoFocus
                className="w-full pl-7 pr-3 py-1.5 bg-[#0b0e14] border border-[#30363d] rounded text-[13px] font-mono text-[#e6edf3] placeholder-[#7d8590] focus:border-[#79c0ff]/50 focus:outline-none"
              />
            </div>
            {searchResults.length > 0 && (
              <div className="mt-1 bg-[#0b0e14] border border-[#21262d] rounded overflow-hidden max-h-48 overflow-y-auto custom-scrollbar">
                {searchResults.map((n, i) => (
                  <button
                    key={n.id}
                    onClick={() => {
                      selectNode(n.id);
                      setUIFocus("editor");
                      setView("notes");
                      setShowSearch(false);
                      setSearchQuery("");
                    }}
                    className={`w-full text-left px-3 py-1.5 text-[13px] font-mono flex items-center gap-2 ${
                      i === searchIdx
                        ? "bg-[#21262d] text-[#e6edf3]"
                        : "text-[#c9d1d9] hover:bg-[#161b22]"
                    }`}
                  >
                    <span
                      className="w-[6px] h-[6px] rounded-full"
                      style={{ backgroundColor: getNodeColor(n) }}
                    />
                    <span className="truncate">{n.title}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ━━ MAIN ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="flex-1 overflow-hidden flex">
        {view === "notes" ? (
          <>
            {/* Node list */}
            <div
              className={`${
                selectedNodeId ? "w-[260px] min-w-[260px]" : "flex-1 max-w-lg"
              } h-full border-r border-[#21262d] flex flex-col bg-[#0b0e14] relative`}
            >
              {/* Focus indicator */}
              {uiFocus === "list" && (
                <div className="absolute top-0 left-0 right-0 h-[2px] bg-[#7ee787] z-10" />
              )}
              <div className="flex-shrink-0 p-2 border-b border-[#21262d]">
                <button
                  onClick={() => {
                    setIsCreating(true);
                    setTimeout(() => newTitleRef.current?.focus(), 30);
                  }}
                  className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-[#c9d1d9] rounded text-[11px] font-mono"
                >
                  <span className="text-[#7ee787]">+</span>new
                  <kbd className="text-[10px] text-[#7d8590] ml-1">n</kbd>
                </button>
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar">
                {sortedNodes.length === 0 ? (
                  <div className="flex items-center justify-center h-full">
                    <p className="text-[#7d8590] text-[12px] font-mono">
                      press n to create first node
                    </p>
                  </div>
                ) : (
                  <div className="py-px">
                    {sortedNodes.map((node, idx) => {
                      const isActive = node.id === selectedNodeId;
                      const isCur = idx === listIdx && uiFocus === "list";
                      return (
                        <div
                          key={node.id}
                          onClick={() => {
                            selectNode(node.id);
                            setListIdx(idx);
                            setUIFocus("editor");
                          }}
                          className={`px-3 py-2 cursor-pointer transition-all duration-75 border-l-[3px] ${
                            isActive
                              ? "bg-[#161b22] border-l-[#8b5cf6]"
                              : isCur
                              ? "bg-[#7ee787]/10 border-l-[#7ee787]"
                              : "border-l-transparent hover:bg-[#161b22]/30"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className="w-[5px] h-[5px] rounded-full flex-shrink-0"
                              style={{ backgroundColor: getNodeColor(node) }}
                            />
                            <span
                              className={`text-[12px] font-mono truncate ${
                                isActive
                                  ? "text-[#e6edf3]"
                                  : isCur
                                  ? "text-[#e6edf3]"
                                  : "text-[#c9d1d9]"
                              }`}
                            >
                              {node.title}
                            </span>
                            {isCur && (
                              <span className="text-[9px] text-[#7ee787] font-mono ml-auto flex-shrink-0">
                                ▸
                              </span>
                            )}
                          </div>
                          {!selectedNodeId && node.content && (
                            <p className="text-[11px] text-[#7d8590] mt-0.5 ml-[13px] truncate font-mono">
                              {node.content.slice(0, 80)}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Editor */}
            {selectedNodeId && selectedNode && (
              <div className="flex-1 h-full flex flex-col overflow-hidden bg-[#0b0e14] relative">
                {/* Focus indicator */}
                {uiFocus === "editor" && !showLinker && (
                  <div
                    className="absolute top-0 left-0 right-0 h-[2px] z-10"
                    style={{ backgroundColor: modeColor }}
                  />
                )}
                {allConns.length > 0 && (
                  <div className="flex-shrink-0 border-b border-[#21262d] px-3 py-1.5 flex flex-wrap gap-1.5 bg-[#0d1117]">
                    {allConns.map((c) => {
                      const tid = c.dir === "out" ? c.toNodeId : c.fromNodeId;
                      return (
                        <span
                          key={c.id}
                          className="inline-flex items-center gap-1 bg-[#161b22] px-2 py-0.5 rounded text-[10px] font-mono border border-[#21262d] group"
                        >
                          <span
                            className="w-[4px] h-[4px] rounded-full"
                            style={{
                              backgroundColor:
                                EDGE_COLORS_BRIGHT[c.type] || "#7d8590",
                            }}
                          />
                          <span
                            className="text-[#c9d1d9] cursor-pointer hover:text-[#e6edf3]"
                            onClick={() => {
                              saveDoc();
                              selectNode(tid);
                              setUIFocus("editor");
                            }}
                          >
                            {getNodeTitle(tid)}
                          </span>
                          <button
                            onClick={() => deleteEdge.mutate({ id: c.id })}
                            className="text-[#7d8590] hover:text-[#f85149] opacity-0 group-hover:opacity-100"
                          >
                            ×
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
                <div
                  className="flex-1 overflow-y-auto custom-scrollbar py-3"
                  tabIndex={-1}
                  onClick={() => {
                    if (uiFocus !== "editor") setUIFocus("editor");
                  }}
                >
                  <div className="max-w-3xl">
                    {lines.map((l, i) => renderEditorLine(l, i))}
                    <div className="h-48" />
                  </div>
                  {bracketSugs.length > 0 && vimMode === "INSERT" && (
                    <div
                      className="fixed z-50 bg-[#161b22] border border-[#30363d] rounded shadow-2xl overflow-hidden max-w-[280px]"
                      style={{
                        left: `${60 + cursor.col * 8.4}px`,
                        top: `${80 + (cursor.line + 1) * 22}px`,
                      }}
                    >
                      {bracketSugs.map((s, i) => (
                        <button
                          key={s.id}
                          onClick={() => insertBracketLink(s)}
                          className={`w-full text-left px-3 py-1.5 text-[12px] font-mono ${
                            i === bracketIdx
                              ? "bg-[#da3633]/15 text-[#e6edf3]"
                              : "text-[#c9d1d9] hover:bg-[#21262d]"
                          }`}
                        >
                          {s.title}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 h-full relative">
            <GraphView
              nodes={nodes || []}
              onNodeClick={(id: string) => onGraphClick(id)}
              onNodeHover={onGraphHover}
              onEmptyDoubleClick={() => {}}
              isLinkMode={false}
              linkFromNodeId={null}
              onLinkTargetClick={() => {}}
            />
            {hoverNode && (
              <div
                className="fixed bg-[#161b22]/95 backdrop-blur border border-[#30363d] rounded-lg shadow-2xl p-3 w-[300px] pointer-events-none z-40"
                style={{
                  left: `${Math.min(
                    hoverPos.x + 16,
                    window.innerWidth - 330
                  )}px`,
                  top: `${Math.min(
                    hoverPos.y + 16,
                    window.innerHeight - 140
                  )}px`,
                }}
              >
                <span
                  className="w-[6px] h-[6px] rounded-full inline-block mr-2"
                  style={{ backgroundColor: getNodeColor(hoverNode) }}
                />
                <span className="text-[13px] font-mono font-bold text-[#e6edf3]">
                  {hoverNode.title}
                </span>
                {hoverNode.content && (
                  <p className="text-[11px] text-[#c9d1d9] font-mono line-clamp-3 mt-1">
                    {hoverNode.content}
                  </p>
                )}
              </div>
            )}
            <div className="absolute bottom-4 left-4 bg-[#0b0e14]/90 border border-[#21262d] rounded p-2.5 text-[11px] font-mono space-y-1">
              {Object.entries(EDGE_COLORS_BRIGHT).map(([t, c]) => (
                <div key={t} className="flex items-center gap-2">
                  <span
                    className="w-4 h-0.5 rounded"
                    style={{ backgroundColor: c }}
                  />
                  <span className="text-[#c9d1d9]">{t}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ━━ LINKER ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {showLinker && selectedNode && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowLinker(false);
          }}
        >
          <div className="absolute inset-0 bg-[#010409]/70 backdrop-blur-[3px]" />

          {/* ★ Floating tree — big, glassmorphism, prominent */}
          <div className="relative z-10 mb-4 w-full max-w-2xl">
            <div className="bg-[#0d1117]/90 backdrop-blur-2xl border border-[#30363d]/40 rounded-2xl px-6 py-5 shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-2 h-2 rounded-full bg-[#8b5cf6]" />
                <span className="text-[12px] text-[#8b949e] font-mono uppercase tracking-widest">
                  Tree Preview
                </span>
              </div>
              {treeLines.length > 0 ? (
                <div className="space-y-[3px]">
                  {treeLines.map((tl, i) => {
                    const gc = tl.ghostEdgeType
                      ? EDGE_COLORS_BRIGHT[tl.ghostEdgeType] ||
                        EDGE_COLORS_BRIGHT.parent
                      : undefined;
                    return (
                      <div
                        key={i}
                        className={`flex items-center font-mono text-[14px] leading-[26px] transition-all duration-150 ${
                          tl.isGhost ? "opacity-70" : ""
                        }`}
                        style={{ paddingLeft: `${tl.indent * 26}px` }}
                      >
                        <span
                          className="mr-2.5 flex-shrink-0 text-[13px]"
                          style={{
                            color: tl.edgeType
                              ? EDGE_COLORS_BRIGHT[tl.edgeType]
                              : gc || "#6e7681",
                          }}
                        >
                          {tl.connector}
                        </span>
                        <span
                          className={
                            tl.isGhost
                              ? "px-2.5 py-1 rounded-md border border-dashed text-[13px]"
                              : tl.isCurrent
                              ? "text-[#e6edf3] font-bold bg-[#010409] px-2.5 py-1 rounded-md ring-1 ring-[#8b5cf6]/40"
                              : "text-[#e6edf3] py-1"
                          }
                          style={
                            tl.isGhost
                              ? { color: gc, borderColor: gc }
                              : undefined
                          }
                        >
                          {tl.label}
                          {tl.isGhost && (
                            <span className="ml-2 text-[11px] opacity-50">
                              ← new
                            </span>
                          )}
                          {tl.isCurrent && (
                            <span className="ml-2 text-[10px] text-[#8b5cf6] opacity-60">
                              current
                            </span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-[14px] text-[#6e7681] font-mono">
                  Isolated node — no connections yet
                </p>
              )}
            </div>
          </div>

          {/* ★ Main popup — cleaner, bigger text */}
          <div className="relative z-10 bg-[#0d1117] border border-[#30363d]/60 rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.5)] w-full max-w-2xl max-h-[50vh] flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-[#21262d]">
              <div className="flex items-center gap-2.5">
                <span className="text-[#8b5cf6] text-[15px]">◆</span>
                <span className="text-[15px] font-mono font-bold text-[#e6edf3]">
                  {selectedNode.title}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-[#6e7681] font-mono">
                  Esc close · ? help
                </span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar">
              {/* Connections */}
              {allConns.length > 0 && (
                <div
                  className={`px-5 py-3 border-b border-[#21262d] transition-colors ${
                    linkerFocus === "conns" ? "bg-[#030202]/60" : ""
                  }`}
                >
                  {sectionIndicator("conns", "Connections")}
                  <div className="space-y-1">
                    {allConns.map((c, idx) => {
                      const tid = c.dir === "out" ? c.toNodeId : c.fromNodeId;
                      const focused =
                        linkerFocus === "conns" && connIdx === idx;
                      return (
                        <div
                          key={c.id}
                          className={`flex items-center gap-2.5 text-[13px] font-mono px-3 py-2 rounded-lg transition-all duration-75 ${
                            focused
                              ? "bg-[#0d1117] ring-1 ring-[#f85149]/40"
                              : "hover:bg-[#030202]/50"
                          }`}
                        >
                          <span
                            className="w-[6px] h-[6px] rounded-full flex-shrink-0"
                            style={{
                              backgroundColor:
                                EDGE_COLORS_BRIGHT[c.type] || "#7d8590",
                            }}
                          />
                          <span className="text-[#8b949e] text-[12px] w-[60px] flex-shrink-0">
                            {c.type}
                          </span>
                          <span className="text-[#e6edf3] truncate flex-1">
                            {getNodeTitle(tid)}
                          </span>
                          {focused && (
                            <span className="text-[11px] text-[#f85149] flex-shrink-0 font-medium">
                              d:unlink
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Type selector */}
              <div
                className={`px-5 py-3 border-b border-[#21262d] transition-colors ${
                  linkerFocus === "type" ? "bg-[#030202]/60" : ""
                }`}
              >
                {sectionIndicator("type", "Link Type")}
                <div className="flex gap-2">
                  {LINK_TYPES.map((lt, idx) => (
                    <button
                      key={lt.type}
                      onClick={() => setLinkTypeIdx(idx)}
                      className={`flex-1 py-2.5 rounded-lg text-[13px] font-mono font-medium transition-all duration-75 flex flex-col items-center gap-1 border ${
                        linkTypeIdx === idx
                          ? "text-[#e6edf3] font-bold"
                          : "text-[#8b949e] hover:text-[#c9d1d9] bg-[#0b0e14] border-[#21262d]"
                      }`}
                      style={
                        linkTypeIdx === idx
                          ? {
                              backgroundColor: lt.color + "25",
                              borderColor: lt.color + "80",
                            }
                          : undefined
                      }
                    >
                      <span className="text-[16px]">{lt.icon}</span>
                      <span>{lt.label}</span>
                    </button>
                  ))}
                </div>
                {linkerFocus === "type" && (
                  <p className="text-[11px] text-[#8b949e] font-mono mt-2 text-center">
                    ← h / l → change type · ↓ j candidates · ↑ k connections
                  </p>
                )}
              </div>

              {/* Candidates */}
              <div
                className={`px-5 py-3 transition-colors ${
                  linkerFocus === "candidates" || linkerFocus === "filter"
                    ? "bg-[#030202]/60"
                    : ""
                }`}
              >
                {sectionIndicator("candidates", "Candidates")}
                <div className="mb-2.5">
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[12px] text-[#8b949e] font-mono">
                      f/
                    </span>
                    <input
                      ref={linkSearchRef}
                      type="text"
                      value={linkSearch}
                      onChange={(e) => {
                        setLinkSearch(e.target.value);
                        setLinkCandIdx(0);
                      }}
                      onFocus={() => setLinkerFocus("filter")}
                      placeholder="filter nodes…"
                      className={`w-full pl-8 pr-3 py-2 bg-[#010409] border rounded-lg text-[13px] font-mono text-[#e6edf3] placeholder-[#6e7681] focus:outline-none transition-colors ${
                        linkerFocus === "filter"
                          ? "border-[#8b5cf6]/50"
                          : "border-[#21262d]"
                      }`}
                    />
                  </div>
                </div>
                <div className="space-y-1 max-h-[200px] overflow-y-auto custom-scrollbar">
                  {linkCandidates.map((c, idx) => {
                    const focused =
                      linkerFocus === "candidates" && linkCandIdx === idx;
                    return (
                      <button
                        key={c.id}
                        onClick={() => validateAndLink(c.id)}
                        className={`w-full text-left px-3 py-2.5 rounded-lg text-[13px] font-mono flex items-center gap-2.5 transition-all duration-75 ${
                          focused
                            ? "bg-[#21262d] text-[#e6edf3] ring-1 ring-[#8b5cf6]/30"
                            : "text-[#c9d1d9] hover:bg-[#030202]/50"
                        }`}
                      >
                        <span
                          className="w-[6px] h-[6px] rounded-full flex-shrink-0"
                          style={{ backgroundColor: getNodeColor(c) }}
                        />
                        <span className="truncate flex-1">{c.title}</span>
                        {focused && (
                          <span className="text-[11px] text-[#8b949e] flex-shrink-0">
                            ⏎ link
                          </span>
                        )}
                      </button>
                    );
                  })}
                  {linkCandidates.length === 0 && (
                    <p className="text-[13px] text-[#6e7681] font-mono text-center py-5">
                      {linkSearch ? "no matches" : "no candidates"}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ━━ CREATE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {isCreating && (
        <div className="fixed inset-0 z-50 bg-[#0b0e14]/80 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-[#0d1117] border border-[#21262d] rounded-lg shadow-2xl w-full max-w-sm p-4 space-y-3">
            <h2 className="text-[14px] font-mono font-bold text-[#e6edf3]">
              New node
            </h2>
            <input
              ref={newTitleRef}
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newTitle.trim())
                  createNode.mutate({ title: newTitle.trim(), content: "" });
                if (e.key === "Escape") {
                  setIsCreating(false);
                  setNewTitle("");
                }
              }}
              placeholder="title"
              autoFocus
              className="w-full px-3 py-2 bg-[#0b0e14] border border-[#30363d] rounded text-[14px] font-mono text-[#e6edf3] placeholder-[#6e7681] focus:border-[#8b5cf6]/40 focus:outline-none"
            />
            <div className="flex gap-2">
              <button
                onClick={() => {
                  if (newTitle.trim())
                    createNode.mutate({ title: newTitle.trim(), content: "" });
                }}
                disabled={!newTitle.trim()}
                className="flex-1 bg-[#8b5cf6] hover:bg-[#7c3aed] text-white py-1.5 rounded text-[12px] font-mono font-medium disabled:opacity-25"
              >
                create
              </button>
              <button
                onClick={() => {
                  setIsCreating(false);
                  setNewTitle("");
                }}
                className="px-3 py-1.5 bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] rounded text-[12px] font-mono"
              >
                cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ━━ HELP ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {showHelp && (
        <div
          className="fixed inset-0 z-50 bg-[#0b0e14]/80 backdrop-blur-sm flex items-center justify-center"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowHelp(false);
          }}
        >
          <div className="bg-[#0d1117] border border-[#21262d] rounded-lg shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-[#21262d]">
              <span className="text-[15px] font-mono font-bold text-[#e6edf3]">
                Keyboard Shortcuts
              </span>
              <button
                onClick={() => setShowHelp(false)}
                className="text-[#7d8590] hover:text-[#e6edf3] text-[16px] transition-colors"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-5">
              <div className="grid grid-cols-2 gap-6">
                {HELP_SECTIONS.map((sec) => (
                  <div key={sec.title}>
                    <h3 className="text-[13px] font-mono font-bold text-[#8b5cf6] mb-2 uppercase tracking-wider">
                      {sec.title}
                    </h3>
                    <div className="space-y-1.5">
                      {sec.items.map(([key, desc]) => (
                        <div key={key} className="flex items-baseline gap-3">
                          <kbd className="text-[11px] font-mono text-[#e6edf3] bg-[#161b22] border border-[#30363d] px-1.5 py-0.5 rounded min-w-[60px] text-center flex-shrink-0">
                            {key}
                          </kbd>
                          <span className="text-[12px] text-[#c9d1d9] font-mono">
                            {desc}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-[#6e7681] font-mono mt-6 text-center">
                Press ? or Esc to close
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ━━ STATUS BAR ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="h-[32px] bg-[#0d1117] border-t border-[#21262d] flex-shrink-0 flex items-center px-4 gap-3">
        <span
          className="font-bold px-2 py-0.5 rounded text-[11px] font-mono"
          style={{
            backgroundColor: `${showLinker ? "#8b5cf6" : modeColor}20`,
            color: showLinker ? "#8b5cf6" : modeColor,
          }}
        >
          {showLinker ? "LINK" : vimMode}
        </span>
        <span className="text-[#21262d]">│</span>
        <span className="text-[12px] text-[#8b949e] font-mono flex-1">
          {showLinker &&
            linkerFocus === "filter" &&
            "Type to filter · Esc → back · Enter → candidates"}
          {showLinker &&
            linkerFocus === "conns" &&
            "j↓ k↑ navigate · d delete · Enter goto · ↓ type selector"}
          {showLinker &&
            linkerFocus === "type" &&
            "h← l→ change type · j↓ candidates · k↑ connections · f filter"}
          {showLinker &&
            linkerFocus === "candidates" &&
            "j↓ k↑ navigate · Enter or Space to link · k↑ back to type"}
          {!showLinker &&
            uiFocus === "list" &&
            "j↓ k↑ navigate · l Enter open · n new · dd delete · / search · g graph · ? help"}
          {!showLinker &&
            uiFocus === "editor" &&
            vimMode === "NORMAL" &&
            (pendingKey
              ? `${pendingKey}…`
              : "Space link · g graph · q close · / search · ? help")}
          {!showLinker &&
            uiFocus === "editor" &&
            vimMode === "INSERT" &&
            "Typing · ←→↑↓ move · [[ link · Esc → NORMAL"}
          {!showLinker &&
            uiFocus === "editor" &&
            vimMode === "VISUAL" &&
            "hjkl select · d delete · y yank · c change · Esc cancel"}
        </span>
        {statusMsg && (
          <span className="text-[12px] text-[#d29922] font-mono font-medium">
            {statusMsg}
          </span>
        )}
        {!statusMsg && uiFocus === "editor" && !showLinker && (
          <span className="text-[12px] text-[#6e7681] font-mono">
            {cursor.line + 1}:{cursor.col + 1}
          </span>
        )}
        <button
          onClick={() => setShowHelp(true)}
          className="text-[12px] text-[#6e7681] hover:text-[#c9d1d9] font-mono font-bold transition-colors"
          title="Shortcuts (?)"
        >
          ?
        </button>
      </div>
    </div>
  );
}
