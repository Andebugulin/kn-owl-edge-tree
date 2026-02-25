# Knowledge Tree Kn-🦉-⭕-🌳

A minimalist graph-based knowledge management system inspired by Zettelkasten methodology. Visualize and connect your thoughts in an interactive network.

## Idea

I would like to have simple ui/web tool, where i would manage my knowledge as a graph, kinda similar as zettlekasten, without using obsedian with millions of plugins.

## Overview

Knowledge Tree lets you build a personal knowledge base through interconnected notes. Each note is a node; relationships between them form a graph you can navigate, search, and explore — fully controllable via Vim keybindings.

## Tech Stack

- **Frontend**: Next.js 15, React, TypeScript, TailwindCSS
- **Visualization**: Sigma.js with Graphology
- **Backend**: tRPC, Prisma ORM
- **Database**: PostgreSQL
- **Authentication**: NextAuth.js with credentials provider

## Live

[kn-owl-edge-tree.vercel.app](https://kn-owl-edge-tree.vercel.app/)

## Self Hosting

### Prerequisites

- Node.js 18+
- PostgreSQL database
- npm

### Installation

```bash
git clone https://github.com/Andebugulin/kn-owl-edge-tree.git
cd kn-owl-edge-tree
npm install
cp .env.example .env
```

Edit `.env`:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/knowledge_tree"
NEXTAUTH_SECRET="your-secret-key"
NEXTAUTH_URL="http://localhost:3000"
```

```bash
npx prisma generate
npx prisma db push
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000).

---

## Usage

### Theme

Toggle between **dark** and **light** mode via the theme button in the top bar. Preference is persisted in `localStorage`.

---

### Vim Keybindings

The entire dashboard is keyboard-driven. Press `?` anywhere to open the in-app reference. There are three vim modes — **NORMAL**, **INSERT**, **VISUAL** — plus two UI contexts: **list** (node list) and **editor** (open note).

#### Node List

| Key            | Action                                   |
| -------------- | ---------------------------------------- |
| `j` / `k`      | Move down / up the list                  |
| `l` or `Enter` | Open selected node in editor             |
| `n`            | Create new node                          |
| `dd`           | Delete selected node (with confirmation) |
| `/`            | Search nodes by title or content         |
| `g` or `Tab`   | Toggle graph view                        |
| `?`            | Open keybinding help                     |

#### Editor — Normal Mode

| Key                   | Action                                                  |
| --------------------- | ------------------------------------------------------- |
| `h` / `l` / `j` / `k` | Move cursor left / right / down / up                    |
| `w` / `b` / `e`       | Next word / prev word / end of word                     |
| `0` / `$` / `^`       | Line start / end / first non-blank                      |
| `gg` / `G`            | Document top / bottom                                   |
| `f{c}` / `F{c}`       | Find char forward / backward on line                    |
| `i` / `a` / `A` / `I` | Insert before / after cursor / end of line / line start |
| `o` / `O`             | New line below / above, enter INSERT                    |
| `x`                   | Delete char under cursor                                |
| `r{c}`                | Replace char under cursor                               |
| `~`                   | Toggle case of char under cursor                        |
| `J`                   | Join line below onto current                            |
| `dd`                  | Delete (yank) line                                      |
| `D`                   | Delete to end of line                                   |
| `dw` / `de`           | Delete word                                             |
| `di"` `di(` `di[`     | Delete inside pair                                      |
| `yy`                  | Yank line                                               |
| `p` / `P`             | Paste after / before cursor                             |
| `cc` / `cw` / `C`     | Change line / word / to end of line                     |
| `ci"` `ci(` `ci[`     | Change inside pair                                      |
| `u` / `Ctrl+R`        | Undo / redo (50-level history)                          |
| `v`                   | Enter VISUAL mode                                       |
| `Space`               | Open link panel                                         |
| `q`                   | Save and return to list                                 |
| `n`                   | Save current note, create new node                      |
| `/`                   | Search nodes                                            |
| `g` / `Tab`           | Toggle graph view (single `g` with 350ms timeout)       |
| `Ctrl+S`              | Save current note                                       |
| `?`                   | Open keybinding help                                    |

#### Editor — Insert Mode

| Key                                | Action                                      |
| ---------------------------------- | ------------------------------------------- |
| `Esc`                              | Return to NORMAL, clamp cursor              |
| Arrow keys                         | Move cursor                                 |
| `Backspace` / `Delete`             | Delete char / forward-delete (merges lines) |
| `Enter`                            | Split line                                  |
| `Tab`                              | Insert two spaces                           |
| `[[`                               | Trigger wiki-link autocomplete              |
| `Tab` or `Enter` (in autocomplete) | Accept suggestion                           |
| `Ctrl+V` / `Cmd+V`                 | Paste from clipboard (multi-line aware)     |

#### Editor — Visual Mode

| Key                               | Action                            |
| --------------------------------- | --------------------------------- |
| `h` / `l` / `j` / `k` / `w` / `b` | Extend selection                  |
| `d` / `x`                         | Delete selection                  |
| `y`                               | Yank selection                    |
| `c`                               | Delete selection and enter INSERT |
| `Esc`                             | Cancel selection                  |

#### Link Panel (`Space`)

| Key                     | Action                                                                 |
| ----------------------- | ---------------------------------------------------------------------- |
| `h` / `l`               | Cycle link type (child · parent · reference · example · contradiction) |
| `j` / `k`               | Navigate vertically between sections                                   |
| `f` or `/`              | Focus the filter input                                                 |
| `Enter` or `Space`      | Create link to highlighted candidate                                   |
| `d` or `x`              | Delete existing connection                                             |
| `Enter` (on connection) | Jump to that node                                                      |
| `Esc`                   | Close panel                                                            |

#### Link Types & Rules

| Type            | Direction                      | Constraint                         |
| --------------- | ------------------------------ | ---------------------------------- |
| `parent`        | current node → parent          | one parent per node; no cycles     |
| `child`         | current node → child of target | child gains this node as parent    |
| `reference`     | bidirectional                  | at least one node must be isolated |
| `example`       | bidirectional                  | at least one node must be isolated |
| `contradiction` | bidirectional                  | at least one node must be isolated |

#### Wiki-links

Type `[[` in INSERT mode to trigger autocomplete against existing node titles. Selecting a suggestion inserts a `[[Node Title]]` link inline.

---

### Mouse (Graph View)

- **Click** — select node, jump to editor
- **Double-click** (empty space) — create node at position
- **Hover** — preview node content
- **Drag** — pan
- **Scroll** — zoom

---

## Project Structure

```
├── app/
│   ├── api/               # Auth & tRPC routes
│   ├── dashboard/         # Main application (page.tsx)
│   └── (auth)/            # Login / register
├── components/
│   └── GraphView.tsx      # Sigma.js graph renderer
├── lib/                   # Utilities and configs
├── prisma/                # Database schema
├── server/                # tRPC routers
└── generated-prisma/      # Generated Prisma client
```

## Database Schema

**Node** — individual knowledge unit (title, content, owner)

**Edge** — typed connection between two nodes (`parent`, `reference`, `example`, `contradiction`)

**User** — authentication and graph ownership; each user has an isolated knowledge graph

## Contributing

Contributions are welcome.

## License

MIT

---

Made by [Andrei Gulin](https://github.com/Andebugulin). Claude AI assisted with styling and code.
