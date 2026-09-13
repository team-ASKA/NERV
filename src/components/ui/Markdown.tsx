/**
 * Markdown rendered with the design system's own type styles.
 *
 * The app does not include `@tailwindcss/typography`, so the `prose` classes
 * that used to wrap every `<ReactMarkdown>` resolved to nothing and model
 * output rendered as unstyled browser defaults — headings indistinguishable
 * from body text, lists without markers. This maps each element explicitly
 * instead, which keeps tutor replies and the written report looking like the
 * rest of NERV without adding a dependency.
 */

import ReactMarkdown, { type Components } from 'react-markdown';
import { cn } from '../../lib/cn';

export interface MarkdownProps {
  children: string;
  /** `sm` for chat bubbles and panels, `base` for the full report. */
  size?: 'sm' | 'base';
  className?: string;
}

const components: Components = {
  h1: ({ children }) => (
    <h1 className="mb-2 mt-4 font-montserrat text-lg font-bold text-white first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 mt-4 font-montserrat text-base font-bold text-white first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1.5 mt-3 font-montserrat text-sm font-semibold text-white first:mt-0">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mb-1.5 mt-3 text-sm font-semibold text-white first:mt-0">{children}</h4>
  ),
  p: ({ children }) => <p className="mb-2.5 leading-relaxed last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-2.5 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2.5 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-accent-soft underline underline-offset-2 hover:text-accent"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-2.5 border-l-2 border-accent/40 pl-3 italic text-muted last:mb-0">
      {children}
    </blockquote>
  ),
  // `[&>code]` strips the inline pill styling from code inside a fenced block.
  pre: ({ children }) => (
    <pre className="mb-2.5 overflow-x-auto rounded-lg border border-border bg-black/40 p-3 text-xs leading-relaxed last:mb-0 [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-inherit">
      {children}
    </pre>
  ),
  code: ({ children }) => (
    <code className="rounded bg-white/8 px-1 py-0.5 font-mono text-[0.85em] text-accent-soft">
      {children}
    </code>
  ),
  hr: () => <hr className="my-4 border-border" />,
  table: ({ children }) => (
    <div className="mb-2.5 overflow-x-auto last:mb-0">
      <table className="w-full border-collapse text-left">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-border px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="border-b border-border/60 px-2 py-1.5 align-top">{children}</td>,
};

export function Markdown({ children, size = 'sm', className }: MarkdownProps) {
  return (
    <div className={cn(size === 'sm' ? 'text-sm' : 'text-[15px]', 'text-muted', className)}>
      <ReactMarkdown components={components}>{children}</ReactMarkdown>
    </div>
  );
}

export default Markdown;
