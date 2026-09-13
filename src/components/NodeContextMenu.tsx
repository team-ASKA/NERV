import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BookOpen, HelpCircle, Zap } from 'lucide-react';

interface NodeContextMenuProps {
  visible: boolean;
  x: number;
  y: number;
  nodeLabel: string;
  onGenerateQuiz: () => void;
  onCreateFlashcards: () => void;
  onDeepDive: () => void;
}

const ITEM_CLASS =
  'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-muted transition-colors hover:bg-accent-muted hover:text-white';

export const NodeContextMenu: React.FC<NodeContextMenuProps> = ({
  visible,
  x,
  y,
  nodeLabel,
  onGenerateQuiz,
  onCreateFlashcards,
  onDeepDive,
}) => {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: -5 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: -5 }}
          transition={{ duration: 0.15 }}
          className="pointer-events-auto fixed z-50"
          style={{ left: x, top: y, transform: 'translate(-50%, -110%)' }}
        >
          <div className="min-w-[168px] overflow-hidden rounded-xl border border-border-strong bg-surface-overlay shadow-card">
            <div className="border-b border-border bg-accent-muted px-3 py-2">
              <p className="max-w-[150px] truncate text-xs font-semibold uppercase tracking-wider text-accent-soft">
                {nodeLabel}
              </p>
            </div>
            <div className="p-1">
              <button onClick={onGenerateQuiz} className={ITEM_CLASS}>
                <HelpCircle className="h-3.5 w-3.5 shrink-0 text-accent-soft" />
                Generate quiz
              </button>
              <button onClick={onCreateFlashcards} className={ITEM_CLASS}>
                <BookOpen className="h-3.5 w-3.5 shrink-0 text-accent-soft" />
                Flashcards
              </button>
              <button onClick={onDeepDive} className={ITEM_CLASS}>
                <Zap className="h-3.5 w-3.5 shrink-0 text-accent-soft" />
                Deep dive
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
