"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import MarkdownContent from "@/components/MarkdownContent";

type ApplyResult = { next: string; selStart: number; selEnd: number };
type Tool = { title: string; render: ReactNode; apply: (text: string, start: number, end: number) => ApplyResult };

/** Wraps the current selection (or a placeholder, if nothing's selected)
 * with `before`/`after` -- used for bold/italic/link. */
function wrapTool(before: string, after: string, placeholder: string): Tool["apply"] {
  return (text, start, end) => {
    const selected = text.slice(start, end) || placeholder;
    const next = text.slice(0, start) + before + selected + after + text.slice(end);
    const selStart = start + before.length;
    return { next, selStart, selEnd: selStart + selected.length };
  };
}

/** Prepends `prefix` to every line touched by the selection -- used for
 * headings/quotes/lists. Toggles it back off if every touched line already
 * has it, so clicking the same button twice undoes it. */
function linePrefixTool(prefix: string): Tool["apply"] {
  return (text, start, end) => {
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    let lineEnd = text.indexOf("\n", end);
    if (lineEnd === -1) lineEnd = text.length;
    const block = text.slice(lineStart, lineEnd);
    const lines = block.split("\n");
    const alreadyPrefixed = lines.every((line) => line.startsWith(prefix));
    const nextLines = lines.map((line) => (alreadyPrefixed ? line.slice(prefix.length) : prefix + line));
    const nextBlock = nextLines.join("\n");
    const next = text.slice(0, lineStart) + nextBlock + text.slice(lineEnd);
    return { next, selStart: lineStart, selEnd: lineStart + nextBlock.length };
  };
}

const TOOLS: Tool[] = [
  { title: "Bold", render: <b>B</b>, apply: wrapTool("**", "**", "bold text") },
  { title: "Italic", render: <i>I</i>, apply: wrapTool("_", "_", "italic text") },
  { title: "Heading", render: "H2", apply: linePrefixTool("## ") },
  { title: "Quote", render: <span className="font-serif">&ldquo;&rdquo;</span>, apply: linePrefixTool("> ") },
  { title: "Bulleted list", render: "•", apply: linePrefixTool("- ") },
  { title: "Numbered list", render: "1.", apply: linePrefixTool("1. ") },
  { title: "Link", render: "Link", apply: wrapTool("[", "](https://)", "link text") },
];

/** A textarea with a small markdown toolbar and a Write/Preview toggle --
 * every toolbar button inserts plain markdown syntax around the current
 * selection, so the stored value is still just a markdown string (no schema
 * change needed); Preview renders it through the same MarkdownContent used
 * to display the finished announcement. */
export default function MarkdownEditor({
  value,
  onChange,
  placeholder,
  rows = 6,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
}) {
  const [mode, setMode] = useState<"write" | "preview">("write");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingSelection = useRef<{ start: number; end: number } | null>(null);

  useEffect(() => {
    if (!pendingSelection.current || !textareaRef.current) return;
    const { start, end } = pendingSelection.current;
    textareaRef.current.focus();
    textareaRef.current.setSelectionRange(start, end);
    pendingSelection.current = null;
  }, [value]);

  function runTool(tool: Tool) {
    const el = textareaRef.current;
    if (!el) return;
    const { next, selStart, selEnd } = tool.apply(value, el.selectionStart, el.selectionEnd);
    pendingSelection.current = { start: selStart, end: selEnd };
    onChange(next);
  }

  return (
    <div className="rounded-md border border-border overflow-hidden focus-within:border-gold focus-within:ring-2 focus-within:ring-gold/15 transition-colors">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-navy-deep/40 px-2 py-1">
        <div className="flex items-center gap-0.5">
          {TOOLS.map((tool) => (
            <button
              key={tool.title}
              type="button"
              title={tool.title}
              aria-label={tool.title}
              disabled={disabled || mode === "preview"}
              onClick={() => runTool(tool)}
              className="h-7 min-w-7 px-1.5 rounded text-xs text-muted hover:text-foreground hover:bg-surface-hover transition-colors disabled:opacity-40 disabled:pointer-events-none"
            >
              {tool.render}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-wide shrink-0">
          <button
            type="button"
            onClick={() => setMode("write")}
            className={`px-2 py-1 rounded transition-colors ${
              mode === "write" ? "bg-gold/15 text-gold" : "text-muted hover:text-foreground"
            }`}
          >
            Write
          </button>
          <button
            type="button"
            onClick={() => setMode("preview")}
            className={`px-2 py-1 rounded transition-colors ${
              mode === "preview" ? "bg-gold/15 text-gold" : "text-muted hover:text-foreground"
            }`}
          >
            Preview
          </button>
        </div>
      </div>

      {mode === "write" ? (
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          disabled={disabled}
          className="w-full resize-none bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted"
        />
      ) : (
        <div className="px-3 py-2" style={{ minHeight: `${rows * 1.5}rem` }}>
          {value.trim() ? <MarkdownContent text={value} /> : <p className="text-sm text-muted italic">Nothing to preview yet.</p>}
        </div>
      )}
    </div>
  );
}
