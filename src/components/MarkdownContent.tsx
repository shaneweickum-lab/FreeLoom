"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// Maps markdown elements onto the app's own type/color tokens (font-serif
// headings, gold links/accents, navy borders) instead of react-markdown's
// unstyled defaults -- this is the one place that styling lives, shared by
// the editor's Preview tab and the opened-announcement modal.
//
// react-markdown always passes a `node` prop into each component override;
// every override below destructures it out (as `_node`) so it isn't spread
// onto the underlying DOM element, which is why it reads as unused.
/* eslint-disable @typescript-eslint/no-unused-vars */
const COMPONENTS: Components = {
  h1: ({ node: _node, ...props }) => <h1 className="font-serif text-xl font-bold mt-4 mb-2 first:mt-0" {...props} />,
  h2: ({ node: _node, ...props }) => <h2 className="font-serif text-lg font-bold mt-4 mb-1.5 first:mt-0" {...props} />,
  h3: ({ node: _node, ...props }) => <h3 className="font-serif text-base font-semibold mt-3 mb-1 first:mt-0" {...props} />,
  p: ({ node: _node, ...props }) => <p className="leading-relaxed mb-3 last:mb-0" {...props} />,
  strong: ({ node: _node, ...props }) => <strong className="font-semibold text-foreground" {...props} />,
  em: ({ node: _node, ...props }) => <em className="italic" {...props} />,
  a: ({ node: _node, ...props }) => <a className="text-gold hover:underline" target="_blank" rel="noreferrer" {...props} />,
  ul: ({ node: _node, ...props }) => <ul className="list-disc list-inside space-y-1 mb-3" {...props} />,
  ol: ({ node: _node, ...props }) => <ol className="list-decimal list-inside space-y-1 mb-3" {...props} />,
  li: ({ node: _node, ...props }) => <li {...props} />,
  blockquote: ({ node: _node, ...props }) => (
    <blockquote className="border-l-2 border-gold/50 pl-3 italic text-muted my-3" {...props} />
  ),
  code: ({ node: _node, ...props }) => <code className="rounded bg-navy-deep/60 px-1 py-0.5 font-mono text-xs" {...props} />,
  hr: () => <hr className="border-navy-line my-3" />,
  table: ({ node: _node, ...props }) => (
    <div className="overflow-x-auto my-3">
      <table className="w-full text-xs border border-navy-line rounded" {...props} />
    </div>
  ),
  th: ({ node: _node, ...props }) => (
    <th className="text-left px-2 py-1 bg-navy-soft border-b border-navy-line font-medium" {...props} />
  ),
  td: ({ node: _node, ...props }) => <td className="px-2 py-1 border-b border-navy-line" {...props} />,
};

/** Renders announcement/message markdown consistently everywhere it's shown
 * -- the MarkdownEditor's own Preview tab and the opened-announcement modal
 * both use this so "what you wrote" and "what recipients see" always match. */
export default function MarkdownContent({ text }: { text: string }) {
  return (
    <div className="text-sm text-foreground">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
