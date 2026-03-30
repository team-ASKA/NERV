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
}

export const NodeContextMenu: React.FC<NodeContextMenuProps> = ({
  visible,
  x,
  y,
  nodeLabel,
  onGenerateQuiz,
  onCreateFlashcards,
}) => {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: -5 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: -5 }}
          transition={{ duration: 0.15 }}
          className="fixed z-50 pointer-events-auto"
          style={{ left: x, top: y, transform: 'translate(-50%, -110%)' }}
        >
          <div className="bg-[#1a1a1a] border border-yellow-500/30 rounded-xl shadow-2xl shadow-black/50 overflow-hidden min-w-[160px]">
            <div className="px-3 py-2 bg-yellow-500/10 border-b border-yellow-500/20">
              <p className="text-yellow-400 text-xs font-bold uppercase tracking-wider truncate max-w-[140px]">
                {nodeLabel}
              </p>
            </div>
            <div className="p-1">
              <button
                onClick={onGenerateQuiz}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-white/80 hover:text-white hover:bg-yellow-500/10 rounded-lg transition-colors text-left"
              >
                <HelpCircle className="h-3.5 w-3.5 text-yellow-500 flex-shrink-0" />
                Generate Quiz
              </button>
              <button
                onClick={onCreateFlashcards}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-white/80 hover:text-white hover:bg-yellow-500/10 rounded-lg transition-colors text-left"
              >
                <BookOpen className="h-3.5 w-3.5 text-yellow-500 flex-shrink-0" />
                Flashcards
              </button>
              <button
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-white/80 hover:text-white hover:bg-yellow-500/10 rounded-lg transition-colors text-left"
              >
                <Zap className="h-3.5 w-3.5 text-yellow-500 flex-shrink-0" />
                Deep Dive
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
