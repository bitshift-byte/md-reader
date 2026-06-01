import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import rehypeRaw from "rehype-raw";
import GithubSlugger from "github-slugger";
import {
  FileText, FolderOpen, Folder, ChevronRight, ChevronDown,
  PanelLeftClose, PanelLeft, List, Eye, PenLine, Columns,
  Moon, Sun, Search, BookOpen, X, Bold, Italic, Link,
  Code, Heading1, Heading2, Heading3, Quote, ListOrdered,
  Command, Minus, FolderPlus, FilePlus, LayoutList, GitBranch
} from "lucide-react";

/* ═══════════════════════════════════════════════════
   Mock Data — File tree & sample content
   ═══════════════════════════════════════════════════ */

const INITIAL_FILE_TREE = [
  {
    id: "f1", type: "folder", name: "docs",
    children: [
      {
        id: "f1-1", type: "folder", name: "guides",
        children: [
          { id: "f1-1-1", type: "file", name: "getting-started.md" },
          { id: "f1-1-2", type: "file", name: "configuration.md" },
          { id: "f1-1-3", type: "file", name: "deployment.md" },
        ]
      },
      { id: "f1-2", type: "file", name: "README.md" },
      { id: "f1-3", type: "file", name: "changelog.md" },
    ]
  },
  {
    id: "f2", type: "folder", name: "notes",
    children: [
      { id: "f2-1", type: "file", name: "meeting-2026-05-28.md" },
      { id: "f2-2", type: "file", name: "ideas.md" },
    ]
  },
  { id: "f3", type: "file", name: "TODO.md" },
];

const SAMPLE_MARKDOWN = `# Inkwell Markdown Editor

A clean, minimal writing environment for your Markdown documents.

## Getting Started

Inkwell provides a distraction-free space for writing and reading Markdown. The three-panel layout keeps everything organized: your **file browser** on the left, the **editor or preview** in the center, and an optional **table of contents** on the right.

> "The best writing tools disappear. They let you focus entirely on your thoughts, translating ideas to text without friction."

## Features

### File Browser

Navigate your project's Markdown files with a familiar tree structure. Folders expand and collapse with a single click, and file types are clearly distinguished with icons.

### Multiple View Modes

Switch between three views depending on your workflow:

- **Reading Mode** — Full-width rendered preview, perfect for reviewing documents
- **Split Mode** — Side-by-side editor and preview for live editing
- **Editor Mode** — Pure source editing for focused writing

### Typography & Rendering

Inkwell renders your Markdown with careful attention to typography. Headings use tight letter-spacing, body text is set at an optimal reading width, and code blocks use a monospace typeface that remains readable.

## Markdown Examples

### Code Blocks

\`\`\`rust
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let window = app.get_window("main").unwrap();
            window.set_title("Inkwell MD").unwrap();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
\`\`\`

### Tables

| Shortcut | Action | Description |
|----------|--------|-------------|
| \`Cmd+O\` | Open | Open a file from disk |
| \`Cmd+S\` | Save | Save the current document |
| \`Cmd+E\` | Toggle View | Switch between read, split, and edit modes |
| \`Cmd+B\` | Sidebar | Show or hide the file browser sidebar |
| \`Cmd+K\` | Commands | Open the command palette |

### Lists

1. Organize your documents in nested folders
2. Use the table of contents to jump between sections
3. Switch themes for comfortable reading at any hour
   - Light theme for daytime writing
   - Dark theme for late-night sessions

### Text Formatting

You can write in **bold**, *italic*, or \`inline code\`. Links like [Tauri Documentation](https://tauri.app) are styled with a subtle underline that becomes prominent on hover.

---

### Blockquotes

> Writing is thinking. To write well is to think clearly.
>
> — William Zinsser, *On Writing Well*

## Why Inkwell?

Most Markdown editors try to do too much. They add toolbars, menus, and configuration panels that clutter the writing experience. Inkwell takes a different approach: **show only what you need, when you need it**.

The sidebar appears when you're navigating. The table of contents helps when documents get long. Everything else fades away, leaving you with nothing but your words.
`;

const ALTERNATE_MARKDOWN = `# Meeting Notes — May 28, 2026

## Attendees

- Alice Chen (Product)
- Bob Nakamura (Engineering)
- Clara Wu (Design)

## Discussion Points

### Q3 Roadmap

The team reviewed the proposed Q3 roadmap. Key decisions:

1. **Markdown rendering engine** — Migrate to a custom renderer for better CJK support
2. **Theme system** — Extend the seed-token approach to support user-defined themes
3. **File watching** — Implement filesystem event monitoring via Tauri's native APIs

### Design Review

Clara presented the updated component library. Feedback focused on:

- Reducing visual noise in the sidebar
- Improving keyboard navigation between panels
- Adding a "focus mode" that hides all panels

> Action item: Clara to finalize the focus-mode interaction pattern by June 5.

## Next Steps

| Owner | Task | Due |
|-------|------|-----|
| Bob | Tauri v2 migration prototype | June 12 |
| Clara | Focus mode design spec | June 5 |
| Alice | User research summary | June 8 |
`;

function getMarkdownForFile(fileId) {
  if (fileId === "f2-1") return ALTERNATE_MARKDOWN;
  return SAMPLE_MARKDOWN;
}

/* ═══════════════════════════════════════════════════
   Extract headings for TOC — uses github-slugger
   to produce IDs identical to rehype-slug output
   ═══════════════════════════════════════════════════ */

function extractHeadings(md) {
  const headings = [];
  const lines = md.split("\n");
  let inCodeBlock = false;
  const slugger = new GithubSlugger();
  for (const line of lines) {
    if (line.startsWith("```")) { inCodeBlock = !inCodeBlock; continue; }
    if (inCodeBlock) continue;
    const match = line.match(/^(#{1,3})\s+(.+)/);
    if (match) {
      const rawText = match[2].replace(/[*`\[\]]/g, "");
      // github-slugger produces the same IDs as rehype-slug
      const id = slugger.slug(rawText);
      headings.push({
        level: match[1].length,
        text: rawText,
        id,
      });
    }
  }
  return headings;
}

/* ═══════════════════════════════════════════════════
   Flatten file tree for command palette navigation
   ═══════════════════════════════════════════════════ */

function flattenFiles(nodes, path = "") {
  const result = [];
  for (const node of nodes) {
    const fullPath = path ? `${path}/${node.name}` : node.name;
    if (node.type === "file") {
      result.push({ id: node.id, name: node.name, path: fullPath, type: "file" });
    }
    if (node.children) {
      const childFiles = flattenFiles(node.children, fullPath);
      result.push({
        id: node.id,
        name: node.name,
        path: fullPath,
        type: "folder",
        fileCount: childFiles.filter(c => c.type === "file").length,
      });
      result.push(...childFiles);
    }
  }
  return result;
}

/* ═══════════════════════════════════════════════════
   File Tree Component
   ═══════════════════════════════════════════════════ */

function FileTreeItem({ node, depth, selectedId, onSelect, expandedIds, onToggle, ...qoderProps }) {
  const isFolder = node.type === "folder";
  const isExpanded = expandedIds.has(node.id);
  const isSelected = selectedId === node.id;

  const handleClick = () => {
    if (isFolder) {
      onToggle(node.id);
    } else {
      onSelect(node.id, node.name);
    }
  };

  return (
    <div className={["tree-group", qoderProps?.className].filter(Boolean).join(" ")} style={qoderProps?.style} data-qoder-id={qoderProps?.["data-qoder-id"]} data-qoder-source={qoderProps?.["data-qoder-source"]}>
      <div
        className={`tree-item ${isFolder ? "tree-item--folder" : ""} ${isSelected ? "tree-item--active" : ""}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={handleClick}
        role="treeitem"
        aria-expanded={isFolder ? isExpanded : undefined}
        data-component="file-tree-item"
       data-qoder-id="qel-file-tree-item-0377c0dc" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-file-tree-item-0377c0dc&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;FileTreeItem&quot;,&quot;elementRole&quot;:&quot;file-tree-item&quot;,&quot;loc&quot;:{&quot;line&quot;:228,&quot;column&quot;:7}}">
        <span className="tree-item__icon" data-qoder-id="qel-tree-item__icon-902dd772" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-tree-item__icon-902dd772&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;FileTreeItem&quot;,&quot;elementRole&quot;:&quot;tree-item__icon&quot;,&quot;loc&quot;:{&quot;line&quot;:236,&quot;column&quot;:9}}">
          {isFolder ? (
            isExpanded ? <ChevronDown size={14}  data-qoder-id="qel-chevrondown-cf397b6c" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-chevrondown-cf397b6c&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;FileTreeItem&quot;,&quot;elementRole&quot;:&quot;chevrondown&quot;,&quot;loc&quot;:{&quot;line&quot;:238,&quot;column&quot;:26}}"/> : <ChevronRight size={14}  data-qoder-id="qel-chevronright-14e2673d" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-chevronright-14e2673d&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;FileTreeItem&quot;,&quot;elementRole&quot;:&quot;chevronright&quot;,&quot;loc&quot;:{&quot;line&quot;:238,&quot;column&quot;:54}}"/>
          ) : null}
        </span>
        <span className="tree-item__file-icon" data-qoder-id="qel-tree-item__file-icon-251976a0" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-tree-item__file-icon-251976a0&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;FileTreeItem&quot;,&quot;elementRole&quot;:&quot;tree-item__file-icon&quot;,&quot;loc&quot;:{&quot;line&quot;:241,&quot;column&quot;:9}}">
          {isFolder ? (
            isExpanded ? <FolderOpen size={14}  data-qoder-id="qel-folderopen-0bfb4cf9" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-folderopen-0bfb4cf9&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;FileTreeItem&quot;,&quot;elementRole&quot;:&quot;folderopen&quot;,&quot;loc&quot;:{&quot;line&quot;:243,&quot;column&quot;:26}}"/> : <Folder size={14}  data-qoder-id="qel-folder-61159c34" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-folder-61159c34&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;FileTreeItem&quot;,&quot;elementRole&quot;:&quot;folder&quot;,&quot;loc&quot;:{&quot;line&quot;:243,&quot;column&quot;:53}}"/>
          ) : (
            <FileText size={14}  data-qoder-id="qel-filetext-ed359359" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-filetext-ed359359&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;FileTreeItem&quot;,&quot;elementRole&quot;:&quot;filetext&quot;,&quot;loc&quot;:{&quot;line&quot;:245,&quot;column&quot;:13}}"/>
          )}
        </span>
        <span className="tree-item__label" data-qoder-id="qel-tree-item__label-ad64c311" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-tree-item__label-ad64c311&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;FileTreeItem&quot;,&quot;elementRole&quot;:&quot;tree-item__label&quot;,&quot;loc&quot;:{&quot;line&quot;:248,&quot;column&quot;:9}}">{node.name}</span>
      </div>
      {isFolder && node.children && (
        <div className={`tree-group__children ${!isExpanded ? "tree-group__children--collapsed" : ""}`} data-qoder-id="qel-div-fe2112b6" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-div-fe2112b6&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;FileTreeItem&quot;,&quot;elementRole&quot;:&quot;div&quot;,&quot;loc&quot;:{&quot;line&quot;:251,&quot;column&quot;:9}}">
          {node.children.map(child => (
            <FileTreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              expandedIds={expandedIds}
              onToggle={onToggle}
             data-qoder-id="qel-filetreeitem-db7547f5" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-filetreeitem-db7547f5&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;FileTreeItem&quot;,&quot;elementRole&quot;:&quot;filetreeitem&quot;,&quot;loc&quot;:{&quot;line&quot;:253,&quot;column&quot;:13}}"/>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   Flat File List (Path View) — with folder headers
   ═══════════════════════════════════════════════════ */

function FlatFileList({ files, selectedId, onSelect, searchQuery, ...qoderProps }) {
  const [expandedFolders, setExpanded] = useState(new Set());

  const toggleFolder = useCallback((folderId) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }, []);

  // Auto-expand all folders when searching
  useEffect(() => {
    if (searchQuery?.trim()) {
      const allFolderIds = files.filter(f => f.type === "folder").map(f => f.id);
      setExpanded(new Set(allFolderIds));
    }
  }, [searchQuery, files]);

  // Build ordered tree: top-level folders/files, then children under expanded folders
  const visibleItems = useMemo(() => {
    const q = searchQuery?.trim().toLowerCase() || "";
    const result = [];

    function addChildren(items, parentPath) {
      for (const item of items) {
        if (item.type === "folder") {
          // Check if any child file matches the search
          const childFiles = files.filter(
            f => f.type === "file" && f.path.startsWith(item.path + "/")
          );
          const hasMatchingChildren = q
            ? childFiles.some(f => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q))
            : true;
          const folderMatches = q && item.name.toLowerCase().includes(q);

          if (hasMatchingChildren || folderMatches || !q) {
            result.push({ ...item, isFolderHeader: true });
            if (expandedFolders.has(item.id)) {
              const children = files.filter(
                f => f.path.startsWith(item.path + "/") && f.path.split("/").length === item.path.split("/").length + 1
              );
              addChildren(children, item.path);
            }
          }
        } else {
          const matches = q
            ? item.name.toLowerCase().includes(q) || item.path.toLowerCase().includes(q)
            : true;
          if (matches) result.push(item);
        }
      }
    }

    // Get top-level items (files/folders at root)
    const topLevelPaths = new Set();
    for (const f of files) {
      const rootName = f.path.split("/")[0];
      topLevelPaths.add(rootName);
    }
    const topLevel = files.filter(f => {
      const parts = f.path.split("/");
      return parts.length === 1 || (f.type === "folder" && !files.some(p => p.type === "folder" && f.path.startsWith(p.path + "/")));
    });

    addChildren(topLevel, "");
    return result;
  }, [files, searchQuery, expandedFolders]);

  if (visibleItems.length === 0) {
    return <div className={["flat-list__empty", qoderProps?.className].filter(Boolean).join(" ")} style={qoderProps?.style} data-qoder-id={qoderProps?.["data-qoder-id"]} data-qoder-source={qoderProps?.["data-qoder-source"]}>No files found</div>;
  }

  return (
    <div className={["flat-list", qoderProps?.className].filter(Boolean).join(" ")} style={qoderProps?.style} data-qoder-id={qoderProps?.["data-qoder-id"]} data-qoder-source={qoderProps?.["data-qoder-source"]}>
      {visibleItems.map((item) => {
        if (item.isFolderHeader) {
          const isExpanded = expandedFolders.has(item.id);
          const depth = item.path.split("/").length - 1;
          return (
            <button
              key={`folder-${item.id}`}
              className="flat-list__folder"
              style={{ paddingLeft: `${depth * 12 + 8}px` }}
              onClick={() => toggleFolder(item.id)}
              data-component="flat-folder-header"
             data-qoder-id="qel-flat-folder-header-621a6592" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-flat-folder-header-621a6592&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;FlatFileList&quot;,&quot;elementRole&quot;:&quot;flat-folder-header&quot;,&quot;loc&quot;:{&quot;line&quot;:362,&quot;column&quot;:13}}">
              {isExpanded ? <ChevronDown size={12}  data-qoder-id="qel-chevrondown-ac7edaf3" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-chevrondown-ac7edaf3&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;FlatFileList&quot;,&quot;elementRole&quot;:&quot;chevrondown&quot;,&quot;loc&quot;:{&quot;line&quot;:369,&quot;column&quot;:29}}"/> : <ChevronRight size={12}  data-qoder-id="qel-chevronright-ab390206" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-chevronright-ab390206&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;FlatFileList&quot;,&quot;elementRole&quot;:&quot;chevronright&quot;,&quot;loc&quot;:{&quot;line&quot;:369,&quot;column&quot;:57}}"/>}
              {isExpanded ? <FolderOpen size={13}  data-qoder-id="qel-folderopen-5a81af21" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-folderopen-5a81af21&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;FlatFileList&quot;,&quot;elementRole&quot;:&quot;folderopen&quot;,&quot;loc&quot;:{&quot;line&quot;:370,&quot;column&quot;:29}}"/> : <Folder size={13}  data-qoder-id="qel-folder-163862ee" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-folder-163862ee&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;FlatFileList&quot;,&quot;elementRole&quot;:&quot;folder&quot;,&quot;loc&quot;:{&quot;line&quot;:370,&quot;column&quot;:56}}"/>}
              <span className="flat-list__folder-name" data-qoder-id="qel-flat-list__folder-name-a555bfda" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-flat-list__folder-name-a555bfda&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;FlatFileList&quot;,&quot;elementRole&quot;:&quot;flat-list__folder-name&quot;,&quot;loc&quot;:{&quot;line&quot;:371,&quot;column&quot;:15}}">{item.name}</span>
              <span className="flat-list__folder-count" data-qoder-id="qel-flat-list__folder-count-486afa97" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-flat-list__folder-count-486afa97&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;FlatFileList&quot;,&quot;elementRole&quot;:&quot;flat-list__folder-count&quot;,&quot;loc&quot;:{&quot;line&quot;:372,&quot;column&quot;:15}}">{item.fileCount}</span>
            </button>
          );
        }

        const depth = item.path.split("/").length - 1;
        return (
          <button
            key={item.id}
            className={`flat-list__item ${selectedId === item.id ? "flat-list__item--active" : ""}`}
            style={{ paddingLeft: `${depth * 12 + 24}px` }}
            onClick={() => onSelect(item.id, item.name)}
            data-component="flat-file-item"
           data-qoder-id="qel-flat-file-item-6b744148" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-flat-file-item-6b744148&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;FlatFileList&quot;,&quot;elementRole&quot;:&quot;flat-file-item&quot;,&quot;loc&quot;:{&quot;line&quot;:379,&quot;column&quot;:11}}">
            <FileText size={13} className="flat-list__item-icon"  data-qoder-id="qel-flat-list__item-icon-77d37ffb" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-flat-list__item-icon-77d37ffb&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;FlatFileList&quot;,&quot;elementRole&quot;:&quot;flat-list__item-icon&quot;,&quot;loc&quot;:{&quot;line&quot;:386,&quot;column&quot;:13}}"/>
            <span className="flat-list__item-name" data-qoder-id="qel-flat-list__item-name-a60e8549" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-flat-list__item-name-a60e8549&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;FlatFileList&quot;,&quot;elementRole&quot;:&quot;flat-list__item-name&quot;,&quot;loc&quot;:{&quot;line&quot;:387,&quot;column&quot;:13}}">{item.name}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   Formatting Toolbar
   ═══════════════════════════════════════════════════ */

function FormattingToolbar({ editorRef, onContentChange, ...qoderProps }) {
  const insertFormatting = useCallback((before, after = "", defaultText = "") => {
    const textarea = editorRef?.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selected = text.substring(start, end) || defaultText;
    const newText = text.substring(0, start) + before + selected + after + text.substring(end);
    textarea.value = newText;
    textarea.focus();
    const cursorPos = start + before.length + selected.length;
    textarea.setSelectionRange(
      selected === defaultText ? start + before.length : cursorPos,
      selected === defaultText ? start + before.length + selected.length : cursorPos
    );
    if (onContentChange) onContentChange(newText);
  }, [editorRef, onContentChange]);

  const tools = [
    { icon: Bold, label: "Bold", action: () => insertFormatting("**", "**", "bold text") },
    { icon: Italic, label: "Italic", action: () => insertFormatting("*", "*", "italic text") },
    { icon: Code, label: "Inline code", action: () => insertFormatting("`", "`", "code") },
    { icon: Link, label: "Link", action: () => insertFormatting("[", "](url)", "link text") },
    { type: "divider" },
    { icon: Heading1, label: "Heading 1", action: () => insertFormatting("# ", "", "Heading") },
    { icon: Heading2, label: "Heading 2", action: () => insertFormatting("## ", "", "Heading") },
    { icon: Heading3, label: "Heading 3", action: () => insertFormatting("### ", "", "Heading") },
    { type: "divider" },
    { icon: Quote, label: "Blockquote", action: () => insertFormatting("> ", "", "Quote") },
    { icon: List, label: "Bullet list", action: () => insertFormatting("- ", "", "List item") },
    { icon: ListOrdered, label: "Numbered list", action: () => insertFormatting("1. ", "", "List item") },
    { icon: Minus, label: "Divider", action: () => insertFormatting("\n---\n", "", "") },
  ];

  return (
    <div className={["formatting-toolbar", qoderProps?.className].filter(Boolean).join(" ")} data-component="formatting-toolbar" style={qoderProps?.style} data-qoder-id={qoderProps?.["data-qoder-id"]} data-qoder-source={qoderProps?.["data-qoder-source"]}>
      {tools.map((tool, i) =>
        tool.type === "divider" ? (
          <span key={i} className="formatting-toolbar__divider"  data-qoder-id="qel-formatting-toolbar__divider-972b1458" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-formatting-toolbar__divider-972b1458&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;FormattingToolbar&quot;,&quot;elementRole&quot;:&quot;formatting-toolbar__divider&quot;,&quot;loc&quot;:{&quot;line&quot;:312,&quot;column&quot;:11}}"/>
        ) : (
          <button
            key={i}
            className="formatting-toolbar__btn"
            onClick={tool.action}
            title={tool.label}
            aria-label={tool.label}
            type="button"
           data-qoder-id="qel-formatting-toolbar__btn-b51129b8" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-formatting-toolbar__btn-b51129b8&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;FormattingToolbar&quot;,&quot;elementRole&quot;:&quot;formatting-toolbar__btn&quot;,&quot;loc&quot;:{&quot;line&quot;:314,&quot;column&quot;:11}}">
            <tool.icon size={14}  data-qoder-id="qel-tool-icon-0382f03b" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-tool-icon-0382f03b&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;FormattingToolbar&quot;,&quot;elementRole&quot;:&quot;tool-icon&quot;,&quot;loc&quot;:{&quot;line&quot;:322,&quot;column&quot;:13}}"/>
          </button>
        )
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   Command Palette (Cmd+K)
   ═══════════════════════════════════════════════════ */

function CommandPalette({ open, onClose, allFiles, onSelectFile, onAction }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const commands = useMemo(() => [
    { id: "open-file", label: "Open file from disk", icon: FilePlus, type: "action" },
    { id: "open-folder", label: "Open folder", icon: FolderPlus, type: "action" },
    { id: "theme-toggle", label: "Toggle theme", icon: Sun, type: "action" },
    { id: "view-read", label: "Switch to reading mode", icon: Eye, type: "action" },
    { id: "view-split", label: "Switch to split mode", icon: Columns, type: "action" },
    { id: "view-edit", label: "Switch to editor mode", icon: PenLine, type: "action" },
    { id: "toggle-sidebar", label: "Toggle sidebar", icon: PanelLeft, type: "action" },
    { id: "toggle-toc", label: "Toggle table of contents", icon: List, type: "action" },
  ], []);

  const filtered = useMemo(() => {
    if (!query.trim()) return { files: allFiles.slice(0, 5), commands };
    const q = query.toLowerCase();
    return {
      files: allFiles.filter(f =>
        f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)
      ),
      commands: commands.filter(c => c.label.toLowerCase().includes(q)),
    };
  }, [query, allFiles, commands]);

  if (!open) return null;

  return (
    <div className="palette-overlay" data-component="command-palette" onClick={onClose} data-qoder-id="qel-command-palette-db06aad7" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-command-palette-db06aad7&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;CommandPalette&quot;,&quot;elementRole&quot;:&quot;command-palette&quot;,&quot;loc&quot;:{&quot;line&quot;:370,&quot;column&quot;:5}}">
      <div className="palette" onClick={e => e.stopPropagation()} data-qoder-id="qel-palette-6b203efe" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-palette-6b203efe&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;CommandPalette&quot;,&quot;elementRole&quot;:&quot;palette&quot;,&quot;loc&quot;:{&quot;line&quot;:371,&quot;column&quot;:7}}">
        <div className="palette__input-wrapper" data-qoder-id="qel-palette__input-wrapper-0a1a35ef" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-palette__input-wrapper-0a1a35ef&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;CommandPalette&quot;,&quot;elementRole&quot;:&quot;palette__input-wrapper&quot;,&quot;loc&quot;:{&quot;line&quot;:372,&quot;column&quot;:9}}">
          <Command size={15} className="palette__input-icon"  data-qoder-id="qel-palette__input-icon-705d6c57" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-palette__input-icon-705d6c57&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;CommandPalette&quot;,&quot;elementRole&quot;:&quot;palette__input-icon&quot;,&quot;loc&quot;:{&quot;line&quot;:373,&quot;column&quot;:11}}"/>
          <input
            ref={inputRef}
            className="palette__input"
            type="text"
            placeholder="Search files or run commands..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Escape") onClose();
            }}
           data-qoder-id="qel-palette__input-cbf39ff9" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-palette__input-cbf39ff9&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;CommandPalette&quot;,&quot;elementRole&quot;:&quot;palette__input&quot;,&quot;loc&quot;:{&quot;line&quot;:374,&quot;column&quot;:11}}"/>
          <kbd className="palette__esc" data-qoder-id="qel-palette__esc-05a608a4" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-palette__esc-05a608a4&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;CommandPalette&quot;,&quot;elementRole&quot;:&quot;palette__esc&quot;,&quot;loc&quot;:{&quot;line&quot;:385,&quot;column&quot;:11}}">Esc</kbd>
        </div>
        <div className="palette__results" data-qoder-id="qel-palette__results-983da5a6" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-palette__results-983da5a6&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;CommandPalette&quot;,&quot;elementRole&quot;:&quot;palette__results&quot;,&quot;loc&quot;:{&quot;line&quot;:387,&quot;column&quot;:9}}">
          {filtered.commands.length > 0 && (
            <div className="palette__section" data-qoder-id="qel-palette__section-a61d428c" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-palette__section-a61d428c&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;CommandPalette&quot;,&quot;elementRole&quot;:&quot;palette__section&quot;,&quot;loc&quot;:{&quot;line&quot;:389,&quot;column&quot;:13}}">
              <div className="palette__section-label" data-qoder-id="qel-palette__section-label-192c1cf2" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-palette__section-label-192c1cf2&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;CommandPalette&quot;,&quot;elementRole&quot;:&quot;palette__section-label&quot;,&quot;loc&quot;:{&quot;line&quot;:390,&quot;column&quot;:15}}">Commands</div>
              {filtered.commands.map(cmd => (
                <button
                  key={cmd.id}
                  className="palette__item"
                  onClick={() => { onAction(cmd.id); onClose(); }}
                 data-qoder-id="qel-palette__item-f139427f" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-palette__item-f139427f&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;CommandPalette&quot;,&quot;elementRole&quot;:&quot;palette__item&quot;,&quot;loc&quot;:{&quot;line&quot;:392,&quot;column&quot;:17}}">
                  <cmd.icon size={14} className="palette__item-icon"  data-qoder-id="qel-palette__item-icon-84aaad77" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-palette__item-icon-84aaad77&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;CommandPalette&quot;,&quot;elementRole&quot;:&quot;palette__item-icon&quot;,&quot;loc&quot;:{&quot;line&quot;:397,&quot;column&quot;:19}}"/>
                  <span className="palette__item-label" data-qoder-id="qel-palette__item-label-faba8c60" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-palette__item-label-faba8c60&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;CommandPalette&quot;,&quot;elementRole&quot;:&quot;palette__item-label&quot;,&quot;loc&quot;:{&quot;line&quot;:398,&quot;column&quot;:19}}">{cmd.label}</span>
                </button>
              ))}
            </div>
          )}
          {filtered.files.length > 0 && (
            <div className="palette__section" data-qoder-id="qel-palette__section-ab1d4a6b" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-palette__section-ab1d4a6b&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;CommandPalette&quot;,&quot;elementRole&quot;:&quot;palette__section&quot;,&quot;loc&quot;:{&quot;line&quot;:404,&quot;column&quot;:13}}">
              <div className="palette__section-label" data-qoder-id="qel-palette__section-label-1029d030" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-palette__section-label-1029d030&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;CommandPalette&quot;,&quot;elementRole&quot;:&quot;palette__section-label&quot;,&quot;loc&quot;:{&quot;line&quot;:405,&quot;column&quot;:15}}">Files</div>
              {filtered.files.map(file => (
                <button
                  key={file.id}
                  className="palette__item"
                  onClick={() => { onSelectFile(file.id, file.name); onClose(); }}
                 data-qoder-id="qel-palette__item-ea36f8e3" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-palette__item-ea36f8e3&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;CommandPalette&quot;,&quot;elementRole&quot;:&quot;palette__item&quot;,&quot;loc&quot;:{&quot;line&quot;:407,&quot;column&quot;:17}}">
                  <FileText size={14} className="palette__item-icon"  data-qoder-id="qel-palette__item-icon-1bb022b7" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-palette__item-icon-1bb022b7&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;CommandPalette&quot;,&quot;elementRole&quot;:&quot;palette__item-icon&quot;,&quot;loc&quot;:{&quot;line&quot;:412,&quot;column&quot;:19}}"/>
                  <span className="palette__item-label" data-qoder-id="qel-palette__item-label-05bcdc48" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-palette__item-label-05bcdc48&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;CommandPalette&quot;,&quot;elementRole&quot;:&quot;palette__item-label&quot;,&quot;loc&quot;:{&quot;line&quot;:413,&quot;column&quot;:19}}">{file.name}</span>
                  <span className="palette__item-path" data-qoder-id="qel-palette__item-path-c45f2cfa" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-palette__item-path-c45f2cfa&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;CommandPalette&quot;,&quot;elementRole&quot;:&quot;palette__item-path&quot;,&quot;loc&quot;:{&quot;line&quot;:414,&quot;column&quot;:19}}">{file.path}</span>
                </button>
              ))}
            </div>
          )}
          {filtered.commands.length === 0 && filtered.files.length === 0 && (
            <div className="palette__empty" data-qoder-id="qel-palette__empty-5a8e0e44" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-palette__empty-5a8e0e44&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;CommandPalette&quot;,&quot;elementRole&quot;:&quot;palette__empty&quot;,&quot;loc&quot;:{&quot;line&quot;:420,&quot;column&quot;:13}}">No results found</div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   TOC Panel with Scroll Spy
   ═══════════════════════════════════════════════════ */

function TocPanel({ headings, visible, scrollContainerRef, ...qoderProps }) {
  const [activeId, setActiveId] = useState("");

  // Helper: find heading element by id (tries id first, then data-heading-id)
  const findHeadingEl = useCallback((id) => {
    return document.getElementById(id)
      || document.querySelector(`[data-heading-id="${id}"]`);
  }, []);

  // Scroll to heading within the content container
  const scrollToHeading = useCallback((id) => {
    const el = findHeadingEl(id);
    const container = scrollContainerRef?.current;
    if (el && container) {
      const containerRect = container.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const offset = elRect.top - containerRect.top + container.scrollTop - 12;
      container.scrollTo({ top: offset, behavior: "smooth" });
    }
  }, [findHeadingEl, scrollContainerRef]);

  useEffect(() => {
    const container = scrollContainerRef?.current;
    if (!container || headings.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter(e => e.isIntersecting);
        if (visible.length > 0) {
          const topmost = visible.reduce((a, b) =>
            a.boundingClientRect.top < b.boundingClientRect.top ? a : b
          );
          const id = topmost.target.getAttribute("data-heading-id") || topmost.target.id;
          setActiveId(id);
        }
      },
      {
        root: container,
        rootMargin: "-10% 0px -80% 0px",
        threshold: 0,
      }
    );

    headings.forEach(h => {
      const el = findHeadingEl(h.id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [headings, scrollContainerRef, findHeadingEl]);

  return (
    <aside className={[(`toc-panel ${!visible ? "toc-panel--hidden" : ""}`), qoderProps?.className].filter(Boolean).join(" ")} data-component="toc-panel" style={qoderProps?.style} data-qoder-id={qoderProps?.["data-qoder-id"]} data-qoder-source={qoderProps?.["data-qoder-source"]}>
      <div className="toc-panel__header" data-qoder-id="qel-toc-panel__header-7974d301" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-toc-panel__header-7974d301&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;TocPanel&quot;,&quot;elementRole&quot;:&quot;toc-panel__header&quot;,&quot;loc&quot;:{&quot;line&quot;:676,&quot;column&quot;:7}}">On this page</div>
      <nav className="toc-panel__list" aria-label="Table of contents" data-qoder-id="qel-table-of-contents-1a1149b7" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-table-of-contents-1a1149b7&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;TocPanel&quot;,&quot;elementRole&quot;:&quot;table-of-contents&quot;,&quot;loc&quot;:{&quot;line&quot;:677,&quot;column&quot;:7}}">
        {headings.map((h, i) => (
          <button
            key={i}
            className={`toc-item toc-item--h${h.level} ${activeId === h.id ? "toc-item--active" : ""}`}
            onClick={() => scrollToHeading(h.id)}
            data-component="toc-item"
           data-qoder-id="qel-toc-item-b3492c5a" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-toc-item-b3492c5a&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;TocPanel&quot;,&quot;elementRole&quot;:&quot;toc-item&quot;,&quot;loc&quot;:{&quot;line&quot;:679,&quot;column&quot;:11}}">
            {h.text}
          </button>
        ))}
      </nav>
    </aside>
  );
}

/* ═══════════════════════════════════════════════════
   Welcome State
   ═══════════════════════════════════════════════════ */

function WelcomeState({ onOpenFile, onOpenFolder, ...qoderProps }) {
  return (
    <div className={["welcome-state", qoderProps?.className].filter(Boolean).join(" ")} data-component="welcome-state" style={qoderProps?.style} data-qoder-id={qoderProps?.["data-qoder-id"]} data-qoder-source={qoderProps?.["data-qoder-source"]}>
      <BookOpen className="welcome-state__icon" strokeWidth={1.2}  data-qoder-id="qel-welcome-state__icon-5b886989" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-welcome-state__icon-5b886989&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;WelcomeState&quot;,&quot;elementRole&quot;:&quot;welcome-state__icon&quot;,&quot;loc&quot;:{&quot;line&quot;:493,&quot;column&quot;:7}}"/>
      <div className="welcome-state__title" data-qoder-id="qel-welcome-state__title-5fd98971" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-welcome-state__title-5fd98971&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;WelcomeState&quot;,&quot;elementRole&quot;:&quot;welcome-state__title&quot;,&quot;loc&quot;:{&quot;line&quot;:494,&quot;column&quot;:7}}">Inkwell</div>
      <div className="welcome-state__desc" data-qoder-id="qel-welcome-state__desc-a5d55561" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-welcome-state__desc-a5d55561&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;WelcomeState&quot;,&quot;elementRole&quot;:&quot;welcome-state__desc&quot;,&quot;loc&quot;:{&quot;line&quot;:495,&quot;column&quot;:7}}">
        A quiet place for your Markdown documents. Open a file or folder to get started.
      </div>
      <div className="welcome-state__actions" data-qoder-id="qel-welcome-state__actions-7c4e79b8" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-welcome-state__actions-7c4e79b8&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;WelcomeState&quot;,&quot;elementRole&quot;:&quot;welcome-state__actions&quot;,&quot;loc&quot;:{&quot;line&quot;:498,&quot;column&quot;:7}}">
        <button className="welcome-btn welcome-btn--primary" onClick={onOpenFolder} data-component="open-folder-btn" data-qoder-id="qel-open-folder-btn-9ccbd8a9" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-open-folder-btn-9ccbd8a9&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;WelcomeState&quot;,&quot;elementRole&quot;:&quot;open-folder-btn&quot;,&quot;loc&quot;:{&quot;line&quot;:499,&quot;column&quot;:9}}">
          <FolderPlus size={16}  data-qoder-id="qel-folderplus-476f75ae" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-folderplus-476f75ae&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;WelcomeState&quot;,&quot;elementRole&quot;:&quot;folderplus&quot;,&quot;loc&quot;:{&quot;line&quot;:500,&quot;column&quot;:11}}"/>
          Open Folder
        </button>
        <button className="welcome-btn" onClick={onOpenFile} data-component="open-file-btn" data-qoder-id="qel-open-file-btn-a1a1c601" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-open-file-btn-a1a1c601&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;WelcomeState&quot;,&quot;elementRole&quot;:&quot;open-file-btn&quot;,&quot;loc&quot;:{&quot;line&quot;:503,&quot;column&quot;:9}}">
          <FilePlus size={16}  data-qoder-id="qel-fileplus-8bf89d54" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-fileplus-8bf89d54&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;WelcomeState&quot;,&quot;elementRole&quot;:&quot;fileplus&quot;,&quot;loc&quot;:{&quot;line&quot;:504,&quot;column&quot;:11}}"/>
          Open File
        </button>
      </div>
      <div className="welcome-state__shortcuts" data-qoder-id="qel-welcome-state__shortcuts-b76a4773" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-welcome-state__shortcuts-b76a4773&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;WelcomeState&quot;,&quot;elementRole&quot;:&quot;welcome-state__shortcuts&quot;,&quot;loc&quot;:{&quot;line&quot;:508,&quot;column&quot;:7}}">
        <div className="shortcut-hint" data-qoder-id="qel-shortcut-hint-5bc2d914" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-shortcut-hint-5bc2d914&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;WelcomeState&quot;,&quot;elementRole&quot;:&quot;shortcut-hint&quot;,&quot;loc&quot;:{&quot;line&quot;:509,&quot;column&quot;:9}}">
          <kbd className="kbd" data-qoder-id="qel-kbd-fb0daf16" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-kbd-fb0daf16&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;WelcomeState&quot;,&quot;elementRole&quot;:&quot;kbd&quot;,&quot;loc&quot;:{&quot;line&quot;:510,&quot;column&quot;:11}}">Cmd+O</kbd> Open file
        </div>
        <div className="shortcut-hint" data-qoder-id="qel-shortcut-hint-5dc2dc3a" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-shortcut-hint-5dc2dc3a&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;WelcomeState&quot;,&quot;elementRole&quot;:&quot;shortcut-hint&quot;,&quot;loc&quot;:{&quot;line&quot;:512,&quot;column&quot;:9}}">
          <kbd className="kbd" data-qoder-id="qel-kbd-f90dabf0" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-kbd-f90dabf0&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;WelcomeState&quot;,&quot;elementRole&quot;:&quot;kbd&quot;,&quot;loc&quot;:{&quot;line&quot;:513,&quot;column&quot;:11}}">Cmd+Shift+O</kbd> Open folder
        </div>
        <div className="shortcut-hint" data-qoder-id="qel-shortcut-hint-57c2d2c8" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-shortcut-hint-57c2d2c8&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;WelcomeState&quot;,&quot;elementRole&quot;:&quot;shortcut-hint&quot;,&quot;loc&quot;:{&quot;line&quot;:515,&quot;column&quot;:9}}">
          <kbd className="kbd" data-qoder-id="qel-kbd-ff0db562" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-kbd-ff0db562&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;WelcomeState&quot;,&quot;elementRole&quot;:&quot;kbd&quot;,&quot;loc&quot;:{&quot;line&quot;:516,&quot;column&quot;:11}}">Cmd+K</kbd> Command palette
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   Main App
   ═══════════════════════════════════════════════════ */

export default function App(qoderProps) {
  const [theme, setTheme] = useState("light");
  const [viewMode, setViewMode] = useState("read");
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [tocVisible, setTocVisible] = useState(true);
  const [selectedFileId, setSelectedFileId] = useState("f1-2");
  const [selectedFileName, setSelectedFileName] = useState("README.md");
  const [editorContent, setEditorContent] = useState(SAMPLE_MARKDOWN);
  const [expandedFolders, setExpandedFolders] = useState(new Set(["f1", "f1-1", "user-opened"]));
  const [openTabs, setOpenTabs] = useState([
    { id: "f1-2", name: "README.md" },
    { id: "f2-1", name: "meeting-2026-05-28.md" },
  ]);
  const [activeTabId, setActiveTabId] = useState("f1-2");
  const [searchQuery, setSearchQuery] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [contentFade, setContentFade] = useState(false);
  const [sidebarView, setSidebarView] = useState("tree"); // "tree" | "flat"

  // File tree is now mutable — starts from initial mock data
  const [fileTree, setFileTree] = useState(INITIAL_FILE_TREE);
  // Store opened file contents: { fileId: markdownString }
  const [fileContents, setFileContents] = useState({});

  const editorRef = useRef(null);
  const readingRef = useRef(null);
  const previewRef = useRef(null);
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);

  const allFiles = useMemo(() => flattenFiles(fileTree), [fileTree]);

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  /* ── Open file from disk ─────────────────────────── */
  const handleOpenFile = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback((e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const newNodes = [];
    let loadCount = 0;

    files.forEach((file) => {
      const ext = file.name.split(".").pop().toLowerCase();
      if (!["md", "markdown", "html", "htm"].includes(ext)) return;
      const fileId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      newNodes.push({ id: fileId, type: "file", name: file.name });

      const reader = new FileReader();
      reader.onload = (ev) => {
        setFileContents(prev => ({ ...prev, [fileId]: ev.target.result }));
        loadCount++;
        // Auto-select the first file
        if (loadCount === 1) {
          setSelectedFileId(fileId);
          setSelectedFileName(file.name);
          setEditorContent(ev.target.result);
          setOpenTabs(prev => [...prev, { id: fileId, name: file.name }]);
          setActiveTabId(fileId);
        }
      };
      reader.onerror = () => {
        console.warn(`Failed to read file: ${file.name}`);
      };
      reader.readAsText(file);
    });

    if (newNodes.length > 0) {
      setFileTree(prev => {
        // Find or create "Opened Files" folder
        const existingIdx = prev.findIndex(n => n.id === "user-opened");
        if (existingIdx >= 0) {
          const updated = [...prev];
          updated[existingIdx] = {
            ...updated[existingIdx],
            children: [...(updated[existingIdx].children || []), ...newNodes],
          };
          return updated;
        }
        return [...prev, {
          id: "user-opened",
          type: "folder",
          name: "Opened Files",
          children: newNodes,
        }];
      });
      setExpandedFolders(prev => new Set([...prev, "user-opened"]));
    }

    // Reset input so same file can be re-opened
    e.target.value = "";
  }, []);

  /* ── Open folder ─────────────────────────────────── */
  const handleOpenFolder = useCallback(() => {
    folderInputRef.current?.click();
  }, []);

  const handleFolderInputChange = useCallback((e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const mdFiles = files.filter(f => {
      const ext = f.name.split(".").pop().toLowerCase();
      return ["md", "markdown", "html", "htm"].includes(ext);
    });
    if (mdFiles.length === 0) return;

    // Group by relative path
    const folderName = mdFiles[0].webkitRelativePath?.split("/")[0] || "Opened Folder";
    const folderId = `user-folder-${Date.now()}`;
    const children = [];
    const contents = {};

    let loaded = 0;
    mdFiles.forEach((file) => {
      const fileId = `${folderId}-${Math.random().toString(36).slice(2, 8)}`;
      const relPath = file.webkitRelativePath || file.name;
      const displayName = relPath.includes("/") ? relPath : file.name;

      children.push({ id: fileId, type: "file", name: file.name, displayPath: displayName });

      const reader = new FileReader();
      reader.onload = (ev) => {
        contents[fileId] = ev.target.result;
        loaded++;
        if (loaded === mdFiles.length) {
          setFileContents(prev => ({ ...prev, ...contents }));
          // Auto-select first file
          if (children.length > 0) {
            const first = children[0];
            setSelectedFileId(first.id);
            setSelectedFileName(first.name);
            setEditorContent(contents[first.id]);
            setOpenTabs(prev => [...prev, { id: first.id, name: first.name }]);
            setActiveTabId(first.id);
          }
        }
      };
      reader.onerror = () => {
        console.warn(`Failed to read file: ${file.name}`);
        loaded++;
        if (loaded === mdFiles.length) {
          const validContents = Object.fromEntries(
            Object.entries(contents).filter(([, v]) => v != null)
          );
          setFileContents(prev => ({ ...prev, ...validContents }));
          if (children.length > 0) {
            const first = children[0];
            setSelectedFileId(first.id);
            setSelectedFileName(first.name);
            setEditorContent(validContents[first.id] || "");
            setOpenTabs(prev => [...prev, { id: first.id, name: first.name }]);
            setActiveTabId(first.id);
          }
        }
      };
      reader.readAsText(file);
    });

    const newFolder = {
      id: folderId,
      type: "folder",
      name: folderName,
      children,
    };

    setFileTree(prev => [...prev, newFolder]);
    setExpandedFolders(prev => new Set([...prev, folderId]));

    e.target.value = "";
  }, []);

  /* ── Keyboard shortcuts ──────────────────────────── */
  useEffect(() => {
    const handler = (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.shiftKey && e.key === "O") {
        e.preventDefault();
        handleOpenFolder();
      } else if (mod && !e.shiftKey && e.key === "o") {
        e.preventDefault();
        handleOpenFile();
      }
      if (mod && e.key === "k") {
        e.preventDefault();
        setPaletteOpen(p => !p);
      }
      if (mod && e.key === "/") {
        e.preventDefault();
        setTheme(t => t === "light" ? "dark" : "light");
      }
      if (mod && e.key === "b") {
        e.preventDefault();
        setSidebarVisible(v => !v);
      }
      if (mod && e.key === "e") {
        e.preventDefault();
        setViewMode(m => m === "read" ? "split" : m === "split" ? "edit" : "read");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleOpenFile, handleOpenFolder]);

  /* ── Select a file ───────────────────────────────── */
  const handleSelectFile = useCallback((fileId, fileName) => {
    setContentFade(true);
    setTimeout(() => {
      setSelectedFileId(fileId);
      setSelectedFileName(fileName);
      // Use real file content if available, otherwise mock
      const content = fileContents[fileId] || getMarkdownForFile(fileId);
      setEditorContent(content);
      setOpenTabs(prev => {
        if (prev.find(t => t.id === fileId)) return prev;
        return [...prev, { id: fileId, name: fileName }];
      });
      setActiveTabId(fileId);
      setTimeout(() => setContentFade(false), 20);
    }, 120);
  }, [fileContents]);

  /* ── Toggle folder ───────────────────────────────── */
  const handleToggleFolder = useCallback((folderId) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }, []);

  /* ── Close tab ───────────────────────────────────── */
  const handleCloseTab = useCallback((e, tabId) => {
    e.stopPropagation();
    const next = openTabs.filter(t => t.id !== tabId);
    if (activeTabId === tabId && next.length > 0) {
      const idx = openTabs.findIndex(t => t.id === tabId);
      const newActive = next[Math.min(idx, next.length - 1)];
      setOpenTabs(next);
      setActiveTabId(newActive.id);
      setSelectedFileId(newActive.id);
      setSelectedFileName(newActive.name);
      setEditorContent(fileContents[newActive.id] || getMarkdownForFile(newActive.id));
    } else if (next.length === 0) {
      setOpenTabs([]);
      setSelectedFileId(null);
      setSelectedFileName(null);
    } else {
      setOpenTabs(next);
    }
  }, [activeTabId, fileContents, openTabs]);

  /* ── Switch tab ──────────────────────────────────── */
  const handleSwitchTab = useCallback((tab) => {
    setActiveTabId(tab.id);
    setSelectedFileId(tab.id);
    setSelectedFileName(tab.name);
    setEditorContent(fileContents[tab.id] || getMarkdownForFile(tab.id));
  }, [fileContents]);

  /* ── Command palette actions ─────────────────────── */
  const handlePaletteAction = useCallback((actionId) => {
    switch (actionId) {
      case "open-file": handleOpenFile(); break;
      case "open-folder": handleOpenFolder(); break;
      case "theme-toggle": setTheme(t => t === "light" ? "dark" : "light"); break;
      case "view-read": setViewMode("read"); break;
      case "view-split": setViewMode("split"); break;
      case "view-edit": setViewMode("edit"); break;
      case "toggle-sidebar": setSidebarVisible(v => !v); break;
      case "toggle-toc": setTocVisible(v => !v); break;
    }
  }, [handleOpenFile, handleOpenFolder]);

  /* ── Computed values ─────────────────────────────── */
  const headings = useMemo(() => extractHeadings(editorContent), [editorContent]);
  const wordCount = useMemo(() => {
    const text = editorContent.replace(/[#*`\[\]()>|_~-]/g, " ").trim();
    return text.split(/\s+/).filter(Boolean).length;
  }, [editorContent]);
  const lineCount = useMemo(() => editorContent.split("\n").length, [editorContent]);
  const filteredTree = useMemo(() => {
    if (!searchQuery.trim()) return fileTree;
    const q = searchQuery.toLowerCase();
    function filterNode(node) {
      if (node.type === "file") {
        return node.name.toLowerCase().includes(q) ? node : null;
      }
      if (node.children) {
        const filtered = node.children.map(filterNode).filter(Boolean);
        if (filtered.length > 0 || node.name.toLowerCase().includes(q)) {
          return { ...node, children: filtered };
        }
      }
      return null;
    }
    return fileTree.map(filterNode).filter(Boolean);
  }, [searchQuery, fileTree]);

  const toggleTheme = () => setTheme(t => t === "light" ? "dark" : "light");
  const activeScrollRef = viewMode === "read" ? readingRef : previewRef;
  const isHtmlFile = selectedFileName && /\.(html|htm)$/i.test(selectedFileName);

  return (
    <div className={["app-shell", qoderProps?.className].filter(Boolean).join(" ")} data-component="app-shell" style={qoderProps?.style} data-qoder-id={qoderProps?.["data-qoder-id"]} data-qoder-source={qoderProps?.["data-qoder-source"]}>
      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.markdown,.html,.htm"
        multiple
        style={{ display: "none" }}
        onChange={handleFileInputChange}
       data-qoder-id="qel-input-86e15d60" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-input-86e15d60&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;input&quot;,&quot;loc&quot;:{&quot;line&quot;:814,&quot;column&quot;:7}}"/>
      <input
        ref={folderInputRef}
        type="file"
        accept=".md,.markdown,.html,.htm"
        multiple
        webkitdirectory=""
        directory=""
        style={{ display: "none" }}
        onChange={handleFolderInputChange}
       data-qoder-id="qel-input-95e174fd" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-input-95e174fd&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;input&quot;,&quot;loc&quot;:{&quot;line&quot;:822,&quot;column&quot;:7}}"/>

      {/* ── Command Palette ──────────────────────────── */}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        allFiles={allFiles}
        onSelectFile={handleSelectFile}
        onAction={handlePaletteAction}
       data-qoder-id="qel-commandpalette-f114f10a" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-commandpalette-f114f10a&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;commandpalette&quot;,&quot;loc&quot;:{&quot;line&quot;:834,&quot;column&quot;:7}}"/>

      {/* ── Title Bar ──────────────────────────────── */}
      <header className="title-bar" data-component="title-bar" data-qoder-id="qel-title-bar-9471fcab" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-title-bar-9471fcab&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;title-bar&quot;,&quot;loc&quot;:{&quot;line&quot;:843,&quot;column&quot;:7}}">
        <div className="title-bar__traffic-lights" data-qoder-id="qel-title-bar__traffic-lights-1add7ae7" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-title-bar__traffic-lights-1add7ae7&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;title-bar__traffic-lights&quot;,&quot;loc&quot;:{&quot;line&quot;:844,&quot;column&quot;:9}}">
          <span className="traffic-light traffic-light--close"  data-qoder-id="qel-traffic-light-0d269cf0" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-traffic-light-0d269cf0&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;traffic-light&quot;,&quot;loc&quot;:{&quot;line&quot;:845,&quot;column&quot;:11}}"/>
          <span className="traffic-light traffic-light--minimize"  data-qoder-id="qel-traffic-light-0e269e83" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-traffic-light-0e269e83&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;traffic-light&quot;,&quot;loc&quot;:{&quot;line&quot;:846,&quot;column&quot;:11}}"/>
          <span className="traffic-light traffic-light--maximize"  data-qoder-id="qel-traffic-light-1326a662" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-traffic-light-1326a662&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;traffic-light&quot;,&quot;loc&quot;:{&quot;line&quot;:847,&quot;column&quot;:11}}"/>
        </div>

        <div className="title-bar__center" data-qoder-id="qel-title-bar__center-6d45d833" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-title-bar__center-6d45d833&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;title-bar__center&quot;,&quot;loc&quot;:{&quot;line&quot;:850,&quot;column&quot;:9}}">
          <span className="title-bar__app-name" data-qoder-id="qel-title-bar__app-name-a450b217" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-title-bar__app-name-a450b217&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;title-bar__app-name&quot;,&quot;loc&quot;:{&quot;line&quot;:851,&quot;column&quot;:11}}">Inkwell</span>
        </div>

        <div className="title-bar__actions" data-qoder-id="qel-title-bar__actions-d512f1c9" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-title-bar__actions-d512f1c9&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;title-bar__actions&quot;,&quot;loc&quot;:{&quot;line&quot;:854,&quot;column&quot;:9}}">
          <div className="view-mode-group" data-component="view-mode-group" data-qoder-id="qel-view-mode-group-4db6b058" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-view-mode-group-4db6b058&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;view-mode-group&quot;,&quot;loc&quot;:{&quot;line&quot;:855,&quot;column&quot;:11}}">
            <button
              className={`icon-btn ${viewMode === "read" ? "icon-btn--active" : ""}`}
              onClick={() => setViewMode("read")}
              title="Reading mode"
              aria-label="Reading mode"
             data-qoder-id="qel-reading-mode-55784d39" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-reading-mode-55784d39&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;reading-mode&quot;,&quot;loc&quot;:{&quot;line&quot;:856,&quot;column&quot;:13}}">
              <Eye size={15}  data-qoder-id="qel-eye-744000bf" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-eye-744000bf&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;eye&quot;,&quot;loc&quot;:{&quot;line&quot;:862,&quot;column&quot;:15}}"/>
            </button>
            <button
              className={`icon-btn ${viewMode === "split" ? "icon-btn--active" : ""}`}
              onClick={() => setViewMode("split")}
              title="Split mode"
              aria-label="Split mode"
             data-qoder-id="qel-split-mode-f24fb258" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-split-mode-f24fb258&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;split-mode&quot;,&quot;loc&quot;:{&quot;line&quot;:864,&quot;column&quot;:13}}">
              <Columns size={15}  data-qoder-id="qel-columns-04b6737d" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-columns-04b6737d&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;columns&quot;,&quot;loc&quot;:{&quot;line&quot;:870,&quot;column&quot;:15}}"/>
            </button>
            <button
              className={`icon-btn ${viewMode === "edit" ? "icon-btn--active" : ""}`}
              onClick={() => setViewMode("edit")}
              title="Editor mode"
              aria-label="Editor mode"
             data-qoder-id="qel-editor-mode-4013a86b" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-editor-mode-4013a86b&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;editor-mode&quot;,&quot;loc&quot;:{&quot;line&quot;:872,&quot;column&quot;:13}}">
              <PenLine size={15}  data-qoder-id="qel-penline-c0ddbe8f" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-penline-c0ddbe8f&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;penline&quot;,&quot;loc&quot;:{&quot;line&quot;:878,&quot;column&quot;:15}}"/>
            </button>
          </div>

          <button
            className={`icon-btn ${tocVisible ? "icon-btn--active" : ""}`}
            onClick={() => setTocVisible(v => !v)}
            title="Table of contents"
            aria-label="Toggle table of contents"
           data-qoder-id="qel-toggle-table-of-contents-e2cd9082" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-toggle-table-of-contents-e2cd9082&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;toggle-table-of-contents&quot;,&quot;loc&quot;:{&quot;line&quot;:882,&quot;column&quot;:11}}">
            <List size={15}  data-qoder-id="qel-list-aad58999" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-list-aad58999&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;list&quot;,&quot;loc&quot;:{&quot;line&quot;:888,&quot;column&quot;:13}}"/>
          </button>

          <button
            className={`icon-btn ${sidebarVisible ? "" : "icon-btn--active"}`}
            onClick={() => setSidebarVisible(v => !v)}
            title="Toggle sidebar (Cmd+B)"
            aria-label="Toggle sidebar"
           data-qoder-id="qel-toggle-sidebar-caa44d21" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-toggle-sidebar-caa44d21&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;toggle-sidebar&quot;,&quot;loc&quot;:{&quot;line&quot;:891,&quot;column&quot;:11}}">
            {sidebarVisible ? <PanelLeft size={15}  data-qoder-id="qel-panelleft-a01e518b" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-panelleft-a01e518b&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;panelleft&quot;,&quot;loc&quot;:{&quot;line&quot;:897,&quot;column&quot;:31}}"/> : <PanelLeftClose size={15}  data-qoder-id="qel-panelleftclose-96abbee2" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-panelleftclose-96abbee2&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;panelleftclose&quot;,&quot;loc&quot;:{&quot;line&quot;:897,&quot;column&quot;:57}}"/>}
          </button>

          <button
            className="icon-btn"
            onClick={toggleTheme}
            title="Toggle theme (Cmd+/)"
            aria-label="Toggle theme"
           data-qoder-id="qel-toggle-theme-205f2328" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-toggle-theme-205f2328&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;toggle-theme&quot;,&quot;loc&quot;:{&quot;line&quot;:900,&quot;column&quot;:11}}">
            {theme === "light" ? <Moon size={15}  data-qoder-id="qel-moon-43816d29" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-moon-43816d29&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;moon&quot;,&quot;loc&quot;:{&quot;line&quot;:906,&quot;column&quot;:34}}"/> : <Sun size={15}  data-qoder-id="qel-sun-6829687a" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-sun-6829687a&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;sun&quot;,&quot;loc&quot;:{&quot;line&quot;:906,&quot;column&quot;:55}}"/>}
          </button>

          <button
            className="icon-btn"
            onClick={() => setPaletteOpen(true)}
            title="Command palette (Cmd+K)"
            aria-label="Open command palette"
           data-qoder-id="qel-open-command-palette-fcd6b8b7" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-open-command-palette-fcd6b8b7&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;open-command-palette&quot;,&quot;loc&quot;:{&quot;line&quot;:909,&quot;column&quot;:11}}">
            <Search size={15}  data-qoder-id="qel-search-92b5885c" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-search-92b5885c&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;search&quot;,&quot;loc&quot;:{&quot;line&quot;:915,&quot;column&quot;:13}}"/>
          </button>
        </div>
      </header>

      {/* ── Main Layout ────────────────────────────── */}
      <div className="main-layout" data-component="main-layout" data-qoder-id="qel-main-layout-26d5a1fc" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-main-layout-26d5a1fc&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;main-layout&quot;,&quot;loc&quot;:{&quot;line&quot;:921,&quot;column&quot;:7}}">
        {/* Sidebar */}
        <aside className={`sidebar ${!sidebarVisible ? "sidebar--hidden" : ""}`} data-component="sidebar" data-qoder-id="qel-sidebar-99ecb4b6" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-sidebar-99ecb4b6&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;sidebar&quot;,&quot;loc&quot;:{&quot;line&quot;:923,&quot;column&quot;:9}}">
          <div className="sidebar__header" data-qoder-id="qel-sidebar__header-d558dd61" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-sidebar__header-d558dd61&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;sidebar__header&quot;,&quot;loc&quot;:{&quot;line&quot;:924,&quot;column&quot;:11}}">
            <span className="sidebar__title" data-qoder-id="qel-sidebar__title-12071f2c" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-sidebar__title-12071f2c&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;sidebar__title&quot;,&quot;loc&quot;:{&quot;line&quot;:925,&quot;column&quot;:13}}">Explorer</span>
            <div className="sidebar__header-actions" data-qoder-id="qel-sidebar__header-actions-5962ea0d" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-sidebar__header-actions-5962ea0d&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;sidebar__header-actions&quot;,&quot;loc&quot;:{&quot;line&quot;:926,&quot;column&quot;:13}}">
              <button
                className={`icon-btn icon-btn--sm ${sidebarView === "flat" ? "icon-btn--active" : ""}`}
                onClick={() => setSidebarView(v => v === "tree" ? "flat" : "tree")}
                title={sidebarView === "tree" ? "Switch to flat list" : "Switch to tree view"}
                aria-label="Toggle view mode"
               data-qoder-id="qel-toggle-view-mode-5e0396de" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-toggle-view-mode-5e0396de&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;toggle-view-mode&quot;,&quot;loc&quot;:{&quot;line&quot;:983,&quot;column&quot;:15}}">
                {sidebarView === "tree" ? <LayoutList size={14}  data-qoder-id="qel-layoutlist-b986c411" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-layoutlist-b986c411&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;layoutlist&quot;,&quot;loc&quot;:{&quot;line&quot;:989,&quot;column&quot;:43}}"/> : <GitBranch size={14}  data-qoder-id="qel-gitbranch-bfdeb9e6" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-gitbranch-bfdeb9e6&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;gitbranch&quot;,&quot;loc&quot;:{&quot;line&quot;:989,&quot;column&quot;:70}}"/>}
              </button>
              <button
                className="icon-btn icon-btn--sm"
                onClick={handleOpenFolder}
                title="Open folder"
                aria-label="Open folder"
               data-qoder-id="qel-open-folder-5c1f4fcc" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-open-folder-5c1f4fcc&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;open-folder&quot;,&quot;loc&quot;:{&quot;line&quot;:927,&quot;column&quot;:15}}">
                <FolderPlus size={14}  data-qoder-id="qel-folderplus-7629d726" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-folderplus-7629d726&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;folderplus&quot;,&quot;loc&quot;:{&quot;line&quot;:933,&quot;column&quot;:17}}"/>
              </button>
              <button
                className="icon-btn icon-btn--sm"
                onClick={handleOpenFile}
                title="Open file"
                aria-label="Open file"
               data-qoder-id="qel-open-file-baa2b8f8" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-open-file-baa2b8f8&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;open-file&quot;,&quot;loc&quot;:{&quot;line&quot;:935,&quot;column&quot;:15}}">
                <FilePlus size={14}  data-qoder-id="qel-fileplus-089a1c18" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-fileplus-089a1c18&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;fileplus&quot;,&quot;loc&quot;:{&quot;line&quot;:941,&quot;column&quot;:17}}"/>
              </button>
            </div>
          </div>

          <div className="sidebar__search" data-qoder-id="qel-sidebar__search-af7664fa" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-sidebar__search-af7664fa&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;sidebar__search&quot;,&quot;loc&quot;:{&quot;line&quot;:946,&quot;column&quot;:11}}">
            <div className="sidebar__search-wrapper" data-qoder-id="qel-sidebar__search-wrapper-47c88047" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-sidebar__search-wrapper-47c88047&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;sidebar__search-wrapper&quot;,&quot;loc&quot;:{&quot;line&quot;:947,&quot;column&quot;:13}}">
              <Search size={14} className="sidebar__search-icon"  data-qoder-id="qel-sidebar__search-icon-caa7d2c3" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-sidebar__search-icon-caa7d2c3&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;sidebar__search-icon&quot;,&quot;loc&quot;:{&quot;line&quot;:948,&quot;column&quot;:15}}"/>
              <input
                type="text"
                className="sidebar__search-input"
                placeholder="Search files..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (e.target.value && sidebarView === "tree") setSidebarView("flat");
                  if (!e.target.value && sidebarView === "flat") setSidebarView("tree");
                }}
               data-qoder-id="qel-sidebar__search-input-4a6f2931" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-sidebar__search-input-4a6f2931&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;sidebar__search-input&quot;,&quot;loc&quot;:{&quot;line&quot;:949,&quot;column&quot;:15}}"/>
            </div>
          </div>

          {sidebarView === "tree" ? (
            <div className="sidebar__tree" role="tree" aria-label="File browser" data-qoder-id="qel-file-browser-8908d5fd" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-file-browser-8908d5fd&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;file-browser&quot;,&quot;loc&quot;:{&quot;line&quot;:1024,&quot;column&quot;:13}}">
              {filteredTree.map(node => (
                <FileTreeItem
                  key={node.id}
                  node={node}
                  depth={0}
                  selectedId={selectedFileId}
                  onSelect={handleSelectFile}
                  expandedIds={expandedFolders}
                  onToggle={handleToggleFolder}
                 data-qoder-id="qel-filetreeitem-ef0e548e" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-filetreeitem-ef0e548e&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;filetreeitem&quot;,&quot;loc&quot;:{&quot;line&quot;:1026,&quot;column&quot;:17}}"/>
              ))}
            </div>
          ) : (
            <FlatFileList
              files={allFiles}
              selectedId={selectedFileId}
              onSelect={handleSelectFile}
              searchQuery={searchQuery}
             data-qoder-id="qel-flatfilelist-14c39f2c" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-flatfilelist-14c39f2c&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;flatfilelist&quot;,&quot;loc&quot;:{&quot;line&quot;:1038,&quot;column&quot;:13}}"/>
          )}
        </aside>

        {/* Content Area */}
        <main className="content-area" data-component="content-area" data-qoder-id="qel-content-area-999448dd" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-content-area-999448dd&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;content-area&quot;,&quot;loc&quot;:{&quot;line&quot;:975,&quot;column&quot;:9}}">
          {selectedFileId ? (
            <>
              {/* Tab Bar */}
              <div className="tab-bar" data-component="tab-bar" data-qoder-id="qel-tab-bar-27b6c1e0" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-tab-bar-27b6c1e0&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;tab-bar&quot;,&quot;loc&quot;:{&quot;line&quot;:979,&quot;column&quot;:15}}">
                {openTabs.map(tab => (
                  <button
                    key={tab.id}
                    className={`tab ${activeTabId === tab.id ? "tab--active" : ""}`}
                    onClick={() => handleSwitchTab(tab)}
                    data-component="tab"
                   data-qoder-id="qel-tab-920d4b0e" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-tab-920d4b0e&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;tab&quot;,&quot;loc&quot;:{&quot;line&quot;:981,&quot;column&quot;:19}}">
                    <span className="tab__dot"  data-qoder-id="qel-tab__dot-e63364d6" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-tab__dot-e63364d6&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;tab__dot&quot;,&quot;loc&quot;:{&quot;line&quot;:987,&quot;column&quot;:21}}"/>
                    <span className="tab__name" data-qoder-id="qel-tab__name-72eec5a5" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-tab__name-72eec5a5&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;tab__name&quot;,&quot;loc&quot;:{&quot;line&quot;:988,&quot;column&quot;:21}}">{tab.name}</span>
                    <span
                      className="tab__close"
                      onClick={(e) => handleCloseTab(e, tab.id)}
                      role="button"
                      aria-label={`Close ${tab.name}`}
                     data-qoder-id="qel-tab__close-d75ba1ef" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-tab__close-d75ba1ef&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;tab__close&quot;,&quot;loc&quot;:{&quot;line&quot;:989,&quot;column&quot;:21}}">
                      <X size={12}  data-qoder-id="qel-x-c21bc905" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-x-c21bc905&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;x&quot;,&quot;loc&quot;:{&quot;line&quot;:995,&quot;column&quot;:23}}"/>
                    </span>
                  </button>
                ))}
              </div>

              {/* Formatting toolbar for edit/split modes */}
              {(viewMode === "edit" || viewMode === "split") && (
                <FormattingToolbar
                  editorRef={editorRef}
                  onContentChange={setEditorContent}
                 data-qoder-id="qel-formattingtoolbar-0c3a415a" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-formattingtoolbar-0c3a415a&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;formattingtoolbar&quot;,&quot;loc&quot;:{&quot;line&quot;:1003,&quot;column&quot;:17}}"/>
              )}

              {/* Editor / Preview Container */}
              <div className={`editor-container ${contentFade ? "editor-container--fade" : ""}`} data-component="editor-container" data-qoder-id="qel-editor-container-f03fd5f1" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-editor-container-f03fd5f1&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;editor-container&quot;,&quot;loc&quot;:{&quot;line&quot;:1010,&quot;column&quot;:15}}">
                {viewMode === "read" && (
                  <div className="reading-pane" ref={readingRef} data-component="reading-pane" data-qoder-id="qel-reading-pane-8f3aa7aa" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-reading-pane-8f3aa7aa&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;reading-pane&quot;,&quot;loc&quot;:{&quot;line&quot;:1208,&quot;column&quot;:19}}">
                    <div className="reading-pane__inner" data-qoder-id="qel-reading-pane__inner-31920e85" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-reading-pane__inner-31920e85&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;reading-pane__inner&quot;,&quot;loc&quot;:{&quot;line&quot;:1209,&quot;column&quot;:21}}">
                      {isHtmlFile ? (
                        <div className="html-preview" dangerouslySetInnerHTML={{ __html: editorContent }}  data-qoder-id="qel-html-preview-30e4a73d" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-html-preview-30e4a73d&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;html-preview&quot;,&quot;loc&quot;:{&quot;line&quot;:1211,&quot;column&quot;:25}}"/>
                      ) : (
                        <div className="markdown-body" data-qoder-id="qel-markdown-body-4f42d79e" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-markdown-body-4f42d79e&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;markdown-body&quot;,&quot;loc&quot;:{&quot;line&quot;:1213,&quot;column&quot;:25}}">
                          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSlug, rehypeRaw]} data-qoder-id="qel-reactmarkdown-59c911f6" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-reactmarkdown-59c911f6&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;reactmarkdown&quot;,&quot;loc&quot;:{&quot;line&quot;:1214,&quot;column&quot;:27}}">{editorContent}</ReactMarkdown>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {viewMode === "split" && (
                  <>
                    <div className="editor-pane" data-component="editor-pane" data-qoder-id="qel-editor-pane-d786e436" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-editor-pane-d786e436&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;editor-pane&quot;,&quot;loc&quot;:{&quot;line&quot;:1023,&quot;column&quot;:21}}">
                      <div className="editor-pane__header" data-qoder-id="qel-editor-pane__header-1a066088" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-editor-pane__header-1a066088&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;editor-pane__header&quot;,&quot;loc&quot;:{&quot;line&quot;:1024,&quot;column&quot;:23}}">Source</div>
                      <textarea
                        ref={editorRef}
                        className="editor-pane__textarea"
                        value={editorContent}
                        onChange={(e) => setEditorContent(e.target.value)}
                        placeholder="Start writing Markdown..."
                        spellCheck={false}
                        data-component="editor-textarea"
                       data-qoder-id="qel-editor-textarea-63b8ed4d" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-editor-textarea-63b8ed4d&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;editor-textarea&quot;,&quot;loc&quot;:{&quot;line&quot;:1025,&quot;column&quot;:23}}"/>
                    </div>
                    <div className="preview-pane" ref={previewRef} data-component="preview-pane" data-qoder-id="qel-preview-pane-30b1f775" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-preview-pane-30b1f775&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;preview-pane&quot;,&quot;loc&quot;:{&quot;line&quot;:1235,&quot;column&quot;:21}}">
                      <div className="editor-pane__header" data-qoder-id="qel-editor-pane__header-8e0b9452" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-editor-pane__header-8e0b9452&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;editor-pane__header&quot;,&quot;loc&quot;:{&quot;line&quot;:1236,&quot;column&quot;:23}}">Preview</div>
                      <div className="preview-pane__inner" data-qoder-id="qel-preview-pane__inner-2835b75d" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-preview-pane__inner-2835b75d&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;preview-pane__inner&quot;,&quot;loc&quot;:{&quot;line&quot;:1237,&quot;column&quot;:23}}">
                        {isHtmlFile ? (
                          <div className="html-preview" dangerouslySetInnerHTML={{ __html: editorContent }}  data-qoder-id="qel-html-preview-31e6e767" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-html-preview-31e6e767&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;html-preview&quot;,&quot;loc&quot;:{&quot;line&quot;:1239,&quot;column&quot;:27}}"/>
                        ) : (
                          <div className="markdown-body" data-qoder-id="qel-markdown-body-4a450e56" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-markdown-body-4a450e56&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;markdown-body&quot;,&quot;loc&quot;:{&quot;line&quot;:1241,&quot;column&quot;:27}}">
                            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSlug, rehypeRaw]} data-qoder-id="qel-reactmarkdown-d4c60200" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-reactmarkdown-d4c60200&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;reactmarkdown&quot;,&quot;loc&quot;:{&quot;line&quot;:1242,&quot;column&quot;:29}}">{editorContent}</ReactMarkdown>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}

                {viewMode === "edit" && (
                  <div className="editor-pane" style={{ borderRight: "none" }} data-component="editor-pane" data-qoder-id="qel-editor-pane-657f74fb" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-editor-pane-657f74fb&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;editor-pane&quot;,&quot;loc&quot;:{&quot;line&quot;:1047,&quot;column&quot;:19}}">
                    <div className="editor-pane__header" data-qoder-id="qel-editor-pane__header-920dd935" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-editor-pane__header-920dd935&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;editor-pane__header&quot;,&quot;loc&quot;:{&quot;line&quot;:1048,&quot;column&quot;:21}}">Source</div>
                    <textarea
                      ref={editorRef}
                      className="editor-pane__textarea"
                      value={editorContent}
                      onChange={(e) => setEditorContent(e.target.value)}
                      placeholder="Start writing Markdown..."
                      spellCheck={false}
                      data-component="editor-textarea"
                     data-qoder-id="qel-editor-textarea-55b698ac" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-editor-textarea-55b698ac&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;editor-textarea&quot;,&quot;loc&quot;:{&quot;line&quot;:1049,&quot;column&quot;:21}}"/>
                  </div>
                )}
              </div>
            </>
          ) : (
            <WelcomeState onOpenFile={handleOpenFile} onOpenFolder={handleOpenFolder}  data-qoder-id="qel-welcomestate-d9920ba3" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-welcomestate-d9920ba3&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;welcomestate&quot;,&quot;loc&quot;:{&quot;line&quot;:1063,&quot;column&quot;:13}}"/>
          )}
        </main>

        {/* TOC Panel */}
        {selectedFileId && (
          <TocPanel headings={headings} visible={tocVisible} scrollContainerRef={activeScrollRef}  data-qoder-id="qel-tocpanel-bed90b8a" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-tocpanel-bed90b8a&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;tocpanel&quot;,&quot;loc&quot;:{&quot;line&quot;:1069,&quot;column&quot;:11}}"/>
        )}
      </div>

      {/* ── Status Bar ─────────────────────────────── */}
      <footer className="status-bar" data-component="status-bar" data-qoder-id="qel-status-bar-2e54c348" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-status-bar-2e54c348&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;status-bar&quot;,&quot;loc&quot;:{&quot;line&quot;:1074,&quot;column&quot;:7}}">
        <div className="status-bar__left" data-qoder-id="qel-status-bar__left-cf42cf90" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-status-bar__left-cf42cf90&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;status-bar__left&quot;,&quot;loc&quot;:{&quot;line&quot;:1075,&quot;column&quot;:9}}">
          {selectedFileName && (
            <span className="status-bar__item" data-qoder-id="qel-status-bar__item-0bd1fab6" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-status-bar__item-0bd1fab6&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;status-bar__item&quot;,&quot;loc&quot;:{&quot;line&quot;:1077,&quot;column&quot;:13}}">
              <FileText size={12}  data-qoder-id="qel-filetext-2f633b1c" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-filetext-2f633b1c&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;filetext&quot;,&quot;loc&quot;:{&quot;line&quot;:1078,&quot;column&quot;:15}}"/>
              {selectedFileName}
            </span>
          )}
        </div>
        <div className="status-bar__right" data-qoder-id="qel-status-bar__right-cff17ba5" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-status-bar__right-cff17ba5&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;status-bar__right&quot;,&quot;loc&quot;:{&quot;line&quot;:1083,&quot;column&quot;:9}}">
          <span className="status-bar__item" data-qoder-id="qel-status-bar__item-18d44dc4" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-status-bar__item-18d44dc4&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;status-bar__item&quot;,&quot;loc&quot;:{&quot;line&quot;:1084,&quot;column&quot;:11}}">{lineCount} lines</span>
          <span className="status-bar__item" data-qoder-id="qel-status-bar__item-1bd4527d" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-status-bar__item-1bd4527d&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;App&quot;,&quot;elementRole&quot;:&quot;status-bar__item&quot;,&quot;loc&quot;:{&quot;line&quot;:1085,&quot;column&quot;:11}}">{wordCount} words</span>
          <span className="status-bar__item" data-qoder-id="qel-status-bar__item-32f7ee78" data-qoder-source="{&quot;qoderId&quot;:&quot;qel-status-bar__item-32f7ee78&quot;,&quot;filePath&quot;:&quot;react-vite/src/App.jsx&quot;,&quot;componentName&quot;:&quot;Unknown&quot;,&quot;elementRole&quot;:&quot;status-bar__item&quot;,&quot;loc&quot;:{&quot;line&quot;:1293,&quot;column&quot;:11}}">{isHtmlFile ? "HTML" : "Markdown"}</span>
        </div>
      </footer>
    </div>
  );
}
