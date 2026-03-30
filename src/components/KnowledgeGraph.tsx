import { useEffect, useRef, useState, useCallback } from 'react';
import { NodeContextMenu } from './NodeContextMenu';

export interface GraphNode {
  id: string | number;
  label: string;
  level?: number;
  mentionCount?: number; // times mentioned in interview
  totalQuestions?: number; // total questions in interview
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
}

function getKeystoneNodeColor(level: number): string {
  const colors = ['#D4AF37', '#B8860B', '#CD853F', '#A0522D'];
  return colors[Math.min(level, colors.length - 1)];
}
function getKeystoneBorderColor(level: number): string {
  const colors = ['#B8860B', '#8B7355', '#8B4513', '#654321'];
  return colors[Math.min(level, colors.length - 1)];
}
function getKeystoneHoverColor(level: number): string {
  const colors = ['#FFD700', '#DAA520', '#DEB887', '#BC8F8F'];
  return colors[Math.min(level, colors.length - 1)];
}

/**
 * Interactive knowledge graph — vis-network based.
 * Falls back to a simple pill grid if vis-network is not installed.
 */
export function KnowledgeGraph({
  data,
  activeNodeId,
  onNodeSelect,
  onNodeExplain,
  onNodeQuiz,
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

  // Check if vis-network is installed
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
    [onNodeSelect, onNodeExplain]
  );

  // Build vis-network when available
  useEffect(() => {
    if (visAvailable !== true || !containerRef.current) return;

    let hoverTimeout: ReturnType<typeof setTimeout> | null = null;

    (async () => {
      const { Network } = await import('vis-network');
      const { DataSet } = await import('vis-data');

      const nodes = new DataSet(
        data.nodes.map((node) => {
          const pct =
            node.totalQuestions && node.mentionCount !== undefined
              ? Math.round((node.mentionCount / node.totalQuestions) * 100)
              : null;
          const label = pct !== null ? `${node.label}\n${pct}%` : node.label;
          return {
            id: node.id,
            label,
            level: node.level,
            color: {
              background:
                node.id === activeNodeId ? '#FFD700' : getKeystoneNodeColor(node.level || 0),
              border:
                node.id === activeNodeId ? '#B8860B' : getKeystoneBorderColor(node.level || 0),
              highlight: { background: '#FFD700', border: '#D4AF37' },
              hover: { background: getKeystoneHoverColor(node.level || 0), border: '#D4AF37' },
            },
            font: { size: 12, color: '#FFFFFF', face: 'Inter, sans-serif', bold: '600' },
            shape: 'hexagon',
            size: 28 + (3 - (node.level || 0)) * 6,
            borderWidth: node.id === activeNodeId ? 4 : 2,
            shadow: { enabled: true, color: 'rgba(212,175,55,0.3)', size: 8, x: 3, y: 3 },
          };
        })
      );

      const edges = new DataSet(
        data.edges.map((edge, idx) => ({
          id: idx,
          from: edge.from ?? edge.source,
          to: edge.to ?? edge.target,
          color: { color: '#444', highlight: '#D4AF37', hover: '#FFD700', opacity: 0.7 },
          width: 2,
          smooth: { enabled: true, type: 'dynamic', roundness: 0.3 },
          arrows: { to: { enabled: true, scaleFactor: 1, type: 'arrow' } },
        }))
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
      const network = new Network(containerRef.current!, { nodes: nodes as any, edges: edges as any }, options);
      networkRef.current = network;

      network.on('hoverNode', (event: any) => {
        const node = data.nodes.find((n) => n.id === event.node);
        if (node && containerRef.current) {
          const rect = containerRef.current.getBoundingClientRect();
          const pos = network.canvasToDOM({ x: event.pointer.canvas.x, y: event.pointer.canvas.y });
          if (hoverTimeout) clearTimeout(hoverTimeout);
          hoverTimeout = setTimeout(() => {
            setContextMenu({ visible: true, x: rect.left + pos.x, y: rect.top + pos.y - 10, nodeId: event.node, nodeLabel: node.label });
          }, 250);
        }
      });

      network.on('blurNode', () => {
        if (hoverTimeout) { clearTimeout(hoverTimeout); hoverTimeout = null; }
        setTimeout(() => setContextMenu((p) => ({ ...p, visible: false })), 150);
      });

      network.on('click', (event: any) => {
        setContextMenu((p) => ({ ...p, visible: false }));
        if (event.nodes.length > 0) {
          const nodeId = event.nodes[0];
          const node = data.nodes.find((n) => n.id === nodeId);
          if (node) handleNodeClick(nodeId, node.label.split('\n')[0]);
        }
      });

      network.once('stabilizationIterationsDone', () => {
        network.fit({ animation: { duration: 800, easingFunction: 'easeInOutQuad' } });
      });
    })();

    return () => {
      if (networkRef.current) { networkRef.current.destroy(); networkRef.current = null; }
      if (hoverTimeout) clearTimeout(hoverTimeout);
    };
  }, [data, visAvailable, activeNodeId]);

  const handleGenerateQuiz = () => {
    if (contextMenu.nodeLabel && onNodeQuiz) onNodeQuiz(contextMenu.nodeLabel);
    else if (contextMenu.nodeId && onNodeSelect) onNodeSelect(contextMenu.nodeId, `Generate a quiz about: ${contextMenu.nodeLabel}`);
    setContextMenu((p) => ({ ...p, visible: false }));
  };

  const handleCreateFlashcards = () => {
    if (contextMenu.nodeId && onNodeSelect) onNodeSelect(contextMenu.nodeId, `Create flashcards for: ${contextMenu.nodeLabel}`);
    setContextMenu((p) => ({ ...p, visible: false }));
  };

  // Fallback pill grid when vis-network is not installed
  if (visAvailable === false) {
    return (
      <div className="w-full h-full overflow-auto p-4">
        <p className="text-yellow-500/70 text-xs mb-3 text-center">
          Install vis-network for the full graph: <code className="bg-white/10 px-1 rounded">npm install vis-network vis-data</code>
        </p>
        <div className="flex flex-wrap gap-2 justify-center">
          {data.nodes.map((node) => {
            const pct =
              node.totalQuestions && node.mentionCount !== undefined
                ? Math.round((node.mentionCount / node.totalQuestions) * 100)
                : null;
            const isActive = node.id === activeNodeId;
            return (
              <button
                key={node.id}
                onClick={() => handleNodeClick(node.id, node.label)}
                className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-all ${
                  isActive
                    ? 'bg-yellow-500 text-black border-yellow-400'
                    : 'bg-white/5 text-white border-white/10 hover:border-yellow-500/50 hover:bg-yellow-500/10'
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
      <div className="w-full h-full flex items-center justify-center">
        <div className="animate-pulse text-yellow-500/50 text-xs">Loading graph...</div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full">
      <div
        ref={containerRef}
        className="w-full h-full"
        onMouseLeave={() => setContextMenu((p) => ({ ...p, visible: false }))}
        style={{ background: '#111' }}
      />

      {/* Controls */}
      <div className="absolute top-3 right-3 flex flex-col gap-1.5">
        <button
          onClick={() => networkRef.current?.fit({ animation: { duration: 600, easingFunction: 'easeInOutQuad' } })}
          className="px-2.5 py-1.5 bg-yellow-500 hover:bg-yellow-400 text-black font-bold text-[10px] rounded-lg transition-colors"
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
          className="px-2.5 py-1.5 bg-white/10 hover:bg-white/20 text-white font-bold text-[10px] rounded-lg transition-colors"
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
          className="px-2.5 py-1.5 bg-white/10 hover:bg-white/20 text-white font-bold text-[10px] rounded-lg transition-colors"
        >
          −
        </button>
      </div>

      <div className="absolute bottom-3 left-3">
        <p className="bg-black/70 text-gray-400 text-[10px] px-2.5 py-1 rounded-lg">
          Click node to explore • Double-click to focus
        </p>
      </div>

      <NodeContextMenu
        visible={contextMenu.visible}
        x={contextMenu.x}
        y={contextMenu.y}
        nodeLabel={contextMenu.nodeLabel}
        onGenerateQuiz={handleGenerateQuiz}
        onCreateFlashcards={handleCreateFlashcards}
      />
    </div>
  );
}
