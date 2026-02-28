import type { Node, Pos } from "./types";

// ━━━ Graph Helpers ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export function getNodeColor(n: Node): string {
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

export function wouldCreateCircle(
  fromId: string,
  toId: string,
  nodes: Node[]
): boolean {
  // Adding edge: fromId becomes parent of toId.
  // Cycle if fromId is already a descendant of toId (toId is ancestor of fromId).
  // Walk UP from fromId; if we reach toId, it's a cycle.
  if (fromId === toId) return true;
  const vis = new Set<string>();
  const go = (id: string): boolean => {
    if (vis.has(id)) return false;
    if (id === toId) return true;
    vis.add(id);
    const n = nodes.find((x) => x.id === id);
    if (n)
      for (const e of n.edgesTo)
        if (e.type === "parent" && go(e.fromNodeId)) return true;
    return false;
  };
  return go(fromId);
}

// ━━━ Cursor ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export function clampCol(
  ls: string[],
  ln: number,
  c: number,
  ins: boolean
): number {
  const len = ls[ln]?.length ?? 0;
  return ins ? Math.min(c, len) : Math.min(c, Math.max(0, len - 1));
}

export function posMin(a: Pos, b: Pos): Pos {
  return a.line < b.line || (a.line === b.line && a.col <= b.col) ? a : b;
}

export function posMax(a: Pos, b: Pos): Pos {
  return a.line > b.line || (a.line === b.line && a.col >= b.col) ? a : b;
}

// ━━━ Word Motions ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export function nextWord(l: string, c: number): number {
  let i = c;
  if (i < l.length && /\w/.test(l[i]))
    while (i < l.length && /\w/.test(l[i])) i++;
  else while (i < l.length && !/\w/.test(l[i]) && l[i] !== " ") i++;
  while (i < l.length && /\s/.test(l[i])) i++;
  return Math.min(i, l.length);
}

export function endOfWord(l: string, c: number): number {
  let i = c + 1;
  while (i < l.length && /\s/.test(l[i])) i++;
  while (i < l.length && /\w/.test(l[i])) i++;
  return Math.min(Math.max(i - 1, c), l.length - 1);
}

export function prevWord(l: string, c: number): number {
  let i = c - 1;
  while (i > 0 && /\s/.test(l[i])) i--;
  while (i > 0 && /\w/.test(l[i - 1])) i--;
  return Math.max(0, i);
}

export function nextWORD(l: string, c: number): number {
  let i = c;
  while (i < l.length && !/\s/.test(l[i])) i++;
  while (i < l.length && /\s/.test(l[i])) i++;
  return Math.min(i, l.length);
}

export function endOfWORD(l: string, c: number): number {
  let i = c + 1;
  while (i < l.length && /\s/.test(l[i])) i++;
  while (i < l.length && !/\s/.test(l[i])) i++;
  return Math.min(Math.max(i - 1, c), l.length - 1);
}

export function prevWORD(l: string, c: number): number {
  let i = c - 1;
  while (i > 0 && /\s/.test(l[i])) i--;
  while (i > 0 && !/\s/.test(l[i - 1])) i--;
  return Math.max(0, i);
}

// ━━━ Char Find ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export function findChar(
  l: string,
  c: number,
  ch: string,
  fwd: boolean
): number {
  if (fwd) {
    const i = l.indexOf(ch, c + 1);
    return i >= 0 ? i : c;
  } else {
    const i = l.lastIndexOf(ch, c - 1);
    return i >= 0 ? i : c;
  }
}

// ━━━ Bracket Matching ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export function findMatchingPair(
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

export function findMatchingBracket(
  lines: string[],
  line: number,
  col: number
): Pos | null {
  const PAIRS: Record<string, { match: string; dir: 1 | -1 }> = {
    "(": { match: ")", dir: 1 },
    ")": { match: "(", dir: -1 },
    "[": { match: "]", dir: 1 },
    "]": { match: "[", dir: -1 },
    "{": { match: "}", dir: 1 },
    "}": { match: "{", dir: -1 },
  };
  const ch = lines[line]?.[col];
  if (!ch || !PAIRS[ch]) return null;
  const { match, dir } = PAIRS[ch];
  let depth = 1,
    ln = line,
    c = col + dir;
  while (ln >= 0 && ln < lines.length) {
    const l = lines[ln];
    while (c >= 0 && c < l.length) {
      if (l[c] === ch) depth++;
      else if (l[c] === match) {
        depth--;
        if (depth === 0) return { line: ln, col: c };
      }
      c += dir;
    }
    ln += dir;
    if (ln >= 0 && ln < lines.length) c = dir > 0 ? 0 : lines[ln].length - 1;
  }
  return null;
}

// ━━━ Text Objects ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export function getInnerWord(l: string, c: number): [number, number] | null {
  if (l.length === 0) return null;
  const col = Math.min(c, l.length - 1);
  if (/\s/.test(l[col])) {
    let s = col,
      e = col;
    while (s > 0 && /\s/.test(l[s - 1])) s--;
    while (e < l.length - 1 && /\s/.test(l[e + 1])) e++;
    return [s, e];
  }
  const isW = /\w/.test(l[col]);
  const test = isW ? /\w/ : /[^\w\s]/;
  let s = col,
    e = col;
  while (s > 0 && test.test(l[s - 1])) s--;
  while (e < l.length - 1 && test.test(l[e + 1])) e++;
  return [s, e];
}

export function getAWord(l: string, c: number): [number, number] | null {
  const inner = getInnerWord(l, c);
  if (!inner) return null;
  let [s, e] = inner;
  if (e + 1 < l.length && /\s/.test(l[e + 1])) {
    while (e + 1 < l.length && /\s/.test(l[e + 1])) e++;
  } else if (s > 0 && /\s/.test(l[s - 1])) {
    while (s > 0 && /\s/.test(l[s - 1])) s--;
  }
  return [s, e];
}

// ━━━ Paragraph ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export function prevParagraph(lines: string[], curLine: number): number {
  let i = curLine - 1;
  while (i > 0 && lines[i].trim() === "") i--;
  while (i > 0 && lines[i].trim() !== "") i--;
  return Math.max(0, i);
}

export function nextParagraph(lines: string[], curLine: number): number {
  let i = curLine + 1;
  while (i < lines.length && lines[i].trim() === "") i++;
  while (i < lines.length && lines[i].trim() !== "") i++;
  return Math.min(lines.length - 1, i);
}

// ━━━ Autocomplete ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export function getBracketCtx(
  t: string,
  c: number
): { query: string; start: number } | null {
  const b = t.slice(0, c);
  const i = b.lastIndexOf("[[");
  if (i === -1 || b.slice(i + 2).includes("]]")) return null;
  return { query: b.slice(i + 2), start: i };
}

// ━━━ Doc ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export function buildDoc(t: string, c: string): string[] {
  return ["## " + t, "", ...(c ? c.split("\n") : [""])];
}

export function extractDoc(d: string[]): { title: string; content: string } {
  return {
    title: (d[0] || "").replace(/^#+\s*/, "").trim() || "Untitled",
    content: d.slice(2).join("\n"),
  };
}
