import Editor from '@monaco-editor/react';
import { Code2, Info } from 'lucide-react';
import { cn } from '../../lib/cn';

export const SCRATCHPAD_LANGUAGES = [
  'javascript',
  'typescript',
  'python',
  'java',
  'cpp',
  'c',
  'go',
  'rust',
  'sql',
] as const;

export type ScratchpadLanguage = (typeof SCRATCHPAD_LANGUAGES)[number];

export interface CodeScratchpadProps {
  value: string;
  onChange: (next: string) => void;
  language: ScratchpadLanguage;
  onLanguageChange: (next: ScratchpadLanguage) => void;
  className?: string;
}

/**
 * Monaco scratchpad for the technical round.
 *
 * Deliberately *not* an execution environment: nothing here is compiled or run.
 * The buffer is sent to the interviewer as context so it can ask about the
 * approach — which is what a real screen does with a shared editor.
 */
export function CodeScratchpad({
  value,
  onChange,
  language,
  onLanguageChange,
  className,
}: CodeScratchpadProps) {
  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted">
          <Code2 size={14} className="text-accent-soft" />
          Scratchpad
        </div>
        <select
          value={language}
          onChange={(e) => onLanguageChange(e.target.value as ScratchpadLanguage)}
          className="h-8 rounded-lg border border-border bg-input-bg px-2 text-xs text-white outline-none transition-colors focus:border-accent"
          aria-label="Scratchpad language"
        >
          {SCRATCHPAD_LANGUAGES.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </div>

      <div className="min-h-0 flex-1">
        <Editor
          height="100%"
          language={language}
          theme="vs-dark"
          value={value}
          onChange={(next) => onChange(next ?? '')}
          loading={<div className="p-4 text-sm text-muted-foreground">Loading editor…</div>}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            lineHeight: 20,
            wordWrap: 'on',
            padding: { top: 12, bottom: 12 },
            scrollBeyondLastLine: false,
            smoothScrolling: true,
            cursorBlinking: 'smooth',
            cursorSmoothCaretAnimation: 'on',
            formatOnPaste: true,
            renderLineHighlight: 'line',
            scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
          }}
        />
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Info size={12} />
          Not executed — the interviewer reads it as context while you talk through it.
        </span>
        <span className="tabular-nums">{value.length} chars</span>
      </div>
    </div>
  );
}

export default CodeScratchpad;
