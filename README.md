<p align="center">
  <img src="icon.png" alt="Inkwell MD" width="128" height="128" />
</p>

<h1 align="center">Inkwell MD</h1>

<p align="center">
  A clean, distraction-free Markdown editor built with Tauri v2 + React.
  <br />
  Write, preview, and navigate your documents with elegance.
</p>

---

## Features

**Three View Modes** — Switch seamlessly between Reading (rendered preview), Split (side-by-side editor + live preview), and Editor (pure source editing) modes to match your workflow.

**Live Markdown Rendering** — Powered by `react-markdown` with `remark-gfm` for full GitHub Flavored Markdown support, including tables, task lists, strikethrough, and autolinks.

**Inline HTML Support** — Renders raw HTML embedded within Markdown via `rehype-raw`. Also supports opening and previewing standalone `.html` files directly.

**Smart Table of Contents** — Auto-generated TOC panel with click-to-jump navigation and real-time scroll spy highlighting. Heading IDs are generated using `github-slugger` for 100% accuracy with `rehype-slug`.

**File Browser** — Tree view with expandable folders, plus a flat path view optimized for deep directory structures. Search automatically switches to flat view for better results.

**Open Files & Folders** — Load local `.md`, `.markdown`, `.html`, and `.htm` files via system file picker. Open entire folders with directory structure preserved.

**Command Palette** — Press `Cmd+K` to search files and execute commands instantly, inspired by VS Code's command palette.

**Formatting Toolbar** — Quick-insert Bold, Italic, Code, Links, Headings (H1-H3), Blockquotes, Lists, and Dividers in edit and split modes.

**Light & Dark Themes** — Seed-token driven design system with smooth transitions. Toggle with `Cmd+/`.

**Tab Management** — Multi-tab interface for working with multiple documents simultaneously.

**Status Bar** — Shows current file name, line count, word count, and file type (Markdown / HTML).

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+O` | Open file |
| `Cmd+Shift+O` | Open folder |
| `Cmd+E` | Cycle view modes (Read → Split → Edit) |
| `Cmd+B` | Toggle sidebar |
| `Cmd+K` | Command palette |
| `Cmd+/` | Toggle theme |

## Tech Stack

- **Tauri v2** — Lightweight desktop runtime (Rust backend)
- **React 18** — UI framework
- **Vite** — Build tool with HMR
- **react-markdown** — Markdown rendering
- **remark-gfm** — GitHub Flavored Markdown
- **rehype-slug** — Auto heading IDs
- **rehype-raw** — Inline HTML rendering
- **github-slugger** — TOC heading ID generation
- **lucide-react** — Icon library

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/tools/install) (for Tauri)

### Development

```bash
# Clone the repository
git clone https://github.com/bitshift-byte/md-reader.git
cd md-reader

# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build
```

## Project Structure

```
md-reader/
├── src/
│   ├── App.jsx          # Main application component
│   ├── main.jsx         # React entry point
│   └── styles.css       # Design token system & component styles
├── icon.png             # Application icon
├── index.html           # HTML entry point
├── package.json         # Dependencies & scripts
└── vite.config.js       # Vite configuration
```

## Design System

Inkwell MD uses a seed-token CSS custom property system:

- `--seed-bg` / `--seed-fg` — Base background and foreground
- `--seed-primary` — Primary UI color
- `--seed-accent` — Accent color (teal)
- `--seed-surface` — Surface/elevated backgrounds
- `--seed-radius` — Border radius scale

All derived tokens (borders, shadows, text variants, hover states) are computed from seeds via `color-mix()` and `calc()`.

## License

MIT
