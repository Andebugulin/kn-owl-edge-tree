"use client";

import { trpc } from "@/lib/trpc";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { signOut, useSession } from "next-auth/react";
import dynamic from "next/dynamic";

import type {
  Node,
  VimMode,
  UIFocus,
  LinkerFocus,
  Pos,
  DocSnapshot,
  VimCtx,
} from "@/lib/editor/types";
import {
  LINK_TYPES,
  EDGE_COLORS_BRIGHT,
  HELP_SECTIONS,
} from "@/lib/editor/constants";
import {
  getNodeColor,
  wouldCreateCircle,
  clampCol,
  posMin,
  posMax,
  nextWord,
  endOfWord,
  prevWord,
  nextWORD,
  endOfWORD,
  prevWORD,
  findChar,
  findMatchingBracket,
  findMatchingPair,
  prevParagraph,
  nextParagraph,
  getBracketCtx,
  buildDoc,
  extractDoc,
} from "@/lib/editor/helpers";
import { renderFmt } from "@/lib/editor/markdownRenderer";
import { buildTreeWithPreview } from "@/lib/editor/treeBuilder";
import {
  insertChar,
  deleteLine,
  deleteToEOL,
  changeLine,
  deleteWord,
  changeWord,
  joinLines,
  replaceChar,
  toggleCase,
  substituteChar,
  deleteInsidePair,
  changeInsidePair,
  deleteAroundPair,
  changeAroundPair,
  yankInsidePair,
  deleteInnerWord,
  deleteAWord,
  changeInnerWord,
  changeAWord,
  yankInnerWord,
  yankAWord,
  indentLine,
  outdentLine,
  indentLines,
  outdentLines,
  deleteSelection,
  yankSelection,
  deleteLineSelection,
  yankLineSelection,
  changeLineSelection,
  pasteAfter,
  pasteBefore,
  isSelected,
  isLineSelected,
  deleteNLines,
  yankNLines,
  changeNLines,
  deleteNWords,
  changeNWords,
  deleteNChars,
  selectAll,
} from "@/lib/editor/vimActions";

const GraphView = dynamic(() => import("@/components/GraphView"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-[var(--bg-primary)] text-[var(--text-faint)]">
      Loading…
    </div>
  ),
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export default function Dashboard() {
  const { data: session } = useSession();
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    if (typeof window !== "undefined")
      return (localStorage.getItem("kt-theme") as "dark" | "light") || "dark";
    return "dark";
  });
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("kt-theme", theme);
  }, [theme]);

  const [view, setView] = useState<"notes" | "graph">("notes");
  const [uiFocus, setUIFocus] = useState<UIFocus>("list");
  const [listIdx, setListIdx] = useState(0);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [vimMode, setVimMode] = useState<VimMode>("NORMAL");
  const [lines, setLines] = useState<string[]>([]);
  const [cursor, setCursor] = useState<Pos>({ line: 0, col: 0 });
  const [visualAnchor, setVisualAnchor] = useState<Pos | null>(null);
  const [visualLineAnchor, setVisualLineAnchor] = useState<number | null>(null);
  const [yankReg, setYankReg] = useState("");
  const [yankIsLine, setYankIsLine] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [countStr, setCountStr] = useState("");
  const desiredCol = useRef(0);
  const [undoStack, setUndoStack] = useState<DocSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<DocSnapshot[]>([]);

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
  }, []);

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

  // ━━━ Sidebar collapse + scroll ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const listItemRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // ★ VimCtx — shared context for all vim operations
  const vimCtx: VimCtx = useMemo(
    () => ({
      linesRef,
      cursorRef,
      desiredCol,
      setLines,
      setCursor,
      setVimMode,
      setYankReg,
      setYankIsLine,
      setVisualAnchor,
      setVisualLineAnchor,
      pushUndo,
      flash,
    }),
    [pushUndo, flash]
  );

  // ━━━ tRPC ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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

  // ━━━ Derived ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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

  // Special nodes (ref/example/contradiction) appear right after their parent node
  // ★ Tree-sorted flat list with tree-command prefixes and collapse support
  const treeSorted = useMemo((): Array<{
    node: Node;
    depth: number;
    specialType?: string;
    prefix: string;
    hasChildren: boolean;
    isRoot: boolean;
  }> => {
    if (!nodes) return [];

    // Build parent→children map
    const childrenOf = new Map<string, string[]>();
    const childSet = new Set<string>();
    const specialNodeIds = new Set<string>();
    nodes.forEach((n) => {
      n.edgesFrom.forEach((e) => {
        if (e.type === "parent") {
          childSet.add(e.toNodeId);
          const arr = childrenOf.get(n.id) || [];
          arr.push(e.toNodeId);
          childrenOf.set(n.id, arr);
        } else {
          specialNodeIds.add(e.toNodeId);
        }
      });
    });

    const result: Array<{
      node: Node;
      depth: number;
      specialType?: string;
      prefix: string;
      hasChildren: boolean;
      isRoot: boolean;
    }> = [];
    const visited = new Set<string>();

    // Build tree-command style prefix from ancestor flags
    const mkPrefix = (
      ancestors: boolean[],
      isLast: boolean,
      isRoot: boolean
    ): string => {
      if (isRoot) return "";
      let p = "";
      for (const hasMore of ancestors) p += hasMore ? "│  " : "   ";
      return p + (isLast ? "└─ " : "├─ ");
    };

    const visit = (
      id: string,
      d: number,
      ancestors: boolean[],
      isLast: boolean,
      isRoot: boolean
    ) => {
      if (visited.has(id)) return;
      visited.add(id);
      const n = nodes.find((x) => x.id === id);
      if (!n) return;

      const children = childrenOf.get(id) || [];
      const specials = n.edgesFrom.filter((e) => e.type !== "parent");
      const hasChildren = children.length > 0 || specials.length > 0;

      result.push({
        node: n,
        depth: d,
        prefix: mkPrefix(ancestors, isLast, isRoot),
        hasChildren,
        isRoot,
      });

      // If collapsed, skip all children
      if (hasChildren && !expanded.has(id)) return;

      // Collect all child items: specials first, then tree children
      const nextAncestors = isRoot ? [] : [...ancestors, !isLast];
      const allItems: Array<{
        id: string;
        isSpecial: boolean;
        type?: string;
      }> = [];
      specials.forEach((e) =>
        allItems.push({ id: e.toNodeId, isSpecial: true, type: e.type })
      );
      children.forEach((cid) => allItems.push({ id: cid, isSpecial: false }));

      allItems.forEach((item, i) => {
        const last = i === allItems.length - 1;
        if (item.isSpecial) {
          if (visited.has(item.id)) return;
          visited.add(item.id);
          const sn = nodes.find((x) => x.id === item.id);
          if (!sn) return;
          result.push({
            node: sn,
            depth: d + 1,
            specialType: item.type,
            prefix: mkPrefix(nextAncestors, last, false),
            hasChildren: false,
            isRoot: false,
          });
        } else {
          visit(item.id, d + 1, nextAncestors, last, false);
        }
      });
    };

    // Roots with children, then orphans
    const roots = nodes
      .filter(
        (n) =>
          !childSet.has(n.id) &&
          !specialNodeIds.has(n.id) &&
          childrenOf.has(n.id)
      )
      .sort((a, b) => a.title.localeCompare(b.title));
    const orphans = nodes
      .filter(
        (n) =>
          !childSet.has(n.id) &&
          !specialNodeIds.has(n.id) &&
          !childrenOf.has(n.id)
      )
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

    const allRoots = [...roots, ...orphans];
    allRoots.forEach((n, i) => {
      visit(n.id, 0, [], i === allRoots.length - 1, true);
    });

    // Safety net — only truly orphaned nodes, not children hidden by collapse
    nodes.forEach((n) => {
      if (
        !visited.has(n.id) &&
        !childSet.has(n.id) &&
        !specialNodeIds.has(n.id)
      ) {
        visit(n.id, 0, [], true, true);
      }
    });

    return result;
  }, [nodes, expanded]);

  // Auto-scroll sidebar to keep cursor visible
  useEffect(() => {
    const el = listItemRefs.current.get(listIdx);
    if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [listIdx]);

  const linkCandidates = useMemo(() => {
    if (!selectedNodeId || !nodes) return [];
    const src = nodes.find((n) => n.id === selectedNodeId);
    if (!src) return [];
    const linked = new Set([
      ...src.edgesFrom.map((e) => e.toNodeId),
      ...src.edgesTo.map((e) => e.fromNodeId),
    ]);
    const lt = LINK_TYPES[linkTypeIdx].type;
    const srcHasParent = src.edgesTo.some((e) => e.type === "parent");
    const srcIsSpecial = src.edgesTo.some((e) =>
      ["reference", "example", "contradiction"].includes(e.type)
    );
    const srcIsolated = src.edgesFrom.length === 0 && src.edgesTo.length === 0;
    let c = nodes.filter((n) => {
      if (n.id === selectedNodeId || linked.has(n.id)) return false;
      const tgtIsSpecial = n.edgesTo.some((e) =>
        ["reference", "example", "contradiction"].includes(e.type)
      );
      if (lt === "parent" || lt === "child") {
        // Special nodes are locked — no parent/child allowed
        if (srcIsSpecial || tgtIsSpecial) return false;
        if (lt === "parent") {
          if (srcHasParent) return false;
          if (wouldCreateCircle(n.id, selectedNodeId, nodes)) return false;
        } else {
          if (n.edgesTo.some((e) => e.type === "parent")) return false;
          if (wouldCreateCircle(selectedNodeId, n.id, nodes)) return false;
        }
      } else {
        // reference/example/contradiction: exactly one must be isolated
        const tgtIsolated = n.edgesFrom.length === 0 && n.edgesTo.length === 0;
        if (srcIsolated && tgtIsolated) return false;
        if (!srcIsolated && !tgtIsolated) return false;
      }
      return true;
    });
    if (linkSearch) {
      const q = linkSearch.toLowerCase();
      c = c.filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          n.content.toLowerCase().includes(q)
      );
    }
    return c.slice(0, 30);
  }, [selectedNodeId, nodes, linkSearch, linkTypeIdx]);
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

  const saveDoc = useCallback(() => {
    if (!selectedNodeId || linesRef.current.length === 0) return;
    const { title, content } = extractDoc(linesRef.current);
    updateNode.mutate({ id: selectedNodeId, title, content });
  }, [selectedNodeId, updateNode]);

  // Walk up parent edges to find all ancestors of a node
  const expandAncestors = useCallback(
    (nodeId: string) => {
      if (!nodes) return;
      const toExpand: string[] = [];
      const visited = new Set<string>();
      let current = nodeId;
      while (true) {
        if (visited.has(current)) break;
        visited.add(current);
        const node = nodes.find((n) => n.id === current);
        if (!node) break;
        const parentEdge = node.edgesTo.find((e) => e.type === "parent");
        if (!parentEdge) break;
        toExpand.push(parentEdge.fromNodeId);
        current = parentEdge.fromNodeId;
      }
      if (toExpand.length > 0) {
        setExpanded((s) => {
          const next = new Set(s);
          toExpand.forEach((id) => next.add(id));
          return next;
        });
      }
    },
    [nodes]
  );

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
      expandAncestors(nodeId);
      const node = nodes?.find((n) => n.id === nodeId);
      if (!node) return;
      setSelectedNodeId(nodeId);
      setLines(buildDoc(node.title, node.content));
      setCursor({ line: 0, col: 0 });
      desiredCol.current = 0;
      setVimMode("NORMAL");
      setVisualAnchor(null);
      setVisualLineAnchor(null);
      setUndoStack([]);
      setRedoStack([]);
      const idx = treeSorted.findIndex((s) => s.node.id === nodeId);
      if (idx >= 0) setListIdx(idx);
    },
    [nodes, treeSorted, selectedNodeId, updateNode, expandAncestors]
  );

  const validateAndLink = useCallback(
    (targetId: string) => {
      if (!selectedNodeId || !nodes) return;
      const src = nodes.find((n) => n.id === selectedNodeId)!,
        tgt = nodes.find((n) => n.id === targetId)!;
      if (!src || !tgt) return;
      const lt = LINK_TYPES[linkTypeIdx].type;
      const srcIsSpecial = src.edgesTo.some((e) =>
        ["reference", "example", "contradiction"].includes(e.type)
      );
      const tgtIsSpecial = tgt.edgesTo.some((e) =>
        ["reference", "example", "contradiction"].includes(e.type)
      );
      let from = selectedNodeId,
        to = targetId,
        et: string = lt;
      if (lt === "parent" || lt === "child") {
        if (srcIsSpecial || tgtIsSpecial) {
          flash("Special nodes can't have parent/child");
          return;
        }
        if (lt === "parent") {
          if (src.edgesTo.some((e) => e.type === "parent")) {
            flash("Already has a parent");
            return;
          }
          if (wouldCreateCircle(targetId, selectedNodeId, nodes)) {
            flash("Would create cycle");
            return;
          }
          from = targetId;
          to = selectedNodeId;
          et = "parent";
        } else {
          if (tgt.edgesTo.some((e) => e.type === "parent")) {
            flash("Target already has a parent");
            return;
          }
          if (wouldCreateCircle(selectedNodeId, targetId, nodes)) {
            flash("Would create cycle");
            return;
          }
          from = selectedNodeId;
          to = targetId;
          et = "parent";
        }
      } else {
        const srcIsolated =
          src.edgesFrom.length === 0 && src.edgesTo.length === 0;
        const tgtIsolated =
          tgt.edgesFrom.length === 0 && tgt.edgesTo.length === 0;
        if (!srcIsolated && !tgtIsolated) {
          flash("One node must be isolated");
          return;
        }
        if (srcIsolated && tgtIsolated) {
          flash("One node must be in a tree");
          return;
        }
        if (srcIsolated) {
          from = targetId;
          to = selectedNodeId;
        } else {
          from = selectedNodeId;
          to = targetId;
        }
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

  // ★ Local helpers
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

  // ━━━ KEYBOARD HANDLER ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      // Ignore modifier-only keypresses — prevents Shift from clearing pending state (fixes d$, dW, d{, etc.)
      if (["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(e.key))
        return;
      if ((e.metaKey || e.ctrlKey) && e.key === "v" && vimMode === "INSERT")
        return; // let browser handle in INSERT
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        saveDoc();
        return;
      }
      // Ctrl+Z undo (works in all modes)
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        doUndo();
        return;
      }
      // Ctrl+A select all (works in editor)
      if ((e.ctrlKey || e.metaKey) && e.key === "a" && uiFocus === "editor") {
        e.preventDefault();
        selectAll(vimCtx);
        return;
      }
      // Ctrl+C copy to system clipboard (works in all editor modes)
      if ((e.ctrlKey || e.metaKey) && e.key === "c" && uiFocus === "editor") {
        e.preventDefault();
        const cur = cursorRef.current;
        const cl = linesRef.current;
        let text = "";
        if (vimMode === "VISUAL_LINE") {
          const sL = Math.min(visualLineAnchor ?? cur.line, cur.line),
            eL = Math.max(visualLineAnchor ?? cur.line, cur.line);
          text = cl.slice(sL, eL + 1).join("\n");
          setYankReg(text);
          setYankIsLine(true);
          setVimMode("NORMAL");
          setVisualLineAnchor(null);
          flash("Copied " + (eL - sL + 1) + " lines");
        } else if (vimMode === "VISUAL" && visualAnchor) {
          const s = posMin(visualAnchor, cur),
            ep = posMax(visualAnchor, cur);
          if (s.line === ep.line) text = cl[s.line].slice(s.col, ep.col + 1);
          else {
            const ch = [cl[s.line].slice(s.col)];
            for (let i = s.line + 1; i < ep.line; i++) ch.push(cl[i]);
            ch.push(cl[ep.line].slice(0, ep.col + 1));
            text = ch.join("\n");
          }
          setYankReg(text);
          setYankIsLine(false);
          setVimMode("NORMAL");
          setVisualAnchor(null);
          flash("Copied");
        } else {
          text = cl[cur.line] || "";
          setYankReg(text);
          setYankIsLine(true);
          flash("Copied line");
        }
        navigator.clipboard.writeText(text).catch(() => {});
        return;
      }
      // Ctrl+V paste from clipboard in NORMAL/VISUAL modes
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key === "v" &&
        uiFocus === "editor" &&
        vimMode !== "INSERT"
      ) {
        e.preventDefault();
        navigator.clipboard
          .readText()
          .then((text) => {
            if (!text) return;
            pushUndo();
            const cur = cursorRef.current;
            const hasNewline = text.includes("\n");
            if (hasNewline) {
              const pasteLines = text.split("\n");
              setLines((p) => {
                const nl = [...p];
                nl.splice(cur.line + 1, 0, ...pasteLines);
                return nl;
              });
              setCursor({ line: cur.line + 1, col: 0 });
            } else {
              setLines((p) => {
                const nl = [...p];
                nl[cur.line] =
                  nl[cur.line].slice(0, cur.col + 1) +
                  text +
                  nl[cur.line].slice(cur.col + 1);
                return nl;
              });
              setCursor({ ...cur, col: cur.col + text.length });
            }
          })
          .catch(() => {});
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
        if (vimMode === "VISUAL" || vimMode === "VISUAL_LINE") {
          setVimMode("NORMAL");
          setVisualAnchor(null);
          setVisualLineAnchor(null);
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
        setCountStr("");
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
        if (pendingKey === "d" && e.key === "d") {
          e.preventDefault();
          setPendingKey(null);
          const item = treeSorted[listIdx];
          if (
            item &&
            confirm(`Delete "${item.node.title}" and all its connections?`)
          ) {
            deleteNode.mutate({ id: item.node.id });
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
        if (e.key === "j" || e.key === "ArrowDown") {
          e.preventDefault();
          setListIdx((i) => Math.min(i + 1, treeSorted.length - 1));
          return;
        }
        if (e.key === "k" || e.key === "ArrowUp") {
          e.preventDefault();
          setListIdx((i) => Math.max(i - 1, 0));
          return;
        }
        if (e.key === "h" || e.key === "ArrowLeft") {
          e.preventDefault();
          const item = treeSorted[listIdx];
          if (item && item.hasChildren && expanded.has(item.node.id)) {
            setExpanded((s) => {
              const next = new Set(s);
              next.delete(item.node.id);
              return next;
            });
          }
          return;
        }
        if (e.key === "l" || e.key === "Enter" || e.key === "ArrowRight") {
          e.preventDefault();
          const item = treeSorted[listIdx];
          if (!item) return;
          if (item.hasChildren && !expanded.has(item.node.id)) {
            setExpanded((s) => new Set(s).add(item.node.id));
            return;
          }
          selectNode(item.node.id);
          setUIFocus("editor");
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

      // ★ INSERT
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
          insertChar(vimCtx, "  ");
          return;
        }
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
          e.preventDefault();
          insertChar(vimCtx, e.key);
          checkBracket();
          return;
        }
        return;
      }

      // ━━ VISUAL_LINE / VISUAL / NORMAL — shared count prefix ━━━━━━━━━━
      // Digits accumulate globally across all non-INSERT editor modes.
      // Count persists through pending states (e.g. d→5→j = delete 5 lines down).
      // "0" is a digit only when building a count (otherwise = go to line start).
      if (/^[1-9]$/.test(e.key) || (e.key === "0" && countStr !== "")) {
        e.preventDefault();
        setCountStr((c) => c + e.key);
        return;
      }

      // ━━ VISUAL_LINE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      if (vimMode === "VISUAL_LINE") {
        const cnt = parseInt(countStr) || 1;
        setCountStr("");
        const cur = cursorRef.current;
        const cl = linesRef.current;
        if (e.key === "j") {
          e.preventDefault();
          const nl = Math.min(cur.line + cnt, cl.length - 1);
          setCursor({
            line: nl,
            col: clampCol(cl, nl, desiredCol.current, false),
          });
          return;
        }
        if (e.key === "k") {
          e.preventDefault();
          const nl = Math.max(cur.line - cnt, 0);
          setCursor({
            line: nl,
            col: clampCol(cl, nl, desiredCol.current, false),
          });
          return;
        }
        if (e.key === "d" || e.key === "x") {
          e.preventDefault();
          deleteLineSelection(vimCtx, visualLineAnchor ?? cur.line, cur.line);
          return;
        }
        if (e.key === "y") {
          e.preventDefault();
          yankLineSelection(vimCtx, visualLineAnchor ?? cur.line, cur.line);
          return;
        }
        if (e.key === "c") {
          e.preventDefault();
          changeLineSelection(vimCtx, visualLineAnchor ?? cur.line, cur.line);
          return;
        }
        if (e.key === ">" || e.key === "<") {
          e.preventDefault();
          const s = Math.min(visualLineAnchor ?? cur.line, cur.line),
            en = Math.max(visualLineAnchor ?? cur.line, cur.line);
          if (e.key === ">") indentLines(vimCtx, s, en);
          else outdentLines(vimCtx, s, en);
          return;
        }
        if (e.key === "G") {
          e.preventDefault();
          setCursor({ line: cl.length - 1, col: 0 });
          return;
        }
        if (e.key === "v") {
          e.preventDefault();
          setVimMode("VISUAL");
          setVisualAnchor({ line: visualLineAnchor ?? cur.line, col: 0 });
          setVisualLineAnchor(null);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setVimMode("NORMAL");
          setVisualLineAnchor(null);
          return;
        }
        return;
      }

      // ━━ VISUAL (count-aware motions) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      if (vimMode === "VISUAL") {
        const cnt = parseInt(countStr) || 1;
        setCountStr("");
        const cur = cursorRef.current;
        const cl = linesRef.current;
        if (e.key === "h") {
          e.preventDefault();
          setCursor({ ...cur, col: Math.max(0, cur.col - cnt) });
          return;
        }
        if (e.key === "l") {
          e.preventDefault();
          setCursor({
            ...cur,
            col: Math.min(
              cur.col + cnt,
              Math.max(0, (cl[cur.line]?.length ?? 1) - 1)
            ),
          });
          return;
        }
        if (e.key === "j") {
          e.preventDefault();
          const nl = Math.min(cur.line + cnt, cl.length - 1);
          setCursor({
            line: nl,
            col: clampCol(cl, nl, desiredCol.current, false),
          });
          return;
        }
        if (e.key === "k") {
          e.preventDefault();
          const nl = Math.max(cur.line - cnt, 0);
          setCursor({
            line: nl,
            col: clampCol(cl, nl, desiredCol.current, false),
          });
          return;
        }
        if (e.key === "w") {
          e.preventDefault();
          let ln = cur.line,
            c = cur.col;
          for (let i = 0; i < cnt; i++) {
            const nc = nextWord(cl[ln] || "", c);
            if (nc >= (cl[ln]?.length ?? 0) && ln < cl.length - 1) {
              ln++;
              c = 0;
            } else c = Math.min(nc, Math.max(0, (cl[ln]?.length ?? 1) - 1));
          }
          setCursor({ line: ln, col: c });
          return;
        }
        if (e.key === "b") {
          e.preventDefault();
          let ln = cur.line,
            c = cur.col;
          for (let i = 0; i < cnt; i++) {
            const nc = prevWord(cl[ln] || "", c);
            if (nc === 0 && c === 0 && ln > 0) {
              ln--;
              c = Math.max(0, (cl[ln]?.length ?? 1) - 1);
            } else c = nc;
          }
          setCursor({ line: ln, col: c });
          return;
        }
        if (e.key === "e") {
          e.preventDefault();
          let c = cur.col;
          for (let i = 0; i < cnt; i++) c = endOfWord(cl[cur.line] || "", c);
          setCursor({ ...cur, col: c });
          return;
        }
        if (e.key === "W") {
          e.preventDefault();
          let ln = cur.line,
            c = cur.col;
          for (let i = 0; i < cnt; i++) {
            const nc = nextWORD(cl[ln] || "", c);
            if (nc >= (cl[ln]?.length ?? 0) && ln < cl.length - 1) {
              ln++;
              c = 0;
            } else c = Math.min(nc, Math.max(0, (cl[ln]?.length ?? 1) - 1));
          }
          setCursor({ line: ln, col: c });
          return;
        }
        if (e.key === "B") {
          e.preventDefault();
          let ln = cur.line,
            c = cur.col;
          for (let i = 0; i < cnt; i++) {
            const nc = prevWORD(cl[ln] || "", c);
            if (nc === 0 && c === 0 && ln > 0) {
              ln--;
              c = Math.max(0, (cl[ln]?.length ?? 1) - 1);
            } else c = nc;
          }
          setCursor({ line: ln, col: c });
          return;
        }
        if (e.key === "E") {
          e.preventDefault();
          let c = cur.col;
          for (let i = 0; i < cnt; i++) c = endOfWORD(cl[cur.line] || "", c);
          setCursor({ ...cur, col: c });
          return;
        }
        if (e.key === "{") {
          e.preventDefault();
          let ln = cur.line;
          for (let i = 0; i < cnt; i++) ln = prevParagraph(cl, ln);
          setCursor({ line: ln, col: 0 });
          return;
        }
        if (e.key === "}") {
          e.preventDefault();
          let ln = cur.line;
          for (let i = 0; i < cnt; i++) ln = nextParagraph(cl, ln);
          setCursor({ line: ln, col: 0 });
          return;
        }
        if (e.key === "G") {
          e.preventDefault();
          setCursor({
            line: cl.length - 1,
            col: (cl[cl.length - 1]?.length ?? 1) - 1,
          });
          return;
        }
        if (e.key === "$") {
          e.preventDefault();
          setCursor({
            ...cur,
            col: Math.max(0, (cl[cur.line]?.length ?? 1) - 1),
          });
          return;
        }
        if (e.key === "0") {
          e.preventDefault();
          setCursor({ ...cur, col: 0 });
          return;
        }
        if (e.key === "^") {
          e.preventDefault();
          const f = (cl[cur.line] || "").search(/\S/);
          setCursor({ ...cur, col: f >= 0 ? f : 0 });
          return;
        }
        if (e.key === "d" || e.key === "x") {
          e.preventDefault();
          if (visualAnchor) deleteSelection(vimCtx, visualAnchor);
          return;
        }
        if (e.key === "y") {
          e.preventDefault();
          if (visualAnchor) yankSelection(vimCtx, visualAnchor);
          return;
        }
        if (e.key === "c") {
          e.preventDefault();
          if (visualAnchor) {
            deleteSelection(vimCtx, visualAnchor);
            setVimMode("INSERT");
          }
          return;
        }
        if (e.key === "V") {
          e.preventDefault();
          setVimMode("VISUAL_LINE");
          setVisualLineAnchor(visualAnchor?.line ?? cursor.line);
          setVisualAnchor(null);
          return;
        }
        return;
      }

      // ━━ NORMAL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const cur = cursorRef.current;
      const cl = linesRef.current;

      // Pending key combos — count persists from before the operator OR from after it
      if (pendingKey) {
        e.preventDefault();
        const count = parseInt(countStr) || 1;
        setCountStr("");
        const combo = pendingKey + e.key;
        // 3-char text objects
        if (pendingKey.length === 2) {
          setPendingKey(null);
          const op = pendingKey[0],
            scope = pendingKey[1],
            ch = e.key;
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
          if (ch === "w") {
            if (scope === "i") {
              if (op === "d") deleteInnerWord(vimCtx);
              else if (op === "c") changeInnerWord(vimCtx);
              else if (op === "y") yankInnerWord(vimCtx);
            } else {
              if (op === "d") deleteAWord(vimCtx);
              else if (op === "c") changeAWord(vimCtx);
              else if (op === "y") yankAWord(vimCtx);
            }
            return;
          }
          const p = pairs[ch];
          if (p && scope === "i") {
            if (op === "c") changeInsidePair(vimCtx, p[0], p[1]);
            else if (op === "d") deleteInsidePair(vimCtx, p[0], p[1]);
            else if (op === "y") yankInsidePair(vimCtx, p[0], p[1]);
            return;
          }
          if (p && scope === "a") {
            if (op === "d") deleteAroundPair(vimCtx, p[0], p[1]);
            else if (op === "c") changeAroundPair(vimCtx, p[0], p[1]);
            return;
          }
          return;
        }
        // Operator + motion: d5j, d3w, y2k, c4w, etc.
        if (
          (pendingKey === "d" || pendingKey === "y" || pendingKey === "c") &&
          "hjklwbeWBE{}$^0".includes(e.key)
        ) {
          setPendingKey(null);
          // Compute motion target
          let tgtLine = cur.line,
            tgtCol = cur.col;
          if (e.key === "j")
            tgtLine = Math.min(cur.line + count, cl.length - 1);
          else if (e.key === "k") tgtLine = Math.max(cur.line - count, 0);
          else if (e.key === "h") tgtCol = Math.max(0, cur.col - count);
          else if (e.key === "l")
            tgtCol = Math.min(
              cur.col + count,
              Math.max(0, (cl[cur.line]?.length ?? 1) - 1)
            );
          else if (e.key === "w" || e.key === "W") {
            let ln = cur.line,
              c = cur.col;
            const fn = e.key === "w" ? nextWord : nextWORD;
            for (let i = 0; i < count; i++) {
              const nc = fn(cl[ln] || "", c);
              if (nc >= (cl[ln]?.length ?? 0) && ln < cl.length - 1) {
                ln++;
                c = 0;
              } else c = Math.min(nc, (cl[ln]?.length ?? 1) - 1);
            }
            tgtLine = ln;
            tgtCol = c;
          } else if (e.key === "b" || e.key === "B") {
            let ln = cur.line,
              c = cur.col;
            const fn = e.key === "b" ? prevWord : prevWORD;
            for (let i = 0; i < count; i++) {
              const nc = fn(cl[ln] || "", c);
              if (nc === 0 && c === 0 && ln > 0) {
                ln--;
                c = Math.max(0, (cl[ln]?.length ?? 1) - 1);
              } else c = nc;
            }
            tgtLine = ln;
            tgtCol = c;
          } else if (e.key === "e" || e.key === "E") {
            let c = cur.col;
            const fn = e.key === "e" ? endOfWord : endOfWORD;
            for (let i = 0; i < count; i++) c = fn(cl[cur.line] || "", c);
            tgtCol = c + 1;
          } // +1 because endOfWord returns last char, slice needs past-end
          else if (e.key === "{") {
            let ln = cur.line;
            for (let i = 0; i < count; i++) ln = prevParagraph(cl, ln);
            tgtLine = ln;
            tgtCol = 0;
          } else if (e.key === "}") {
            let ln = cur.line;
            for (let i = 0; i < count; i++) ln = nextParagraph(cl, ln);
            tgtLine = ln;
            tgtCol = 0;
          } else if (e.key === "$")
            tgtCol = cl[cur.line]?.length ?? 0; // past-end for inclusive delete
          else if (e.key === "^") {
            const f = (cl[cur.line] || "").search(/\S/);
            tgtCol = f >= 0 ? f : 0;
          } else if (e.key === "0") tgtCol = 0;

          // Line-wise operations (j/k move full lines)
          if ("jk".includes(e.key)) {
            const sL = Math.min(cur.line, tgtLine),
              eL = Math.max(cur.line, tgtLine);
            pushUndo();
            const deleted = cl.slice(sL, eL + 1);
            if (pendingKey === "d") {
              setYankReg(deleted.join("\n"));
              setYankIsLine(true);
              setLines((p) => {
                const nl = [...p];
                nl.splice(sL, eL - sL + 1);
                if (nl.length === 0) nl.push("");
                const newL = Math.min(sL, nl.length - 1);
                setCursor({
                  line: newL,
                  col: Math.min(
                    cur.col,
                    Math.max(0, (nl[newL]?.length ?? 1) - 1)
                  ),
                });
                return nl;
              });
            } else if (pendingKey === "y") {
              setYankReg(deleted.join("\n"));
              setYankIsLine(true);
              flash("Yanked " + deleted.length + " lines");
            } else if (pendingKey === "c") {
              setYankReg(deleted.join("\n"));
              setYankIsLine(true);
              setLines((p) => {
                const nl = [...p];
                nl.splice(sL, eL - sL + 1, "");
                return nl;
              });
              setCursor({ line: sL, col: 0 });
              setVimMode("INSERT");
            }
          } else {
            // Char-wise operations (w/b/e/h/l/$)
            const s = posMin(cur, { line: tgtLine, col: tgtCol }),
              ep = posMax(cur, { line: tgtLine, col: tgtCol });
            if (pendingKey === "d") {
              pushUndo();
              setLines((p) => {
                const nl = [...p];
                if (s.line === ep.line) {
                  setYankReg(nl[s.line].slice(s.col, ep.col));
                  setYankIsLine(false);
                  nl[s.line] =
                    nl[s.line].slice(0, s.col) + nl[s.line].slice(ep.col);
                } else {
                  const ch = [nl[s.line].slice(s.col)];
                  for (let i = s.line + 1; i < ep.line; i++) ch.push(nl[i]);
                  ch.push(nl[ep.line].slice(0, ep.col));
                  setYankReg(ch.join("\n"));
                  setYankIsLine(false);
                  nl[s.line] =
                    nl[s.line].slice(0, s.col) + nl[ep.line].slice(ep.col);
                  nl.splice(s.line + 1, ep.line - s.line);
                }
                return nl;
              });
              setCursor(s);
            } else if (pendingKey === "y") {
              const cl2 = linesRef.current;
              if (s.line === ep.line) {
                setYankReg(cl2[s.line].slice(s.col, ep.col));
              } else {
                const ch = [cl2[s.line].slice(s.col)];
                for (let i = s.line + 1; i < ep.line; i++) ch.push(cl2[i]);
                ch.push(cl2[ep.line].slice(0, ep.col));
                setYankReg(ch.join("\n"));
              }
              setYankIsLine(false);
              flash("Yanked");
            } else if (pendingKey === "c") {
              pushUndo();
              setLines((p) => {
                const nl = [...p];
                if (s.line === ep.line) {
                  setYankReg(nl[s.line].slice(s.col, ep.col));
                  nl[s.line] =
                    nl[s.line].slice(0, s.col) + nl[s.line].slice(ep.col);
                } else {
                  const ch = [nl[s.line].slice(s.col)];
                  for (let i = s.line + 1; i < ep.line; i++) ch.push(nl[i]);
                  ch.push(nl[ep.line].slice(0, ep.col));
                  setYankReg(ch.join("\n"));
                  nl[s.line] =
                    nl[s.line].slice(0, s.col) + nl[ep.line].slice(ep.col);
                  nl.splice(s.line + 1, ep.line - s.line);
                }
                setYankIsLine(false);
                return nl;
              });
              setCursor(s);
              setVimMode("INSERT");
            }
          }
          return;
        }
        setPendingKey(null);
        if (gTimerRef.current) {
          clearTimeout(gTimerRef.current);
          gTimerRef.current = null;
        }
        if (
          combo === "di" ||
          combo === "ci" ||
          combo === "yi" ||
          combo === "da" ||
          combo === "ca" ||
          combo === "ya"
        ) {
          setPendingKey(combo);
          return;
        }
        if (combo === "dd") {
          deleteNLines(vimCtx, count);
          return;
        }
        if (combo === "yy") {
          yankNLines(vimCtx, count);
          return;
        }
        if (combo === "gg") {
          setCursor({ line: 0, col: 0 });
          desiredCol.current = 0;
          return;
        }
        if (combo === "cc") {
          changeNLines(vimCtx, count);
          return;
        }
        if (combo === "dw") {
          deleteNWords(vimCtx, count);
          return;
        }
        if (combo === "cw") {
          changeNWords(vimCtx, count);
          return;
        }
        if (combo === "de") {
          deleteNWords(vimCtx, count);
          return;
        }
        if (combo === ">>") {
          indentLine(vimCtx);
          return;
        }
        if (combo === "<<") {
          outdentLine(vimCtx);
          return;
        }
        if (pendingKey === "f" || pendingKey === "F") {
          let nc = cur.col;
          for (let i = 0; i < count; i++)
            nc = findChar(cl[cur.line] || "", nc, e.key, pendingKey === "f");
          setCursor({ ...cur, col: nc });
          desiredCol.current = nc;
          return;
        }
        if (pendingKey === "r") {
          replaceChar(vimCtx, e.key);
          return;
        }
        if (pendingKey === "g") {
          switchToGraph();
          return;
        }
        return;
      }

      // ★ Non-pending: consume count for direct motions/actions
      const count = parseInt(countStr) || 1;
      setCountStr("");

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
      if (e.key === ">") {
        e.preventDefault();
        setPendingKey(">");
        return;
      }
      if (e.key === "<") {
        e.preventDefault();
        setPendingKey("<");
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
        const tgt =
          count > 1 ? Math.min(count - 1, cl.length - 1) : cl.length - 1;
        setCursor({ line: tgt, col: clampCol(cl, tgt, 0, false) });
        desiredCol.current = 0;
        return;
      }
      if (e.key === "h") {
        e.preventDefault();
        const nc = Math.max(0, cur.col - count);
        setCursor({ ...cur, col: nc });
        desiredCol.current = nc;
        return;
      }
      if (e.key === "l") {
        e.preventDefault();
        const mx = Math.max(0, (cl[cur.line]?.length ?? 1) - 1);
        const nc = Math.min(cur.col + count, mx);
        setCursor({ ...cur, col: nc });
        desiredCol.current = nc;
        return;
      }
      if (e.key === "j") {
        e.preventDefault();
        const nl = Math.min(cur.line + count, cl.length - 1);
        setCursor({
          line: nl,
          col: clampCol(cl, nl, desiredCol.current, false),
        });
        return;
      }
      if (e.key === "k") {
        e.preventDefault();
        const nl = Math.max(cur.line - count, 0);
        setCursor({
          line: nl,
          col: clampCol(cl, nl, desiredCol.current, false),
        });
        return;
      }
      if (e.key === "w") {
        e.preventDefault();
        let ln = cur.line,
          c = cur.col;
        for (let i = 0; i < count; i++) {
          const nc = nextWord(cl[ln] || "", c);
          if (nc >= (cl[ln]?.length ?? 0) && ln < cl.length - 1) {
            ln++;
            c = 0;
          } else c = Math.min(nc, Math.max(0, (cl[ln]?.length ?? 1) - 1));
        }
        desiredCol.current = c;
        setCursor({ line: ln, col: c });
        return;
      }
      if (e.key === "b") {
        e.preventDefault();
        let ln = cur.line,
          c = cur.col;
        for (let i = 0; i < count; i++) {
          const nc = prevWord(cl[ln] || "", c);
          if (nc === 0 && c === 0 && ln > 0) {
            ln--;
            c = Math.max(0, (cl[ln]?.length ?? 1) - 1);
          } else c = nc;
        }
        desiredCol.current = c;
        setCursor({ line: ln, col: c });
        return;
      }
      if (e.key === "e") {
        e.preventDefault();
        let c = cur.col;
        for (let i = 0; i < count; i++) c = endOfWord(cl[cur.line] || "", c);
        desiredCol.current = c;
        setCursor({ ...cur, col: c });
        return;
      }
      if (e.key === "W") {
        e.preventDefault();
        let ln = cur.line,
          c = cur.col;
        for (let i = 0; i < count; i++) {
          const nc = nextWORD(cl[ln] || "", c);
          if (nc >= (cl[ln]?.length ?? 0) && ln < cl.length - 1) {
            ln++;
            c = 0;
          } else c = Math.min(nc, Math.max(0, (cl[ln]?.length ?? 1) - 1));
        }
        desiredCol.current = c;
        setCursor({ line: ln, col: c });
        return;
      }
      if (e.key === "B") {
        e.preventDefault();
        let ln = cur.line,
          c = cur.col;
        for (let i = 0; i < count; i++) {
          const nc = prevWORD(cl[ln] || "", c);
          if (nc === 0 && c === 0 && ln > 0) {
            ln--;
            c = Math.max(0, (cl[ln]?.length ?? 1) - 1);
          } else c = nc;
        }
        desiredCol.current = c;
        setCursor({ line: ln, col: c });
        return;
      }
      if (e.key === "E") {
        e.preventDefault();
        let c = cur.col;
        for (let i = 0; i < count; i++) c = endOfWORD(cl[cur.line] || "", c);
        desiredCol.current = c;
        setCursor({ ...cur, col: c });
        return;
      }
      if (e.key === "{") {
        e.preventDefault();
        let ln = cur.line;
        for (let i = 0; i < count; i++) ln = prevParagraph(cl, ln);
        setCursor({ line: ln, col: 0 });
        desiredCol.current = 0;
        return;
      }
      if (e.key === "}") {
        e.preventDefault();
        let ln = cur.line;
        for (let i = 0; i < count; i++) ln = nextParagraph(cl, ln);
        setCursor({ line: ln, col: 0 });
        desiredCol.current = 0;
        return;
      }
      if (e.key === "%") {
        e.preventDefault();
        const match = findMatchingBracket(cl, cur.line, cur.col);
        if (match) {
          setCursor(match);
          desiredCol.current = match.col;
        }
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
      if (e.key === "s") {
        e.preventDefault();
        substituteChar(vimCtx);
        return;
      }
      if (e.key === "S") {
        e.preventDefault();
        changeLine(vimCtx);
        return;
      }
      if (e.key === "x") {
        e.preventDefault();
        deleteNChars(vimCtx, count);
        return;
      }
      if (e.key === "J") {
        e.preventDefault();
        joinLines(vimCtx);
        return;
      }
      if (e.key === "~") {
        e.preventDefault();
        toggleCase(vimCtx);
        return;
      }
      if (e.key === "D") {
        e.preventDefault();
        deleteToEOL(vimCtx);
        return;
      }
      if (e.key === "C") {
        e.preventDefault();
        deleteToEOL(vimCtx);
        setVimMode("INSERT");
        return;
      }
      if (e.key === "p") {
        e.preventDefault();
        pasteAfter(vimCtx, yankReg, yankIsLine);
        return;
      }
      if (e.key === "P") {
        e.preventDefault();
        pasteBefore(vimCtx, yankReg, yankIsLine);
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
      if (e.key === "V") {
        e.preventDefault();
        setVimMode("VISUAL_LINE");
        setVisualLineAnchor(cur.line);
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

    const handlePaste = (e: ClipboardEvent) => {
      if (vimMode !== "INSERT" || uiFocus !== "editor") return;
      e.preventDefault();
      const text = e.clipboardData?.getData("text/plain");
      if (!text) return;
      pushUndo();
      const cur = cursorRef.current;
      const cl = linesRef.current;
      const pasteLines = text.split("\n");
      setLines(() => {
        const nl = [...cl];
        const before = nl[cur.line].slice(0, cur.col);
        const after = nl[cur.line].slice(cur.col);
        if (pasteLines.length === 1) {
          nl[cur.line] = before + pasteLines[0] + after;
          setCursor({ line: cur.line, col: cur.col + pasteLines[0].length });
        } else {
          nl[cur.line] = before + pasteLines[0];
          const middle = pasteLines.slice(1, -1);
          const lastPaste = pasteLines[pasteLines.length - 1];
          nl.splice(cur.line + 1, 0, ...middle, lastPaste + after);
          setCursor({
            line: cur.line + pasteLines.length - 1,
            col: lastPaste.length,
          });
        }
        return nl;
      });
    };

    window.addEventListener("keydown", handle);
    window.addEventListener("paste", handlePaste);
    return () => {
      window.removeEventListener("keydown", handle);
      window.removeEventListener("paste", handlePaste);
    };
  }, [
    vimMode,
    uiFocus,
    pendingKey,
    countStr,
    listIdx,
    sortedNodes,
    treeSorted,
    selectedNodeId,
    showSearch,
    searchResults,
    searchIdx,
    isCreating,
    bracketSugs,
    bracketIdx,
    yankReg,
    yankIsLine,
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
    visualAnchor,
    visualLineAnchor,
    vimCtx,
  ]);

  // ━━━ RENDER ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (isLoading)
    return (
      <div className="h-screen bg-[var(--bg-primary)] flex items-center justify-center">
        <span className="text-[var(--text-faint)] font-mono text-sm">
          Loading…
        </span>
      </div>
    );

  const modeColor =
    vimMode === "NORMAL"
      ? "var(--green)"
      : vimMode === "INSERT"
      ? "var(--yellow)"
      : vimMode === "VISUAL"
      ? "var(--blue)"
      : "var(--accent)";

  function renderEditorLine(lineText: string, lineIdx: number) {
    const isCurLine =
      uiFocus === "editor" && lineIdx === cursor.line && !showLinker;
    const lineNum = lineIdx + 1;
    const relNum = Math.abs(lineIdx - cursor.line);

    // Visual line highlighting
    if (
      vimMode === "VISUAL_LINE" &&
      isLineSelected(visualLineAnchor, cursor.line, lineIdx)
    ) {
      const chars = lineText.split("");
      return (
        <div
          key={lineIdx}
          id={`ed-line-${lineIdx}`}
          className="ed-line flex items-start bg-[var(--selection)]"
        >
          <span className="ed-gutter select-none flex-shrink-0 w-[44px] text-right pr-3 text-[12px] leading-[22px] text-[var(--text-muted)]">
            {isCurLine ? lineNum : relNum || lineNum}
          </span>
          <span className="flex-1 min-w-0 whitespace-pre-wrap break-words font-mono text-[14px] leading-[22px] text-[var(--text-secondary)] bg-[var(--selection)]">
            {chars.length === 0 ? (
              isCurLine ? (
                <span className="ed-cursor-block">&nbsp;</span>
              ) : (
                "\u00A0"
              )
            ) : (
              chars.map((ch, ci) => {
                if (isCurLine && ci === cursor.col)
                  return (
                    <span key={ci} className="ed-cursor-block">
                      {ch}
                    </span>
                  );
                return <span key={ci}>{ch}</span>;
              })
            )}
          </span>
        </div>
      );
    }

    if (isCurLine) {
      const chars = lineText.split("");
      return (
        <div
          key={lineIdx}
          id={`ed-line-${lineIdx}`}
          className="ed-line flex items-start bg-[var(--bg-editor-line)]"
        >
          <span className="ed-gutter select-none flex-shrink-0 w-[44px] text-right pr-3 text-[12px] leading-[22px] text-[var(--text-muted)]">
            {lineNum}
          </span>
          <span className="flex-1 min-w-0 whitespace-pre-wrap break-words font-mono text-[14px] leading-[22px] text-[var(--text-secondary)]">
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
                if (
                  isCur &&
                  (vimMode === "VISUAL" || vimMode === "VISUAL_LINE")
                )
                  return (
                    <span
                      key={ci}
                      className="bg-[var(--blue)] text-[var(--bg-primary)]"
                    >
                      {ch}
                    </span>
                  );
                if (isSelected(visualAnchor, cursor, lineIdx, ci))
                  return (
                    <span key={ci} className="bg-[var(--selection)]">
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
            <span className="ed-gutter select-none flex-shrink-0 w-[44px] text-right pr-3 text-[12px] leading-[22px] text-[var(--text-faint)]">
              {relNum || lineNum}
            </span>
            <span className="flex-1 min-w-0 whitespace-pre-wrap break-words font-mono text-[14px] leading-[22px] text-[var(--text-secondary)]">
              {chars.length === 0 ? (
                <span className="bg-[var(--selection)] inline-block w-2 h-[22px]" />
              ) : (
                chars.map((ch, ci) => (
                  <span
                    key={ci}
                    className={
                      isSelected(visualAnchor, cursor, lineIdx, ci)
                        ? "bg-[var(--selection)]"
                        : ""
                    }
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
        <span className="ed-gutter select-none flex-shrink-0 w-[44px] text-right pr-3 text-[12px] leading-[22px] text-[var(--text-faint)]">
          {relNum || lineNum}
        </span>
        <div
          className={`flex-1 min-w-0 whitespace-pre-wrap font-mono text-[14px] leading-[22px] text-[var(--text-secondary)] break-words ${
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
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)]" />
      )}
      <span className="text-[11px] text-[var(--text-dimmed)] font-mono uppercase tracking-wider">
        {label}
      </span>
    </div>
  );

  return (
    <div className="h-screen flex flex-col bg-[var(--bg-primary)] text-[var(--text-secondary)] overflow-hidden">
      {/* HEADER */}
      <header className="bg-[var(--bg-secondary)] border-b border-[var(--border)] flex-shrink-0 h-11 flex items-center px-4 gap-3">
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="text-[var(--accent)] text-[16px]">◆</span>
          <span className="text-[14px] font-semibold text-[var(--text-primary)] tracking-tight">
            Knowledge Tree
          </span>
        </div>
        <div className="flex items-center bg-[var(--bg-tertiary)] rounded-md border border-[var(--border)] overflow-hidden flex-shrink-0">
          <button
            onClick={() => setView("notes")}
            className={`px-3 py-1 text-[12px] font-medium transition-colors ${
              view === "notes"
                ? "bg-[var(--bg-active)] text-[var(--text-primary)]"
                : "text-[var(--text-dimmed)] hover:text-[var(--text-secondary)]"
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
                ? "bg-[var(--bg-active)] text-[var(--text-primary)]"
                : "text-[var(--text-dimmed)] hover:text-[var(--text-secondary)]"
            }`}
          >
            <span className="mr-1.5">◇</span>Graph
          </button>
        </div>
        <span className="text-[11px] text-[var(--text-faint)] font-mono flex-shrink-0">
          {nodes?.length || 0} nodes
        </span>
        <div className="flex-1 min-w-0 flex justify-center">
          {selectedNode && view === "notes" && (
            <span className="text-[12px] text-[var(--text-muted)] font-mono truncate max-w-[300px]">
              {selectedNode.title}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2.5 flex-shrink-0">
          <button
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            className="w-6 h-6 rounded-md flex items-center justify-center text-[12px] hover:bg-[var(--bg-tertiary)] border border-transparent hover:border-[var(--border)] transition-all font-mono"
            style={{ color: "var(--text-dimmed)" }}
            title="Toggle theme"
          >
            {theme === "dark" ? "☀" : "●"}
          </button>
          <button
            onClick={() => setShowHelp(true)}
            className="w-6 h-6 rounded-md flex items-center justify-center text-[12px] text-[var(--text-dimmed)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] border border-transparent hover:border-[var(--border)] transition-all font-mono font-bold"
            title="Shortcuts (?)"
          >
            ?
          </button>
          <span className="text-[11px] text-[var(--text-dimmed)] font-mono hidden sm:inline">
            {session?.user?.email}
          </span>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="text-[11px] text-[var(--text-dimmed)] hover:text-[var(--text-secondary)] font-mono transition-colors"
          >
            logout
          </button>
        </div>
      </header>

      {/* Search */}
      {showSearch && (
        <div className="bg-[var(--bg-secondary)] border-b border-[var(--border)] flex-shrink-0">
          <div className="max-w-lg mx-auto px-4 py-2">
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--blue)] text-[13px] font-mono">
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
                className="w-full pl-7 pr-3 py-1.5 bg-[var(--bg-primary)] border border-[var(--border-active)] rounded text-[13px] font-mono text-[var(--text-primary)] placeholder-[var(--text-dimmed)] focus:border-[var(--blue)]/50 focus:outline-none"
              />
            </div>
            {searchResults.length > 0 && (
              <div className="mt-1 bg-[var(--bg-primary)] border border-[var(--border)] rounded overflow-hidden max-h-48 overflow-y-auto custom-scrollbar">
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
                        ? "bg-[var(--selection)] text-[var(--text-primary)]"
                        : "text-[var(--text-secondary)] hover:bg-[var(--bg-active)]"
                    }`}
                  >
                    {n.title}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* MAIN */}
      <div className="flex-1 overflow-hidden flex">
        {view === "notes" ? (
          <>
            {/* Node list */}
            <div
              className={`${
                selectedNodeId ? "w-[260px] min-w-[260px]" : "flex-1 max-w-lg"
              } h-full border-r border-[var(--border)] flex flex-col bg-[var(--bg-primary)] relative`}
            >
              {uiFocus === "list" && (
                <div className="absolute top-0 left-0 right-0 h-[2px] bg-[var(--green)] z-10" />
              )}
              <div className="flex-shrink-0 p-2 border-b border-[var(--border)]">
                <button
                  onClick={() => {
                    setIsCreating(true);
                    setTimeout(() => newTitleRef.current?.focus(), 30);
                  }}
                  className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 bg-[var(--bg-secondary)] hover:bg-[var(--bg-primary)] border border-[var(--border-active)] text-[var(--text-secondary)] rounded text-[11px] font-mono"
                >
                  <span className="text-[var(--green)]">+</span>new
                  <kbd className="text-[10px] text-[var(--text-dimmed)] ml-1">
                    n
                  </kbd>
                </button>
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar">
                {treeSorted.length === 0 ? (
                  <div className="flex items-center justify-center h-full">
                    <p className="text-[var(--text-dimmed)] text-[12px] font-mono">
                      press n to create first node
                    </p>
                  </div>
                ) : (
                  <div className="py-px">
                    {treeSorted.map((item, idx) => {
                      const isActive = item.node.id === selectedNodeId;
                      const isCur = idx === listIdx && uiFocus === "list";
                      const isCollapsedNode =
                        item.hasChildren && !expanded.has(item.node.id);
                      return (
                        <div
                          key={item.node.id}
                          ref={(el) => {
                            if (el) listItemRefs.current.set(idx, el);
                            else listItemRefs.current.delete(idx);
                          }}
                          onClick={() => {
                            selectNode(item.node.id);
                            setListIdx(idx);
                            setUIFocus("editor");
                          }}
                          className={`flex items-center cursor-pointer transition-all duration-75 border-l-[3px] pr-2 py-[3px] ${
                            isActive
                              ? "bg-[var(--bg-tertiary)] border-l-[var(--accent)]"
                              : isCur
                              ? "bg-[var(--selection)] border-l-[var(--green)]"
                              : "border-l-transparent hover:bg-[var(--bg-tertiary)]/30"
                          }`}
                          style={{ paddingLeft: "6px" }}
                        >
                          {/* Tree connectors */}
                          {item.prefix && (
                            <span className="text-[var(--text-dimmed)] text-[11px] font-mono whitespace-pre flex-shrink-0 select-none">
                              {item.prefix}
                            </span>
                          )}
                          {/* Collapse chevron or spacer */}
                          {item.hasChildren ? (
                            <span
                              className="text-[13px] font-mono text-[var(--text-muted)] flex-shrink-0 w-4 select-none cursor-pointer"
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpanded((s) => {
                                  const next = new Set(s);
                                  if (next.has(item.node.id))
                                    next.delete(item.node.id);
                                  else next.add(item.node.id);
                                  return next;
                                });
                                setListIdx(idx);
                              }}
                            >
                              {isCollapsedNode ? "▶" : "▼"}{" "}
                            </span>
                          ) : (
                            <span className="w-3 flex-shrink-0" />
                          )}
                          {/* Type badge or dot */}
                          {item.specialType ? (
                            <span
                              className="text-[9px] font-mono font-medium flex-shrink-0 px-1 rounded"
                              style={{
                                color:
                                  EDGE_COLORS_BRIGHT[item.specialType] ||
                                  "var(--text-faint)",
                              }}
                            >
                              {item.specialType.slice(0, 3)}
                            </span>
                          ) : (
                            <span
                              className="w-[5px] h-[5px] rounded-full flex-shrink-0"
                              style={{
                                backgroundColor: getNodeColor(item.node),
                              }}
                            />
                          )}
                          <span
                            className={`text-[12px] font-mono truncate flex-1 ml-1.5 ${
                              isActive || isCur
                                ? "text-[var(--text-primary)]"
                                : item.specialType
                                ? "text-[var(--text-muted)]"
                                : "text-[var(--text-secondary)]"
                            }`}
                          >
                            {item.node.title}
                          </span>
                          {isCur && (
                            <span className="text-[9px] text-[var(--green)] font-mono flex-shrink-0">
                              ◂
                            </span>
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
              <div className="flex-1 h-full flex flex-col overflow-hidden bg-[var(--bg-primary)] relative">
                {uiFocus === "editor" && !showLinker && (
                  <div
                    className="absolute top-0 left-0 right-0 h-[2px] z-10"
                    style={{ backgroundColor: modeColor }}
                  />
                )}
                {allConns.length > 0 && (
                  <div className="flex-shrink-0 border-b border-[var(--border)] px-3 py-1.5 flex flex-wrap gap-1.5 bg-[var(--bg-secondary)]">
                    {allConns.map((c) => {
                      const tid = c.dir === "out" ? c.toNodeId : c.fromNodeId;
                      return (
                        <span
                          key={c.id}
                          className="inline-flex items-center gap-1 bg-[var(--bg-tertiary)] px-2 py-0.5 rounded text-[10px] font-mono border border-[var(--border)] group"
                        >
                          <span
                            className="w-[4px] h-[4px] rounded-full"
                            style={{
                              backgroundColor:
                                EDGE_COLORS_BRIGHT[c.type] ||
                                "var(--text-faint)",
                            }}
                          />
                          <span
                            className="text-[var(--text-secondary)] cursor-pointer hover:text-[var(--text-primary)]"
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
                            className="text-[var(--text-dimmed)] hover:text-[var(--red)] opacity-0 group-hover:opacity-100"
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
                  <div className="w-full overflow-hidden">
                    {lines.map((l, i) => renderEditorLine(l, i))}
                    <div className="h-48" />
                  </div>
                  {bracketSugs.length > 0 && vimMode === "INSERT" && (
                    <div
                      className="fixed z-50 bg-[var(--bg-tertiary)] border border-[var(--border-active)] rounded shadow-2xl overflow-hidden max-w-[280px]"
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
                              ? "bg-[var(--bg-active)] text-[var(--text-primary)]"
                              : "text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
                          }`}
                        >
                          <span
                            className="w-[6px] h-[6px] rounded-full"
                            style={{ backgroundColor: getNodeColor(s) }}
                          />
                          <span className="truncate">{s.title}</span>
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
              theme={theme}
            />
            {hoverNode && (
              <div
                className="fixed bg-[var(--bg-tertiary)]/95 backdrop-blur border border-[var(--border-active)] rounded-lg shadow-2xl p-3 w-[300px] pointer-events-none z-40"
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
                <span className="text-[13px] font-mono font-bold text-[var(--text-primary)]">
                  {hoverNode.title}
                </span>
                {hoverNode.content && (
                  <p className="text-[11px] text-[var(--text-secondary)] font-mono line-clamp-3 mt-1">
                    {hoverNode.content}
                  </p>
                )}
              </div>
            )}
            <div className="absolute bottom-4 left-4 bg-[var(--bg-primary)]/90 border border-[var(--border)] rounded p-2.5 text-[11px] font-mono space-y-1">
              {Object.entries(EDGE_COLORS_BRIGHT).map(([t, c]) => (
                <div key={t} className="flex items-center gap-2">
                  <span
                    className="w-4 h-0.5 rounded"
                    style={{ backgroundColor: c }}
                  />
                  <span className="text-[var(--text-secondary)]">{t}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* LINKER */}
      {showLinker && selectedNode && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowLinker(false);
          }}
        >
          <div className="absolute inset-0 bg-[var(--bg-input)]/70 backdrop-blur-[3px]" />
          <div className="relative z-10 w-full max-w-4xl max-h-[80vh] bg-[var(--bg-secondary)] border border-[var(--border-active)]/40 rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.5)] flex overflow-hidden">
            {/* LEFT — Tree */}
            <div className="w-[340px] flex-shrink-0 border-r border-[var(--border)] flex flex-col bg-[var(--bg-primary)]/50">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)]">
                <span className="w-2 h-2 rounded-full bg-[var(--accent)]" />
                <span className="text-[11px] text-[var(--text-muted)] font-mono uppercase tracking-widest">
                  Tree
                </span>
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar px-3 py-2">
                {treeLines.length > 0 ? (
                  <div className="space-y-[1px]">
                    {treeLines.map((tl, i) => {
                      const gc = tl.ghostEdgeType
                        ? EDGE_COLORS_BRIGHT[tl.ghostEdgeType] ||
                          EDGE_COLORS_BRIGHT.parent
                        : undefined;
                      const edgeColor = tl.edgeType
                        ? EDGE_COLORS_BRIGHT[tl.edgeType]
                        : gc || "var(--text-faint)";
                      return (
                        <div
                          key={i}
                          className={`flex items-center font-mono text-[12px] leading-[22px] transition-all duration-100 rounded-md ${
                            tl.isGhost ? "opacity-60" : ""
                          } ${tl.isCurrent ? "bg-[var(--selection)]" : ""}`}
                        >
                          <span
                            className="flex-shrink-0 whitespace-pre text-[11px]"
                            style={{ color: edgeColor }}
                          >
                            {tl.prefix}
                          </span>
                          {tl.isCurrent ? (
                            <span className="text-[var(--text-primary)] font-bold truncate flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] flex-shrink-0" />
                              {tl.label}
                            </span>
                          ) : tl.isGhost ? (
                            <span
                              className="truncate px-1.5 py-0.5 rounded border border-dashed text-[11px] flex items-center gap-1"
                              style={{
                                borderColor: "var(--border-active)",
                                color: gc || "var(--text-muted)",
                                backgroundColor: "var(--bg-active)",
                              }}
                            >
                              {tl.label}
                              {tl.edgeType && (
                                <span className="text-[8px] opacity-70">
                                  {tl.edgeType}
                                </span>
                              )}
                            </span>
                          ) : (
                            <span
                              className="truncate flex items-center gap-1"
                              style={
                                tl.edgeType
                                  ? { color: EDGE_COLORS_BRIGHT[tl.edgeType] }
                                  : { color: "var(--text-secondary)" }
                              }
                            >
                              {tl.label}
                              {tl.edgeType && (
                                <span
                                  className="text-[9px] px-1 rounded-sm flex-shrink-0 font-medium"
                                  style={{
                                    backgroundColor: "var(--bg-active)",
                                    color: EDGE_COLORS_BRIGHT[tl.edgeType],
                                  }}
                                >
                                  {tl.direction === "in" ? "←" : "→"}
                                  {tl.edgeType}
                                </span>
                              )}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[var(--text-dimmed)] text-[12px] font-mono text-center py-8">
                    No tree structure yet
                  </p>
                )}
              </div>
            </div>

            {/* RIGHT — Controls */}
            <div className="flex-1 flex flex-col min-w-0">
              {/* Connections */}
              {allConns.length > 0 && (
                <div
                  className={`px-4 py-2.5 border-b border-[var(--border)] transition-colors ${
                    linkerFocus === "conns"
                      ? "bg-[var(--bg-link-active)]/40"
                      : ""
                  }`}
                >
                  {sectionIndicator("conns", "Connections")}
                  <div className="space-y-0.5 max-h-[120px] overflow-y-auto custom-scrollbar">
                    {allConns.map((c, idx) => {
                      const tid = c.dir === "out" ? c.toNodeId : c.fromNodeId;
                      const focused =
                        linkerFocus === "conns" && connIdx === idx;
                      return (
                        <div
                          key={c.id}
                          className={`flex items-center gap-2 text-[12px] font-mono px-2.5 py-1.5 rounded-md transition-all duration-75 ${
                            focused
                              ? "bg-[var(--bg-link-selection)] ring-1 ring-[var(--red)]/30"
                              : "hover:bg-[var(--bg-tertiary)]/40"
                          }`}
                        >
                          <span
                            className="w-[5px] h-[5px] rounded-full flex-shrink-0"
                            style={{
                              backgroundColor:
                                EDGE_COLORS_BRIGHT[c.type] ||
                                "var(--text-faint)",
                            }}
                          />
                          <span className="text-[var(--text-muted)] text-[10px] w-[52px] flex-shrink-0">
                            {c.type}
                          </span>
                          <span className="text-[var(--text-primary)] truncate flex-1">
                            {getNodeTitle(tid)}
                          </span>
                          {focused && (
                            <span className="text-[10px] text-[var(--red)] flex-shrink-0">
                              d:unlink
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Link Type */}
              <div
                className={`px-4 py-2.5 border-b border-[var(--border)] transition-colors ${
                  linkerFocus === "type" ? "bg-[var(--bg-link-active)]/40" : ""
                }`}
              >
                {sectionIndicator("type", "Link Type")}
                <div className="flex gap-1.5">
                  {LINK_TYPES.map((lt, idx) => (
                    <button
                      key={lt.type}
                      onClick={() => setLinkTypeIdx(idx)}
                      className={`flex-1 py-2 rounded-lg text-[12px] font-mono font-medium transition-all duration-75 flex flex-col items-center gap-0.5 border ${
                        linkTypeIdx === idx
                          ? "text-[var(--text-primary)] font-bold"
                          : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] bg-[var(--bg-primary)] border-[var(--border)]"
                      }`}
                      style={
                        linkTypeIdx === idx
                          ? {
                              backgroundColor: "var(--bg-link-selection)",
                              borderColor: "var(--border-active)",
                            }
                          : undefined
                      }
                    >
                      <span className="text-[14px]">{lt.icon}</span>
                      <span>{lt.label}</span>
                    </button>
                  ))}
                </div>
                {linkerFocus === "type" && (
                  <p className="text-[10px] text-[var(--text-muted)] font-mono mt-1.5 text-center">
                    h/l type · j↓ candidates · k↑ connections
                  </p>
                )}
              </div>

              {/* Candidates */}
              <div
                className={`flex-1 flex flex-col min-h-0 px-4 py-2.5 transition-colors ${
                  linkerFocus === "candidates" || linkerFocus === "filter"
                    ? "bg-[var(--bg-link-active)]/40"
                    : ""
                }`}
              >
                {sectionIndicator("candidates", "Candidates")}
                <div className="mb-2">
                  <div className="relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-[var(--text-muted)] font-mono">
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
                      className={`w-full pl-7 pr-3 py-1.5 bg-[var(--bg-input)] border rounded-md text-[12px] font-mono text-[var(--text-primary)] placeholder-[var(--text-faint)] focus:outline-none transition-colors ${
                        linkerFocus === "filter"
                          ? "border-[var(--green)]/50"
                          : "border-[var(--border)]"
                      }`}
                    />
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar space-y-0.5">
                  {linkCandidates.length > 0 ? (
                    linkCandidates.map((n, idx) => (
                      <button
                        key={n.id}
                        onClick={() => validateAndLink(n.id)}
                        className={`w-full text-left px-2.5 py-1.5 rounded-md text-[12px] font-mono transition-all duration-75 flex items-center gap-2 ${
                          linkerFocus === "candidates" && linkCandIdx === idx
                            ? "bg-[var(--bg-link-selection)] ring-1 ring-[var(--green)]/30 text-[var(--text-primary)]"
                            : "text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]/40"
                        }`}
                      >
                        <span
                          className="w-[5px] h-[5px] rounded-full flex-shrink-0"
                          style={{ backgroundColor: getNodeColor(n) }}
                        />
                        <span className="truncate">{n.title}</span>
                      </button>
                    ))
                  ) : (
                    <p className="text-[var(--text-dimmed)] text-[11px] font-mono text-center py-4">
                      {linkSearch ? "no matches" : "no candidates"}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CREATE */}
      {isCreating && (
        <div className="fixed inset-0 z-50 bg-[var(--bg-primary)]/80 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg shadow-2xl w-full max-w-sm p-4 space-y-3">
            <h2 className="text-[14px] font-mono font-bold text-[var(--text-primary)]">
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
              className="w-full px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-active)] rounded text-[14px] font-mono text-[var(--text-primary)] placeholder-[var(--text-faint)] focus:border-[var(--accent)]/40 focus:outline-none"
            />
            <div className="flex gap-2">
              <button
                onClick={() => {
                  if (newTitle.trim())
                    createNode.mutate({ title: newTitle.trim(), content: "" });
                }}
                disabled={!newTitle.trim()}
                className="flex-1 bg-[var(--accent)] hover:opacity-90 text-white py-1.5 rounded text-[12px] font-mono font-medium disabled:opacity-25"
              >
                create
              </button>
              <button
                onClick={() => {
                  setIsCreating(false);
                  setNewTitle("");
                }}
                className="px-3 py-1.5 bg-[var(--bg-active)] hover:bg-[var(--border-active)] text-[var(--text-secondary)] rounded text-[12px] font-mono"
              >
                cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* HELP */}
      {showHelp && (
        <div
          className="fixed inset-0 z-50 bg-[var(--bg-primary)]/80 backdrop-blur-sm flex items-center justify-center"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowHelp(false);
          }}
        >
          <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)]">
              <span className="text-[15px] font-mono font-bold text-[var(--text-primary)]">
                Keyboard Shortcuts
              </span>
              <button
                onClick={() => setShowHelp(false)}
                className="text-[var(--text-dimmed)] hover:text-[var(--text-secondary)] text-[13px] font-mono"
              >
                esc
              </button>
            </div>
            <div className="overflow-y-auto p-5 custom-scrollbar">
              <div className="grid grid-cols-2 gap-6">
                {HELP_SECTIONS.map((sec) => (
                  <div key={sec.title}>
                    <h3 className="text-[12px] font-mono font-bold text-[var(--text-primary)] uppercase tracking-wider mb-2">
                      {sec.title}
                    </h3>
                    <div className="space-y-1">
                      {sec.items.map(([keys, desc]) => (
                        <div
                          key={keys}
                          className="flex items-start gap-2 text-[12px] font-mono"
                        >
                          <span className="text-[var(--yellow)] min-w-[100px] flex-shrink-0">
                            {keys}
                          </span>
                          <span className="text-[var(--text-secondary)]">
                            {desc}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-[var(--text-dimmed)] font-mono mt-4 text-center">
                Press ? or Esc to close
              </p>
            </div>
          </div>
        </div>
      )}

      {/* STATUS BAR */}
      <div className="h-[32px] bg-[var(--bg-secondary)] border-t border-[var(--border)] flex-shrink-0 flex items-center px-4 gap-3">
        <span
          className="font-bold px-2 py-0.5 rounded text-[11px] font-mono"
          style={{
            backgroundColor: "var(--selection)",
            color: showLinker ? "var(--accent)" : modeColor,
          }}
        >
          {showLinker ? "LINK" : vimMode === "VISUAL_LINE" ? "V-LINE" : vimMode}
        </span>
        <span className="text-[var(--border)]">│</span>
        <span className="text-[12px] text-[var(--text-muted)] font-mono flex-1">
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
            "j↓ k↑ navigate · l/Enter open · n new · dd delete · / search · g graph · ? help"}
          {!showLinker &&
            uiFocus === "editor" &&
            vimMode === "NORMAL" &&
            (pendingKey || countStr
              ? `${countStr}${pendingKey || ""}…`
              : "Space link · g graph · q close · / search · ? help")}
          {!showLinker &&
            uiFocus === "editor" &&
            vimMode === "INSERT" &&
            "Typing · ←→↑↓ move · [[ link · Ctrl+Z undo · Esc → NORMAL"}
          {!showLinker &&
            uiFocus === "editor" &&
            vimMode === "VISUAL" &&
            "hjkl select · d delete · y yank · c change · V line · Esc cancel"}
          {!showLinker &&
            uiFocus === "editor" &&
            vimMode === "VISUAL_LINE" &&
            "j↓ k↑ select lines · d delete · y yank · c change · > < indent · Esc cancel"}
        </span>
        {statusMsg && (
          <span className="text-[12px] text-[var(--yellow)] font-mono font-medium">
            {statusMsg}
          </span>
        )}
        {!statusMsg && uiFocus === "editor" && !showLinker && (
          <span className="text-[12px] text-[var(--text-faint)] font-mono">
            {cursor.line + 1}:{cursor.col + 1}
          </span>
        )}
        <button
          onClick={() => setShowHelp(true)}
          className="text-[12px] text-[var(--text-faint)] hover:text-[var(--text-secondary)] font-mono font-bold transition-colors"
          title="Shortcuts (?)"
        >
          ?
        </button>
      </div>
    </div>
  );
}
