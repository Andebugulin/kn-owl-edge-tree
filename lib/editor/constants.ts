import type { LinkType } from "./types";

// ━━━ Link Types ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export const LINK_TYPES: {
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

export const EDGE_COLORS: Record<string, string> = {
  parent: "#bf4070",
  reference: "#3d8b55",
  example: "#3d7a9e",
  contradiction: "#9e7a22",
};

export const EDGE_COLORS_BRIGHT: Record<string, string> = {
  parent: "#FF6B9D",
  reference: "#7ee787",
  example: "#79c0ff",
  contradiction: "#d29922",
};

// ━━━ Help Sections ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export const HELP_SECTIONS = [
  {
    title: "Navigation",
    items: [
      ["j / k", "Move down / up"],
      ["h / l", "Move left / right"],
      ["w / b / e", "Next / prev / end word"],
      ["W / B / E", "Next / prev / end WORD"],
      ["0 / $ / ^", "Line start / end / first char"],
      ["gg / G", "Document top / bottom"],
      ["{ / }", "Prev / next blank line"],
      ["f{c} / F{c}", "Find char forward / backward"],
      ["%", "Jump to matching bracket"],
    ],
  },
  {
    title: "Editing",
    items: [
      ["i / a / A / I", "Insert before / after / end / start"],
      ["o / O", "New line below / above"],
      ["s / S", "Substitute char / line"],
      ["dd / dw / D", "Delete line / word / to end"],
      ["diw / daw", "Delete inner / around word"],
      ["cc / cw / C", "Change line / word / to end"],
      ["ciw / caw", "Change inner / around word"],
      ['ci" ci( ci[', "Change inside pair"],
      ["x / r{c} / ~", "Delete / replace / toggle case"],
      ["J", "Join lines"],
      [">> / <<", "Indent / outdent line"],
      ["u / Ctrl+Z / Ctrl+R", "Undo / undo / redo"],
      ["v / V", "Visual char / line select"],
      ["Ctrl+A", "Select all (visual line)"],
      ["Ctrl+C", "Copy to clipboard"],
      ["Ctrl+V", "Paste from clipboard"],
      ["yy / yiw / p / P", "Yank line / word / paste"],
      ["{N}+cmd", "Repeat N times (e.g. 10j, 5dd, d3w)"],
    ],
  },
  {
    title: "Markdown",
    items: [
      ["# / ## / ###", "Headings"],
      ["**bold** / *italic*", "Bold / italic"],
      ["__italic__", "Underscore italic"],
      ["***bold italic***", "Bold + italic"],
      ["==highlight==", "Highlighted text"],
      ["~~strikethrough~~", "Strikethrough"],
      ["`code`", "Inline code"],
      ["[[link]]", "Wiki link"],
      ["> quote", "Blockquote"],
      ["- / *", "Bullet points (indent works)"],
    ],
  },
  {
    title: "App",
    items: [
      ["Space", "Open link panel"],
      ["g", "Toggle graph / notes view"],
      ["q", "Close note → list"],
      ["n", "Create new node"],
      ["dd", "Delete node (in list)"],
      ["/", "Search nodes"],
      ["Ctrl+S", "Save current note"],
      ["Esc", "Exit mode"],
      ["[[", "Wiki-link autocomplete"],
      ["?", "This help panel"],
    ],
  },
  {
    title: "Link Panel",
    items: [
      ["h / l", "Change link type"],
      ["j / k", "Navigate sections"],
      ["f", "Focus filter input"],
      ["d", "Delete connection"],
      ["Enter / Space", "Create link"],
      ["Esc", "Close panel"],
    ],
  },
];
