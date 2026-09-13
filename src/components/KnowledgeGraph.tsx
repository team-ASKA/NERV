import { useEffect, useRef, useState, useCallback } from 'react';
import { NodeContextMenu } from './NodeContextMenu';

export interface GraphNode {
  id: string | number;
  label: string;
  level?: number;
  /** Times this topic came up in the interview. Omit when unmeasured. */
  mentionCount?: number;
  /** Total questions asked, the denominator for coverage. Omit when unmeasured. */
  totalQuestions?: number;
}

export interface GraphEdge {
  from?: string | number;
  to?: string | number;
  source?: string | number;
  target?: string | number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface KnowledgeGraphProps {
  data: GraphData;
  activeNodeId?: string | number | null;
  onNodeSelect?: (nodeId: string | number, nodeLabel: string) => void;
  onNodeExplain?: (nodeLabel: string) => void;
  onNodeQuiz?: (nodeLabel: string) => void;
  onNodeFlashcards?: (nodeLabel: string) => void;
  onNodeDeepDive?: (nodeLabel: string) => void;
}

// Indigo ramp keyed to the design tokens: the root is brightest, each level down
// steps back so depth reads at a glance.
const NODE_COLORS = ['#6366F1', '#4F46E5', '#4338CA', '#3730A3'];
const BORDER_COLORS = ['#818CF8', '#6366F1', '#4F46E5', '#4338CA'];
const HOVER_COLORS = ['#818CF8', '#6366F1', '#5B5BE6', '#4F46E5'];
const ACTIVE_BG = '#818CF8';
const ACTIVE_BORDER = '#C7D2FE';

const pick = (palette: string[], level: number) => palette[Math.min(level, palette.length - 1)];

/** Coverage percentage, or null when the interview produced no data to show. */
function coverage(node: GraphNode): number | null {
  if (!node.totalQuestions || node.mentionCount === undefined) return null;
  return Math.round((node.mentionCount / node.totalQuestions) * 100);
}

/**
 * Interactive knowledge graph built on vis-network, with a pill-grid fallback if
 * the module fails to load.
 */
export function KnowledgeGraph({
  data,
  activeNodeId,
  onNodeSelect,
  onNodeExplain,
  onNodeQuiz,
  onNodeFlashcards,
  onNodeDeepDive,
}: KnowledgeGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const networkRef = useRef<any>(null);
  const [visAvailable, setVisAvailable] = useState<boolean | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    nodeId: string | number | null;
    nodeLabel: string;
  }>({ visible: false, x: 0, y: 0, nodeId: null, nodeLabel: '' });

  useEffect(() => {
    import('vis-network')
      .then(() => setVisAvailable(true))
      .catch(() => setVisAvailable(false));
  }, []);

  const handleNodeClick = useCallback(
    (nodeId: string | number, nodeLabel: string) => {
      if (onNodeExplain) onNodeExplain(nodeLabel);
      if (onNodeSelect) onNodeSelect(nodeId, nodeLabel);
    },
    [onNodeSelect, onNodeExplain],
  );

  useEffect(() => {
    if (visAvailable !== true || !containerRef.current) return;

    let hoverTimeout: ReturnType<typeof setTimeout> | null = null;
    let blurTimeout: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    (async () => {
      const { Network } = await import('vis-network');
      const { DataSet } = await import('vis-data');
      if (cancelled || !containerRef.current) return;

      const nodes = new DataSet(
        data.nodes.map((node) => {
          const pct = coverage(node);
          const level = node.level || 0;
          const isActive = node.id === activeNodeId;
          return {
            id: node.id,
            label: pct !== null ? `${node.label}\n${pct}%` : node.label,
            level: node.level,
            color: {
              background: isActive ? ACTIVE_BG : pick(NODE_COLORS, level),
              border: isActive ? ACTIVE_BORDER : pick(BORDER_COLORS, level),
              highlight: { background: ACTIVE_BG, border: ACTIVE_BORDER },
              hover: { background: pick(HOVER_COLORS, level), border: ACTIVE_BORDER },
            },
            font: { size: 12, color: '#FFFFFF', face: 'Inter, sans-serif', bold: '600' },
            shape: 'hexagon',
            size: 28 + (3 - level) * 6,
            borderWidth: isActive ? 4 : 2,
            shadow: { enabled: true, color: 'rgba(99,102,241,0.35)', size: 10, x: 0, y: 3 },
          };
        }),
      );

      const edges = new DataSet(
        data.edges.map((edge, idx) => ({
          id: idx,
          from: edge.from ?? edge.source,
          to: edge.to ?? edge.target,
          color: {
            color: 'rgba(255,255,255,0.16)',
            highlight: '#818CF8',
            hover: '#6366F1',
            opacity: 1,
          },
          width: 2,
          smooth: { enabled: true, type: 'dynamic', roundness: 0.3 },
          arrows: { to: { enabled: true, scaleFactor: 0.8, type: 'arrow' } },
        })),
      );

      const options = {
        layout: { improvedLayout: true, randomSeed: 42 },
        physics: {
          enabled: true,
          stabilization: { enabled: true, iterations: 150, fit: true },
          barnesHut: {
            gravitationalConstant: -8000,
            centralGravity: 0.3,
            springLength: 110,
            springConstant: 0.04,
            damping: 0.09,
            avoidOverlap: 0.1,
          },
        },
        interaction: { hover: true, dragNodes: true, dragView: true, zoomView: true },
        configure: { enabled: false },
      };

      if (networkRef.current) networkRef.current.destroy();
      const network = new Network(
        containerRef.current,
        { nodes: nodes as any, edges: edges as any },
        options,
      );
      networkRef.current = network;

      network.on('hoverNode', (event: any) => {
        const node = data.nodes.find((n) => n.id === event.node);
        if (!node || !containerRef.current) return;
        if (blurTimeout) {
          clearTimeout(blurTimeout);
          blurTimeout = null;
        }
        const rect = containerRef.current.getBoundingClientRect();
        const pos = network.canvasToDOM({ x: event.pointer.canvas.x, y: event.pointer.canvas.y });
        if (hoverTimeout) clearTimeout(hoverTimeout);
        hoverTimeout = setTimeout(() => {
          setContextMenu({
            visible: true,
            x: rect.left + pos.x,
            y: rect.top + pos.y - 10,
            nodeId: event.node,
            nodeLabel: node.label,
          });
        }, 250);
      });

      network.on('blurNode', () => {
        if (hoverTimeout) {
          clearTimeout(hoverTimeout);
          hoverTimeout = null;
        }
        blurTimeout = setTimeout(() => setContextMenu((p) => ({ ...p, visible: false })), 150);
      });

      network.on('click', (event: any) => {
        setContextMenu((p) => ({ ...p, visible: false }));
        if (event.nodes.length > 0) {
          const nodeId = event.nodes[0];
          const node = data.nodes.find((n) => n.id === nodeId);
          // Strip the appended coverage line before handing the label back.
          if (node) handleNodeClick(nodeId, node.label.split('\n')[0]);
        }
      });

      network.once('stabilizationIterationsDone', () => {
        network.fit({ animation: { duration: 800, easingFunction: 'easeInOutQuad' } });
      });
    })();

    return () => {
      cancelled = true;
      if (networkRef.current) {
        networkRef.current.destroy();
        networkRef.current = null;
      }
      if (hoverTimeout) clearTimeout(hoverTimeout);
      if (blurTimeout) clearTimeout(blurTimeout);
    };
  }, [data, visAvailable, activeNodeId, handleNodeClick]);

  const closeMenu = () => setContextMenu((p) => ({ ...p, visible: false }));

  const handleGenerateQuiz = () => {
    if (contextMenu.nodeLabel) onNodeQuiz?.(contextMenu.nodeLabel);
    closeMenu();
  };

  const handleCreateFlashcards = () => {
    if (contextMenu.nodeLabel) onNodeFlashcards?.(contextMenu.nodeLabel);
    closeMenu();
  };

  const handleDeepDive = () => {
    if (contextMenu.nodeLabel) onNodeDeepDive?.(contextMenu.nodeLabel);
    closeMenu();
  };

  // vis-network failed to load — the topics are still usable as a plain grid.
  if (visAvailable === false) {
    return (
      <div className="h-full w-full overflow-auto p-4">
        <p className="mb-3 text-center text-xs text-muted-foreground">
          The interactive map could not load. Topics are listed below.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {data.nodes.map((node) => {
            const pct = coverage(node);
            const isActive = node.id === activeNodeId;
            return (
              <button
                key={node.id}
                onClick={() => handleNodeClick(node.id, node.label)}
                className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-all ${
                  isActive
                    ? 'border-accent bg-accent text-white'
                    : 'border-border bg-surface-raised text-white hover:border-accent/50 hover:bg-accent-muted'
                }`}
              >
                {node.label}
                {pct !== null && <span className="ml-1 opacity-70">{pct}%</span>}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (visAvailable === null) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="animate-pulse text-xs text-muted-foreground">Loading map…</div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        className="h-full w-full bg-primary"
        onMouseLeave={closeMenu}
      />

      <div className="absolute right-3 top-3 flex flex-col gap-1.5">
        <button
          onClick={() =>
            networkRef.current?.fit({ animation: { duration: 600, easingFunction: 'easeInOutQuad' } })
          }
          className="rounded-lg bg-accent px-2.5 py-1.5 text-[10px] font-bold text-white transition-colors hover:bg-accent-hover"
        >
          Fit
        </button>
        <button
          onClick={() => {
            if (networkRef.current) {
              const s = networkRef.current.getScale();
              networkRef.current.moveTo({ scale: s * 1.25 });
            }
          }}
          aria-label="Zoom in"
          className="rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 text-[10px] font-bold text-white transition-colors hover:bg-surface-overlay"
        >
          +
        </button>
        <button
          onClick={() => {
            if (networkRef.current) {
              const s = networkRef.current.getScale();
              networkRef.current.moveTo({ scale: s * 0.8 });
            }
          }}
          aria-label="Zoom out"
          className="rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 text-[10px] font-bold text-white transition-colors hover:bg-surface-overlay"
        >
          −
        </button>
      </div>

      <div className="absolute bottom-3 left-3">
        <p className="rounded-lg bg-black/70 px-2.5 py-1 text-[10px] text-muted">
          Click a node to explore • Hover for actions
        </p>
      </div>

      <NodeContextMenu
        visible={contextMenu.visible}
        x={contextMenu.x}
        y={contextMenu.y}
        nodeLabel={contextMenu.nodeLabel}
        onGenerateQuiz={handleGenerateQuiz}
        onCreateFlashcards={handleCreateFlashcards}
        onDeepDive={handleDeepDive}
      />
    </div>
  );
}
