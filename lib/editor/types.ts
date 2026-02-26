// ━━━ Editor Types ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type Node = {
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

export type VimMode = "NORMAL" | "INSERT" | "VISUAL" | "VISUAL_LINE";
export type UIFocus = "list" | "editor";
export type LinkType =
  | "parent"
  | "child"
  | "reference"
  | "example"
  | "contradiction";
export type LinkerFocus = "conns" | "type" | "candidates" | "filter";
export type Pos = { line: number; col: number };
export type DocSnapshot = { lines: string[]; cursor: Pos };

/** Context object passed to vim actions so they can read/write state */
export type VimCtx = {
  linesRef: React.MutableRefObject<string[]>;
  cursorRef: React.MutableRefObject<Pos>;
  desiredCol: React.MutableRefObject<number>;
  setLines: React.Dispatch<React.SetStateAction<string[]>>;
  setCursor: React.Dispatch<React.SetStateAction<Pos>>;
  setVimMode: React.Dispatch<React.SetStateAction<VimMode>>;
  setYankReg: React.Dispatch<React.SetStateAction<string>>;
  setYankIsLine: React.Dispatch<React.SetStateAction<boolean>>;
  setVisualAnchor: React.Dispatch<React.SetStateAction<Pos | null>>;
  setVisualLineAnchor: React.Dispatch<React.SetStateAction<number | null>>;
  pushUndo: () => void;
  flash: (msg: string) => void;
};
