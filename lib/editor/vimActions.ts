import type { Pos, VimCtx } from "./types";
import {
  nextWord,
  findMatchingPair,
  getInnerWord,
  getAWord,
  posMin,
  posMax,
} from "./helpers";

// ━━━ Basic ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function insertChar(ctx: VimCtx, ch: string) {
  ctx.pushUndo();
  const cur = ctx.cursorRef.current;
  ctx.setLines((p) => {
    const nl = [...p];
    nl[cur.line] =
      nl[cur.line].slice(0, cur.col) + ch + nl[cur.line].slice(cur.col);
    return nl;
  });
  ctx.setCursor({ line: cur.line, col: cur.col + ch.length });
  ctx.desiredCol.current = cur.col + ch.length;
}

export function deleteLine(ctx: VimCtx) {
  ctx.pushUndo();
  const cur = ctx.cursorRef.current;
  ctx.setLines((p) => {
    const nl = [...p];
    ctx.setYankReg(nl[cur.line] || "");
    ctx.setYankIsLine(true);
    if (nl.length === 1) {
      nl[0] = "";
      ctx.setCursor({ line: 0, col: 0 });
    } else {
      nl.splice(cur.line, 1);
      const newLine = Math.min(cur.line, nl.length - 1);
      ctx.setCursor({
        line: newLine,
        col: Math.min(cur.col, Math.max(0, (nl[newLine]?.length ?? 1) - 1)),
      });
    }
    return nl;
  });
}

export function deleteToEOL(ctx: VimCtx) {
  ctx.pushUndo();
  const cur = ctx.cursorRef.current;
  ctx.setLines((p) => {
    const nl = [...p];
    ctx.setYankReg(nl[cur.line].slice(cur.col));
    ctx.setYankIsLine(false);
    nl[cur.line] = nl[cur.line].slice(0, cur.col);
    return nl;
  });
  ctx.setCursor((c) => ({ ...c, col: Math.max(0, c.col - 1) }));
}

export function changeLine(ctx: VimCtx) {
  ctx.pushUndo();
  const cur = ctx.cursorRef.current;
  ctx.setYankReg(ctx.linesRef.current[cur.line] || "");
  ctx.setYankIsLine(true);
  ctx.setLines((p) => {
    const nl = [...p];
    nl[cur.line] = "";
    return nl;
  });
  ctx.setCursor({ ...cur, col: 0 });
  ctx.setVimMode("INSERT");
}

export function deleteWord(ctx: VimCtx) {
  ctx.pushUndo();
  const cur = ctx.cursorRef.current;
  const l = ctx.linesRef.current[cur.line] || "";
  const end = nextWord(l, cur.col);
  ctx.setYankReg(l.slice(cur.col, end));
  ctx.setYankIsLine(false);
  ctx.setLines((p) => {
    const nl = [...p];
    nl[cur.line] = l.slice(0, cur.col) + l.slice(end);
    return nl;
  });
}

export function changeWord(ctx: VimCtx) {
  deleteWord(ctx);
  ctx.setVimMode("INSERT");
}

export function joinLines(ctx: VimCtx) {
  const cur = ctx.cursorRef.current;
  if (cur.line >= ctx.linesRef.current.length - 1) return;
  ctx.pushUndo();
  ctx.setLines((p) => {
    const nl = [...p];
    const jc = nl[cur.line].length;
    nl[cur.line] += " " + nl[cur.line + 1].trimStart();
    nl.splice(cur.line + 1, 1);
    ctx.setCursor({ ...cur, col: jc });
    return nl;
  });
}

// ━━━ Replace / Toggle / Substitute ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function replaceChar(ctx: VimCtx, ch: string) {
  ctx.pushUndo();
  const cur = ctx.cursorRef.current;
  ctx.setLines((p) => {
    const nl = [...p];
    const l = nl[cur.line];
    if (cur.col < l.length)
      nl[cur.line] = l.slice(0, cur.col) + ch + l.slice(cur.col + 1);
    return nl;
  });
}

export function toggleCase(ctx: VimCtx) {
  const cur = ctx.cursorRef.current;
  const l = ctx.linesRef.current[cur.line] || "";
  const ch = l[cur.col];
  if (!ch) return;
  ctx.pushUndo();
  ctx.setLines((p) => {
    const nl = [...p];
    nl[cur.line] =
      l.slice(0, cur.col) +
      (ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase()) +
      l.slice(cur.col + 1);
    return nl;
  });
  ctx.setCursor({ ...cur, col: Math.min(cur.col + 1, l.length - 1) });
}

export function substituteChar(ctx: VimCtx) {
  ctx.pushUndo();
  const cur = ctx.cursorRef.current;
  const l = ctx.linesRef.current[cur.line] || "";
  if (l.length > 0) {
    ctx.setYankReg(l[cur.col] || "");
    ctx.setYankIsLine(false);
    ctx.setLines((p) => {
      const nl = [...p];
      nl[cur.line] = l.slice(0, cur.col) + l.slice(cur.col + 1);
      return nl;
    });
  }
  ctx.setVimMode("INSERT");
}

// ━━━ Inside Pair ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function deleteInsidePair(ctx: VimCtx, o: string, c: string) {
  const cur = ctx.cursorRef.current;
  const l = ctx.linesRef.current[cur.line] || "";
  const p = findMatchingPair(l, cur.col, o, c);
  if (!p) return;
  ctx.pushUndo();
  ctx.setYankReg(l.slice(p[0] + 1, p[1]));
  ctx.setYankIsLine(false);
  ctx.setLines((pr) => {
    const nl = [...pr];
    nl[cur.line] = l.slice(0, p[0] + 1) + l.slice(p[1]);
    return nl;
  });
  ctx.setCursor({ ...cur, col: p[0] + 1 });
}

export function changeInsidePair(ctx: VimCtx, o: string, c: string) {
  deleteInsidePair(ctx, o, c);
  ctx.setVimMode("INSERT");
}

export function deleteAroundPair(ctx: VimCtx, o: string, c: string) {
  const cur = ctx.cursorRef.current;
  const l = ctx.linesRef.current[cur.line] || "";
  const mp = findMatchingPair(l, cur.col, o, c);
  if (!mp) return;
  ctx.pushUndo();
  ctx.setYankReg(l.slice(mp[0], mp[1] + 1));
  ctx.setYankIsLine(false);
  ctx.setLines((pr) => {
    const nl = [...pr];
    nl[cur.line] = l.slice(0, mp[0]) + l.slice(mp[1] + 1);
    return nl;
  });
  ctx.setCursor({ ...cur, col: mp[0] });
}

export function changeAroundPair(ctx: VimCtx, o: string, c: string) {
  deleteAroundPair(ctx, o, c);
  ctx.setVimMode("INSERT");
}

export function yankInsidePair(ctx: VimCtx, o: string, c: string) {
  const cur = ctx.cursorRef.current;
  const l = ctx.linesRef.current[cur.line] || "";
  const mp = findMatchingPair(l, cur.col, o, c);
  if (mp) {
    ctx.setYankReg(l.slice(mp[0] + 1, mp[1]));
    ctx.setYankIsLine(false);
    ctx.flash("Yanked");
  }
}

// ━━━ Text Objects (diw/daw/ciw/caw/yiw/yaw) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function deleteWordRange(
  ctx: VimCtx,
  rangeFn: (l: string, c: number) => [number, number] | null
) {
  const cur = ctx.cursorRef.current;
  const l = ctx.linesRef.current[cur.line] || "";
  const range = rangeFn(l, cur.col);
  if (!range) return;
  ctx.pushUndo();
  const [s, e] = range;
  ctx.setYankReg(l.slice(s, e + 1));
  ctx.setYankIsLine(false);
  ctx.setLines((p) => {
    const nl = [...p];
    nl[cur.line] = l.slice(0, s) + l.slice(e + 1);
    return nl;
  });
  ctx.setCursor({
    ...cur,
    col: Math.min(s, Math.max(0, l.length - (e - s + 1) - 1)),
  });
}

export function deleteInnerWord(ctx: VimCtx) {
  deleteWordRange(ctx, getInnerWord);
}
export function deleteAWord(ctx: VimCtx) {
  deleteWordRange(ctx, getAWord);
}

export function changeInnerWord(ctx: VimCtx) {
  const cur = ctx.cursorRef.current;
  const l = ctx.linesRef.current[cur.line] || "";
  const range = getInnerWord(l, cur.col);
  if (!range) return;
  ctx.pushUndo();
  const [s, e] = range;
  ctx.setYankReg(l.slice(s, e + 1));
  ctx.setYankIsLine(false);
  ctx.setLines((p) => {
    const nl = [...p];
    nl[cur.line] = l.slice(0, s) + l.slice(e + 1);
    return nl;
  });
  ctx.setCursor({ ...cur, col: s });
  ctx.setVimMode("INSERT");
}

export function changeAWord(ctx: VimCtx) {
  const cur = ctx.cursorRef.current;
  const l = ctx.linesRef.current[cur.line] || "";
  const range = getAWord(l, cur.col);
  if (!range) return;
  ctx.pushUndo();
  const [s, e] = range;
  ctx.setYankReg(l.slice(s, e + 1));
  ctx.setYankIsLine(false);
  ctx.setLines((p) => {
    const nl = [...p];
    nl[cur.line] = l.slice(0, s) + l.slice(e + 1);
    return nl;
  });
  ctx.setCursor({ ...cur, col: s });
  ctx.setVimMode("INSERT");
}

export function yankInnerWord(ctx: VimCtx) {
  const cur = ctx.cursorRef.current;
  const l = ctx.linesRef.current[cur.line] || "";
  const range = getInnerWord(l, cur.col);
  if (!range) return;
  ctx.setYankReg(l.slice(range[0], range[1] + 1));
  ctx.setYankIsLine(false);
  ctx.flash("Yanked");
}

export function yankAWord(ctx: VimCtx) {
  const cur = ctx.cursorRef.current;
  const l = ctx.linesRef.current[cur.line] || "";
  const range = getAWord(l, cur.col);
  if (!range) return;
  ctx.setYankReg(l.slice(range[0], range[1] + 1));
  ctx.setYankIsLine(false);
  ctx.flash("Yanked");
}

// ━━━ Indent / Outdent ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function indentLine(ctx: VimCtx) {
  ctx.pushUndo();
  const cur = ctx.cursorRef.current;
  ctx.setLines((p) => {
    const nl = [...p];
    nl[cur.line] = "  " + nl[cur.line];
    return nl;
  });
  ctx.setCursor({ ...cur, col: cur.col + 2 });
  ctx.desiredCol.current = cur.col + 2;
}

export function outdentLine(ctx: VimCtx) {
  const cur = ctx.cursorRef.current;
  const l = ctx.linesRef.current[cur.line] || "";
  const stripped = l.replace(/^ {1,2}/, "");
  if (stripped === l) return;
  const removed = l.length - stripped.length;
  ctx.pushUndo();
  ctx.setLines((p) => {
    const nl = [...p];
    nl[cur.line] = stripped;
    return nl;
  });
  ctx.setCursor({ ...cur, col: Math.max(0, cur.col - removed) });
  ctx.desiredCol.current = Math.max(0, cur.col - removed);
}

export function indentLines(ctx: VimCtx, startL: number, endL: number) {
  ctx.pushUndo();
  ctx.setLines((p) => {
    const nl = [...p];
    for (let i = startL; i <= Math.min(endL, nl.length - 1); i++)
      nl[i] = "  " + nl[i];
    return nl;
  });
}

export function outdentLines(ctx: VimCtx, startL: number, endL: number) {
  ctx.pushUndo();
  ctx.setLines((p) => {
    const nl = [...p];
    for (let i = startL; i <= Math.min(endL, nl.length - 1); i++)
      nl[i] = nl[i].replace(/^ {1,2}/, "");
    return nl;
  });
}

// ━━━ Visual Char ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function deleteSelection(ctx: VimCtx, anchor: Pos) {
  ctx.pushUndo();
  const cur = ctx.cursorRef.current;
  const s = posMin(anchor, cur),
    e = posMax(anchor, cur);
  ctx.setLines((p) => {
    const nl = [...p];
    if (s.line === e.line) {
      ctx.setYankReg(nl[s.line].slice(s.col, e.col + 1));
      ctx.setYankIsLine(false);
      nl[s.line] = nl[s.line].slice(0, s.col) + nl[s.line].slice(e.col + 1);
    } else {
      const ch = [nl[s.line].slice(s.col)];
      for (let i = s.line + 1; i < e.line; i++) ch.push(nl[i]);
      ch.push(nl[e.line].slice(0, e.col + 1));
      ctx.setYankReg(ch.join("\n"));
      ctx.setYankIsLine(false);
      nl[s.line] = nl[s.line].slice(0, s.col) + nl[e.line].slice(e.col + 1);
      nl.splice(s.line + 1, e.line - s.line);
    }
    return nl;
  });
  ctx.setCursor(posMin(anchor, cur));
  ctx.setVimMode("NORMAL");
  ctx.setVisualAnchor(null);
}

export function yankSelection(ctx: VimCtx, anchor: Pos) {
  const cur = ctx.cursorRef.current;
  const cl = ctx.linesRef.current;
  const s = posMin(anchor, cur),
    e = posMax(anchor, cur);
  if (s.line === e.line) {
    ctx.setYankReg(cl[s.line].slice(s.col, e.col + 1));
  } else {
    const ch = [cl[s.line].slice(s.col)];
    for (let i = s.line + 1; i < e.line; i++) ch.push(cl[i]);
    ch.push(cl[e.line].slice(0, e.col + 1));
    ctx.setYankReg(ch.join("\n"));
  }
  ctx.setYankIsLine(false);
  ctx.setCursor(posMin(anchor, cur));
  ctx.setVimMode("NORMAL");
  ctx.setVisualAnchor(null);
  ctx.flash("Yanked");
}

// ━━━ Visual Line ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function deleteLineSelection(
  ctx: VimCtx,
  anchorL: number,
  curL: number
) {
  ctx.pushUndo();
  const sL = Math.min(anchorL, curL),
    eL = Math.max(anchorL, curL);
  const cl = ctx.linesRef.current;
  ctx.setYankReg(cl.slice(sL, eL + 1).join("\n"));
  ctx.setYankIsLine(true);
  ctx.setLines((p) => {
    const nl = [...p];
    nl.splice(sL, eL - sL + 1);
    if (nl.length === 0) nl.push("");
    // Clamp cursor inside the callback where we know the final length
    const newLine = Math.min(sL, nl.length - 1);
    ctx.setCursor({
      line: newLine,
      col: Math.min(
        ctx.cursorRef.current.col,
        Math.max(0, (nl[newLine]?.length ?? 1) - 1)
      ),
    });
    return nl;
  });
  ctx.setVimMode("NORMAL");
  ctx.setVisualAnchor(null);
  ctx.setVisualLineAnchor(null);
}

export function yankLineSelection(ctx: VimCtx, anchorL: number, curL: number) {
  const sL = Math.min(anchorL, curL),
    eL = Math.max(anchorL, curL);
  ctx.setYankReg(ctx.linesRef.current.slice(sL, eL + 1).join("\n"));
  ctx.setYankIsLine(true);
  ctx.setCursor({ line: sL, col: 0 });
  ctx.setVimMode("NORMAL");
  ctx.setVisualAnchor(null);
  ctx.setVisualLineAnchor(null);
  ctx.flash("Yanked " + (eL - sL + 1) + " lines");
}

export function changeLineSelection(
  ctx: VimCtx,
  anchorL: number,
  curL: number
) {
  ctx.pushUndo();
  const sL = Math.min(anchorL, curL),
    eL = Math.max(anchorL, curL);
  ctx.setYankReg(ctx.linesRef.current.slice(sL, eL + 1).join("\n"));
  ctx.setYankIsLine(true);
  ctx.setLines((p) => {
    const nl = [...p];
    nl.splice(sL, eL - sL + 1, "");
    return nl;
  });
  ctx.setCursor({ line: sL, col: 0 });
  ctx.setVimMode("INSERT");
  ctx.setVisualAnchor(null);
  ctx.setVisualLineAnchor(null);
}

// ━━━ Paste (FIXED: respects yankIsLine for proper vim behavior) ━━━━━━━━━

export function pasteAfter(ctx: VimCtx, yankReg: string, yankIsLine: boolean) {
  if (!yankReg) return;
  ctx.pushUndo();
  const cur = ctx.cursorRef.current;

  if (yankIsLine) {
    // Line-wise paste: insert as new line(s) below
    const pasteLines = yankReg.split("\n");
    ctx.setLines((p) => {
      const nl = [...p];
      nl.splice(cur.line + 1, 0, ...pasteLines);
      return nl;
    });
    ctx.setCursor({ line: cur.line + 1, col: 0 });
  } else if (yankReg.includes("\n")) {
    // Multi-line char paste: split and insert properly
    const pasteLines = yankReg.split("\n");
    ctx.setLines((p) => {
      const nl = [...p];
      const before = nl[cur.line].slice(0, cur.col + 1);
      const after = nl[cur.line].slice(cur.col + 1);
      nl[cur.line] = before + pasteLines[0];
      const rest = pasteLines.slice(1);
      rest[rest.length - 1] += after;
      nl.splice(cur.line + 1, 0, ...rest);
      return nl;
    });
    ctx.setCursor({
      line: cur.line + yankReg.split("\n").length - 1,
      col: yankReg.split("\n").at(-1)?.length ?? 0,
    });
  } else {
    // Single-line char paste: inline after cursor
    ctx.setLines((p) => {
      const nl = [...p];
      nl[cur.line] =
        nl[cur.line].slice(0, cur.col + 1) +
        yankReg +
        nl[cur.line].slice(cur.col + 1);
      return nl;
    });
    ctx.setCursor({ ...cur, col: cur.col + yankReg.length });
  }
}

export function pasteBefore(ctx: VimCtx, yankReg: string, yankIsLine: boolean) {
  if (!yankReg) return;
  ctx.pushUndo();
  const cur = ctx.cursorRef.current;

  if (yankIsLine) {
    // Line-wise paste: insert as new line(s) above
    const pasteLines = yankReg.split("\n");
    ctx.setLines((p) => {
      const nl = [...p];
      nl.splice(cur.line, 0, ...pasteLines);
      return nl;
    });
    ctx.setCursor({ line: cur.line, col: 0 });
  } else if (yankReg.includes("\n")) {
    const pasteLines = yankReg.split("\n");
    ctx.setLines((p) => {
      const nl = [...p];
      const before = nl[cur.line].slice(0, cur.col);
      const after = nl[cur.line].slice(cur.col);
      nl[cur.line] = before + pasteLines[0];
      const rest = pasteLines.slice(1);
      rest[rest.length - 1] += after;
      nl.splice(cur.line + 1, 0, ...rest);
      return nl;
    });
    ctx.setCursor({
      line: cur.line + yankReg.split("\n").length - 1,
      col: (yankReg.split("\n").at(-1)?.length ?? 1) - 1,
    });
  } else {
    ctx.setLines((p) => {
      const nl = [...p];
      nl[cur.line] =
        nl[cur.line].slice(0, cur.col) + yankReg + nl[cur.line].slice(cur.col);
      return nl;
    });
    ctx.setCursor({ ...cur, col: cur.col + yankReg.length - 1 });
  }
}

// ━━━ Selection helpers ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function isSelected(
  anchor: Pos | null,
  cursor: Pos,
  li: number,
  ci: number
): boolean {
  if (!anchor) return false;
  const s = posMin(anchor, cursor),
    e = posMax(anchor, cursor);
  if (li < s.line || li > e.line) return false;
  if (li === s.line && li === e.line) return ci >= s.col && ci <= e.col;
  if (li === s.line) return ci >= s.col;
  if (li === e.line) return ci <= e.col;
  return true;
}

export function isLineSelected(
  anchorLine: number | null,
  cursorLine: number,
  lineIdx: number
): boolean {
  if (anchorLine === null) return false;
  const s = Math.min(anchorLine, cursorLine),
    e = Math.max(anchorLine, cursorLine);
  return lineIdx >= s && lineIdx <= e;
}

// ━━━ Count-aware operations ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Delete N lines from cursor position */
export function deleteNLines(ctx: VimCtx, count: number) {
  ctx.pushUndo();
  const cur = ctx.cursorRef.current;
  ctx.setLines((p) => {
    const nl = [...p];
    const endL = Math.min(cur.line + count - 1, nl.length - 1);
    const deleted = nl.splice(cur.line, endL - cur.line + 1);
    ctx.setYankReg(deleted.join("\n"));
    ctx.setYankIsLine(true);
    if (nl.length === 0) nl.push("");
    const newLine = Math.min(cur.line, nl.length - 1);
    ctx.setCursor({
      line: newLine,
      col: Math.min(cur.col, Math.max(0, (nl[newLine]?.length ?? 1) - 1)),
    });
    return nl;
  });
}

/** Yank N lines from cursor position */
export function yankNLines(ctx: VimCtx, count: number) {
  const cur = ctx.cursorRef.current;
  const cl = ctx.linesRef.current;
  const endL = Math.min(cur.line + count - 1, cl.length - 1);
  ctx.setYankReg(cl.slice(cur.line, endL + 1).join("\n"));
  ctx.setYankIsLine(true);
  ctx.flash("Yanked " + (endL - cur.line + 1) + " lines");
}

/** Change N lines from cursor position */
export function changeNLines(ctx: VimCtx, count: number) {
  ctx.pushUndo();
  const cur = ctx.cursorRef.current;
  ctx.setLines((p) => {
    const nl = [...p];
    const endL = Math.min(cur.line + count - 1, nl.length - 1);
    const deleted = nl.splice(cur.line, endL - cur.line + 1, "");
    ctx.setYankReg(deleted.join("\n"));
    ctx.setYankIsLine(true);
    return nl;
  });
  ctx.setCursor({ line: cur.line, col: 0 });
  ctx.setVimMode("INSERT");
}

/** Delete N words from cursor (repeats word delete N times) */
export function deleteNWords(ctx: VimCtx, count: number) {
  ctx.pushUndo();
  const cur = ctx.cursorRef.current;
  const cl = ctx.linesRef.current;
  let l = cl[cur.line] || "";
  let col = cur.col;
  let yanked = "";
  for (let i = 0; i < count; i++) {
    const end = nextWord(l, col);
    yanked += l.slice(col, end);
    l = l.slice(0, col) + l.slice(end);
    if (col >= l.length && col > 0) col = l.length - 1;
  }
  ctx.setYankReg(yanked);
  ctx.setYankIsLine(false);
  ctx.setLines((p) => {
    const nl = [...p];
    nl[cur.line] = l;
    return nl;
  });
  ctx.setCursor({ ...cur, col: Math.min(col, Math.max(0, l.length - 1)) });
}

/** Change N words (delete N words then enter INSERT) */
export function changeNWords(ctx: VimCtx, count: number) {
  deleteNWords(ctx, count);
  ctx.setVimMode("INSERT");
}

/** Delete N chars from cursor */
export function deleteNChars(ctx: VimCtx, count: number) {
  ctx.pushUndo();
  const cur = ctx.cursorRef.current;
  ctx.setLines((p) => {
    const nl = [...p];
    const l = nl[cur.line] || "";
    const end = Math.min(cur.col + count, l.length);
    nl[cur.line] = l.slice(0, cur.col) + l.slice(end);
    if (cur.col >= nl[cur.line].length && cur.col > 0)
      ctx.setCursor({ ...cur, col: nl[cur.line].length - 1 });
    return nl;
  });
}

/** Select all text (VISUAL_LINE from first to last line) */
export function selectAll(ctx: VimCtx) {
  const cl = ctx.linesRef.current;
  ctx.setVimMode("VISUAL_LINE");
  ctx.setVisualLineAnchor(0);
  ctx.setCursor({ line: cl.length - 1, col: 0 });
}
