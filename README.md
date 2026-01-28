# Knowledge Tree Kn-🦉-⭕-🌳

A minimalist graph-based knowledge management system inspired by Zettelkasten methodology. Visualize and connect your thoughts in an interactive network.

## Idea

I would like to have simple ui/web tool, where i would manage my knowledge as a graph, kinda similar as zettlekasten, without using obsedian with millions of plugins.

## Overview

Knowledge Tree helps you build a personal knowledge base through interconnected notes. Each note becomes a node in your knowledge graph, with relationships that form meaningful connections between ideas and thoughts.

## Tech Stack

- **Frontend**: Next.js 15, React, TypeScript, TailwindCSS
- **Visualization**: Sigma.js with Graphology
- **Backend**: tRPC, Prisma ORM
- **Database**: PostgreSQL
- **Authentication**: NextAuth.js with credentials provider

## Getting Started

## Opened website

Web: [knowledge tree site](https://kn-owl-edge-tree.vercel.app/)

## Self hosting

### Prerequisites

- Node.js 18+
- PostgreSQL database
- npm or yarn

### Installation

1. Clone the repository

```bash
git clone https://github.com/Andebugulin/kn-owl-edge-tree.git
cd kn-owl-edge-tree
```

2. Install dependencies

```bash
npm install
```

3. Set up environment variables

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/knowledge_tree"
NEXTAUTH_SECRET="your-secret-key"
NEXTAUTH_URL="http://localhost:3000"
```

4. Initialize the database

```bash
npx prisma generate
npx prisma db push
```

5. Run the development server

```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000) to start building your knowledge tree.

## Usage

### Creating Nodes

- Click **New Node** in the top bar
- Enter a title and optional content
- Nodes support basic markdown formatting

### Connecting Ideas

1. Select a node to enter **Edit Mode**
2. Switch to **Link Mode**
3. Choose relationship type:
   - **Parent/Child** - Hierarchical connections (one parent per node)
   - **Reference** - Related concepts
   - **Example** - Concrete instances
   - **Contradiction** - Conflicting ideas
4. Click another node to create the connection

### Navigation

- **Click** - Select and edit nodes
- **Hover** - Preview node content
- **Search** - Find nodes by title or content
- **Drag** - Pan around the graph
- **Scroll** - Zoom in/out

## Project Structure

```
├── app/                    # Next.js app directory
│   ├── api/               # API routes (auth, tRPC)
│   ├── dashboard/         # Main application
│   └── (auth)/            # Authentication pages
├── components/            # React components
├── lib/                   # Utilities and configs
├── prisma/               # Database schema
├── server/               # tRPC routers and context
└── generated-prisma/     # Generated Prisma client
```

## Database Schema

**Node**

- Stores individual knowledge units
- Belongs to a user
- Contains title and content

**Edge**

- Connects two nodes
- Types: parent, reference, example, contradiction
- Cascade deletes with nodes

**User**

- Authentication and ownership
- Isolated knowledge graphs per user

## Contributing

Contributions are welcome!

## License

MIT License

## Made with ❤️

Claude AI was used to help with styling and some code snippets.
