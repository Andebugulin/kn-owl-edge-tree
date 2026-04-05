import type { JSX } from "react";

/**
 * Block-level formatting: headings, bullets (with indentation), blockquotes, hr
 */
export function renderFmt(t: string): {
  className?: string;
  content: (string | JSX.Element)[];
} {
  if (t.startsWith("### "))
    return {
      className: "text-[var(--text-primary)] font-bold text-[13px]",
      content: renderInl(t.slice(4)),
    };
  if (t.startsWith("## "))
    return {
      className: "text-[var(--text-primary)] font-bold text-[15px]",
      content: renderInl(t.slice(3)),
    };
  if (t.startsWith("# "))
    return {
      className: "text-[var(--text-primary)] font-bold text-[17px]",
      content: renderInl(t.slice(2)),
    };

  // Bullet points — preserve tab/space indentation
  const bulletMatch = t.match(/^(\s*)([-*])\s(.*)$/);
  if (bulletMatch) {
    const [, indent, , rest] = bulletMatch;
    const level = Math.floor(indent.replace(/\t/g, "  ").length / 2);
    const marginLeft = level * 16;
    return {
      content: [
        <span
          key="bi"
          style={{ display: "inline-block", width: marginLeft }}
        />,
        <span key="b" className="text-[var(--text-faint)]">
          {" "}
          •{" "}
        </span>,
        ...renderInl(rest),
      ],
    };
  }

  // Horizontal rule
  if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(t))
    return {
      content: [
        <span
          key="hr"
          className="block border-t border-[var(--text-faint)] my-1 opacity-30"
        />,
      ],
    };

  // Blockquote
  if (t.startsWith("> "))
    return {
      className:
        "border-l-2 border-[var(--text-faint)] pl-3 text-[var(--text-secondary)] italic",
      content: renderInl(t.slice(2)),
    };

  if (t.trim() === "") return { content: ["\u00A0"] };
  return { content: renderInl(t) };
}

/**
 * Inline formatting: ***bold italic***, **bold**, *italic*, __italic__,
 * `code`, [[wiki links]], ==highlight==, ~~strikethrough~~
 */
export function renderInl(t: string): (string | JSX.Element)[] {
  const o: (string | JSX.Element)[] = [];
  let k = 0;
  // Regex order matters: longest/most specific first
  const re =
    /(\*\*\*(.+?)\*\*\*)|(\*\*(.+?)\*\*)|(\*(.+?)\*)|(__(.+?)__)|(`(.+?)`)|(\[\[(.+?)\]\])|(==(.+?)==)|(~~(.+?)~~)/g;
  let li = 0,
    m;
  while ((m = re.exec(t)) !== null) {
    if (m.index > li) o.push(t.slice(li, m.index));
    if (m[1])
      // ***bold italic***
      o.push(
        <span key={k++} className="text-[var(--text-primary)] font-bold italic">
          {m[2]}
        </span>
      );
    else if (m[3])
      // **bold**
      o.push(
        <span key={k++} className="text-[var(--text-primary)] font-bold">
          {m[4]}
        </span>
      );
    else if (m[5])
      // *italic*
      o.push(
        <span key={k++} className="text-[var(--text-primary)] italic">
          {m[6]}
        </span>
      );
    else if (m[7])
      // __italic__
      o.push(
        <span key={k++} className="text-[var(--text-primary)] italic">
          {m[8]}
        </span>
      );
    else if (m[9])
      // `code`
      o.push(
        <code
          key={k++}
          className="bg-[var(--code-bg)] text-[var(--code-text)] px-1 rounded"
        >
          {m[10]}
        </code>
      );
    else if (m[11])
      // [[wiki link]]
      o.push(
        <span
          key={k++}
          className="text-[var(--link-color)] underline decoration-[var(--link-color)]/30"
        >
          [[{m[12]}]]
        </span>
      );
    else if (m[13])
      // ==highlight==
      o.push(
        <mark
          key={k++}
          className="bg-yellow-500/25 text-[var(--text-primary)] rounded-sm px-0.5"
        >
          {m[14]}
        </mark>
      );
    else if (m[15])
      // ~~strikethrough~~
      o.push(
        <span key={k++} className="line-through text-[var(--text-faint)]">
          {m[16]}
        </span>
      );
    li = m.index + m[0].length;
  }
  if (li < t.length) o.push(t.slice(li));
  return o.length > 0 ? o : [t];
}
