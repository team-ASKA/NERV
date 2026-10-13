import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TopicEdge, TopicNode } from '../../shared/graph';
import { coverageLabel } from '../lib/graph/buildGraph';

export interface GraphSelection {
  topicId: string;
  action: 'explain' | 'quiz' | 'flashcards' | 'deep-dive';
}

interface KnowledgeGraphProps {
  nodes?: TopicNode[];
  edges?: TopicEdge[];
  activeNodeId?: string | null;
  onSelect?: (node: TopicNode) => void;
  onAction?: (sel: GraphSelection) => void;
  availableActions?: Array<GraphSelection['action']>;
  /** Legacy adapter props (old routes): converted to canonical topics. */
  data?: { nodes: Array<{ id: string | number; label: string }>; edges: Array<{ from?: string | number; to?: string | number; source?: string | number; target?: string | number }> };
  onNodeSelect?: (nodeId: string, nodeLabel: string) => void;
  onNodeExplain?: (nodeLabel: string) => void;
  onNodeQuiz?: (nodeLabel: string) => void;
  onNodeFlashcards?: (nodeLabel: string) => void;
  onNodeDeepDive?: (nodeLabel: string) => void;
}

/** Legacy GraphData shape for the old routes (adapters). */
export interface GraphData {
  nodes: Array<{ id: string | number; label: string; level?: number; mentionCount?: number; totalQuestions?: number }>;
  edges: Array<{ from?: string | number; to?: string | number; source?: string | number; target?: string | number }>;
}

const ACTION_LABELS: Record<GraphSelection['action'], string> = {
  explain: 'Explain',
  quiz: 'Quiz',
  flashcards: 'Flashcards',
  'deep-dive': 'Deep dive',
};

function evidenceColor(ev: TopicNode['evidence']): string {
  switch (ev) {
    case 'discussed':
      return '#6366F1';
    case 'supported':
      return '#22C55E';
    case 'needs-practice':
      return '#F59E0B';
    default:
      return '#3F3F46';
  }
}

/**
 * Stable vis-network lifecycle (G02):
 * - One Network per mounted container; DataSets in refs, diffed in place.
 * - Handlers registered once; latest callbacks via refs.
 * - Selection updates colors + selectNodes, never the instance.
 * - Viewport persisted across cosmetic updates; fit only on first mount/Fit.
 * - ResizeObserver + nonzero-size guard; destroy exactly once.
 * - Import/constructor failure → accessible list with retry, never blank canvas.
 * - Keyboard list always available; click selects + opens detail, never fires
 *   an LLM call or navigation by itself.
 */
export function KnowledgeGraph(props: KnowledgeGraphProps) {
  // Legacy adapter: old call sites pass `data` + label callbacks. Convert to
  // canonical stable-ID topics (unassessed, actionable leaves) so the old
  // routes keep working without their own builder.
  const legacy = props.data
    ? {
        nodes: props.data.nodes.map((n): TopicNode => {
          const label = String(n.label).split('\n')[0] ?? String(n.id);
          const id = `legacy:${String(n.id)}`;
          return {
            id,
            kind: label === 'Your profile' ? 'root' : 'skill',
            label,
            shortLabel: label.length > 22 ? `${label.slice(0, 21)}…` : label,
            evidence: 'unassessed',
            evidenceTurnIds: [],
            actionable: label !== 'Your profile',
          };
        }),
        edges: props.data.edges
          .map((e, i): TopicEdge | null => {
            const from = e.from ?? e.source;
            const to = e.to ?? e.target;
            if (from == null || to == null) return null;
            return { id: `legacy-edge-${i}`, from: `legacy:${String(from)}`, to: `legacy:${String(to)}`, kind: 'contains' };
          })
          .filter((e): e is TopicEdge => e !== null),
      }
    : null;

  const {
    activeNodeId,
    onSelect,
    onAction,
    availableActions = ['explain', 'quiz', 'flashcards', 'deep-dive'],
  } = props;
  const nodes = useMemo(
    () => props.nodes ?? legacy?.nodes ?? [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.nodes, props.data],
  );
  const edges = useMemo(
    () => props.edges ?? legacy?.edges ?? [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.edges, props.data],
  );
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const networkRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodesDs = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const edgesDs = useRef<any>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [selectedId, setSelectedId] = useState<string | null>(activeNodeId ?? null);
  const [query, setQuery] = useState('');
  const [evidenceFilter, setEvidenceFilter] = useState<'all' | TopicNode['evidence']>('all');
  const [showList, setShowList] = useState(false);
  const fittedOnce = useRef(false);
  const viewport = useRef<{ scale: number; position: { x: number; y: number } } | null>(null);

  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const legacyRef = useRef(props);
  legacyRef.current = props;
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  const emitSelect = useCallback((node: TopicNode) => {
    onSelectRef.current?.(node);
    const l = legacyRef.current;
    // Legacy: one click selects AND explains (old behavior preserved for old routes).
    l.onNodeSelect?.(node.id, node.label);
    l.onNodeExplain?.(node.label);
  }, []);

  const selected = useMemo(
    () => nodes.find((n) => n.id === (selectedId ?? activeNodeId)) ?? null,
    [nodes, selectedId, activeNodeId],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = nodes.filter((n) => n.kind !== 'root');
    if (evidenceFilter !== 'all') list = list.filter((n) => n.evidence === evidenceFilter);
    if (q) list = list.filter((n) => n.label.toLowerCase().includes(q) || n.shortLabel.toLowerCase().includes(q));
    const CAP = 80;
    return { list: list.slice(0, CAP), total: list.length, capped: list.length > CAP };
  }, [nodes, query, evidenceFilter]);

  // Mount once.
  useEffect(() => {
    let cancelled = false;
    const holder: { observer: ResizeObserver | null } = { observer: null };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let network: any = null;

    (async () => {
      try {
        const el = containerRef.current;
        if (!el) return;
        if (el.clientWidth === 0 || el.clientHeight === 0) {
          // Container hidden (tab/drawer): wait for visibility instead of
          // mounting at zero size.
          await new Promise<void>((resolve) => {
            const obs = new ResizeObserver(() => {
              if ((containerRef.current?.clientWidth ?? 0) > 0 && (containerRef.current?.clientHeight ?? 0) > 0) resolve();
            });
            holder.observer = obs;
            if (containerRef.current) obs.observe(containerRef.current);
            setTimeout(resolve, 3000);
          });
          if (cancelled || !containerRef.current) return;
          holder.observer?.disconnect();
          holder.observer = null;
        }
        const [{ Network }, { DataSet }] = await Promise.all([import('vis-network'), import('vis-data')]);
        if (cancelled || !containerRef.current) return;

        nodesDs.current = new DataSet([]);
        edgesDs.current = new DataSet([]);
        const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
        network = new Network(
          containerRef.current,
          { nodes: nodesDs.current, edges: edgesDs.current },
          {
            layout: { improvedLayout: true, randomSeed: 42 },
            physics: {
              enabled: !reduced,
              stabilization: { enabled: true, iterations: 150 },
              barnesHut: { gravitationalConstant: -8000, centralGravity: 0.3, springLength: 110, springConstant: 0.04, damping: 0.09 },
            },
            interaction: { hover: false, dragNodes: true, dragView: true, zoomView: true, keyboard: false },
          },
        );
        networkRef.current = network;
        network.on('click', (event: { nodes: string[] }) => {
          const id = event.nodes?.[0];
          if (!id) return;
          const node = nodesRef.current.find((n) => n.id === id);
          if (!node) return;
          // Click selects + opens detail only. Root/category expands groups,
          // never tutors. No automatic LLM call or navigation.
          setSelectedId(id);
          emitSelect(node);
        });
        network.on('dragEnd', () => {
          try {
            viewport.current = { scale: network.getScale(), position: network.getViewPosition() };
          } catch {
            /* ignore */
          }
        });
        network.on('zoom', () => {
          try {
            viewport.current = { scale: network.getScale(), position: network.getViewPosition() };
          } catch {
            /* ignore */
          }
        });
        holder.observer = new ResizeObserver(() => {
          try {
            network?.redraw();
          } catch {
            /* ignore */
          }
        });
        if (containerRef.current) holder.observer.observe(containerRef.current);
        if (!cancelled) setStatus('ready');
      } catch {
        if (!cancelled) setStatus('failed');
      }
    })();

    return () => {
      cancelled = true;
      holder.observer?.disconnect();
      holder.observer = null;
      try {
        network?.off?.('click');
        network?.destroy();
      } catch {
        /* ignore */
      }
      networkRef.current = null;
      nodesDs.current = null;
      edgesDs.current = null;
    };
  }, [emitSelect]);

  // Diff data in place; never recreate the instance on selection/callbacks.
  useEffect(() => {
    if (status !== 'ready' || !nodesDs.current || !edgesDs.current) return;
    const visNodes = visible.list.map((n) => ({
      id: n.id,
      label: `${n.shortLabel}`,
      title: `${n.label}\n${coverageLabel(n)}`,
      color: {
        background: n.id === (selectedId ?? activeNodeId) ? '#818CF8' : evidenceColor(n.evidence),
        border: '#C7D2FE',
        highlight: { background: '#818CF8', border: '#C7D2FE' },
      },
      font: { size: 13, color: '#FFFFFF', face: 'Inter, sans-serif' },
      shape: n.kind === 'category' ? 'box' : n.evidence === 'unassessed' ? 'dot' : 'dot',
      size: n.kind === 'category' ? 22 : 16,
      borderWidth: n.id === (selectedId ?? activeNodeId) ? 3 : 1,
    }));
    const nodeIds = new Set(visNodes.map((n) => n.id));
    try {
      const existing: string[] = nodesDs.current.getIds();
      nodesDs.current.remove(existing.filter((id: string) => !nodeIds.has(id)));
      nodesDs.current.update(visNodes);
      const validEdges = edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));
      const edgeRows = validEdges.map((e) => ({ id: e.id, from: e.from, to: e.to }));
      const existingE: string[] = edgesDs.current.getIds();
      const wantE = new Set(edgeRows.map((e) => e.id));
      edgesDs.current.remove(existingE.filter((id: string) => !wantE.has(id)));
      edgesDs.current.update(edgeRows);
      // Restore viewport on cosmetic updates; fit only first nonempty mount.
      if (!fittedOnce.current && visNodes.length > 0) {
        fittedOnce.current = true;
        networkRef.current?.fit({ animation: false });
      } else if (viewport.current) {
        networkRef.current?.moveTo({ scale: viewport.current.scale, position: viewport.current.position, animation: false });
      }
      if (selectedId ?? activeNodeId) {
        try {
          networkRef.current?.selectNodes([selectedId ?? activeNodeId]);
        } catch {
          /* ignore */
        }
      }
    } catch {
      setStatus('failed');
    }
  }, [status, visible, edges, selectedId, activeNodeId]);

  const fit = useCallback(() => {
    try {
      networkRef.current?.fit({ animation: false });
    } catch {
      /* ignore */
    }
  }, []);

  const fireAction = useCallback(
    (action: GraphSelection['action']) => {
      if (!selected || !selected.actionable) return;
      onAction?.({ topicId: selected.id, action });
      const l = legacyRef.current;
      if (action === 'quiz') l.onNodeQuiz?.(selected.label);
      else if (action === 'flashcards') l.onNodeFlashcards?.(selected.label);
      else if (action === 'deep-dive') l.onNodeDeepDive?.(selected.label);
      else l.onNodeExplain?.(selected.label);
    },
    [selected, onAction],
  );

  if (status === 'failed') {
    return (
      <TopicList
        nodes={visible.list}
        total={visible.total}
        capped={visible.capped}
        selectedId={selectedId ?? activeNodeId ?? null}
        onPick={(n) => {
          setSelectedId(n.id);
          emitSelect(n);
        }}
        notice="The interactive map could not load. All topics remain usable below."
        onRetry={() => window.location.reload()}
      />
    );
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          aria-label="Search topics"
          placeholder="Search topics"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-input-bg px-3 text-sm text-white"
        />
        <select
          aria-label="Filter by evidence"
          value={evidenceFilter}
          onChange={(e) => setEvidenceFilter(e.target.value as typeof evidenceFilter)}
          className="h-10 rounded-lg border border-border bg-input-bg px-2 text-sm text-white"
        >
          <option value="all">All evidence</option>
          <option value="unassessed">Unassessed</option>
          <option value="discussed">Discussed</option>
          <option value="supported">Supported</option>
          <option value="needs-practice">Needs practice</option>
        </select>
        <button type="button" onClick={fit} className="h-10 rounded-lg bg-accent px-3 text-sm font-semibold text-white">
          Fit
        </button>
        <button
          type="button"
          onClick={() => setShowList((v) => !v)}
          aria-expanded={showList}
          className="h-10 rounded-lg border border-border px-3 text-sm text-white"
        >
          {showList ? 'Graph' : 'List'}
        </button>
      </div>

      {showList ? (
        <TopicList
          nodes={visible.list}
          total={visible.total}
          capped={visible.capped}
          selectedId={selectedId ?? activeNodeId ?? null}
          onPick={(n) => {
            setSelectedId(n.id);
            emitSelect(n);
          }}
        />
      ) : (
        <div className="relative min-h-64 flex-1">
          <div ref={containerRef} className="absolute inset-0" role="application" aria-label="Skill map graph" />
          {status === 'loading' && (
            <div className="absolute inset-0 flex items-center justify-center" aria-hidden>
              <div className="h-64 w-full animate-pulse rounded-xl bg-white/5" />
            </div>
          )}
        </div>
      )}

      {selected && (
        <div className="rounded-xl border border-border bg-surface-raised p-4" aria-live="polite">
          <p className="font-semibold text-white">{selected.label}</p>
          <p className="mt-0.5 text-sm text-white/60">
            {coverageLabel(selected)} · {selected.evidence.replace('-', ' ')}
          </p>
          {selected.sourceText && <p className="mt-2 text-sm text-white/80">{selected.sourceText}</p>}
          {selected.actionable ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {availableActions.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => fireAction(a)}
                  className="h-10 rounded-lg bg-accent px-3 text-sm font-semibold text-white hover:bg-accent-hover"
                >
                  {ACTION_LABELS[a]}
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-white/50">Categories group topics — pick a skill, project, or experience to practise.</p>
          )}
        </div>
      )}

      <p className="text-xs text-white/40">
        Node size and legend agree: categories are boxes; topics are dots. Color shows evidence, never size. A mention alone
        never marks a skill supported.
      </p>
    </div>
  );
}

function TopicList({
  nodes,
  total,
  capped,
  selectedId,
  onPick,
  notice,
  onRetry,
}: {
  nodes: TopicNode[];
  total: number;
  capped: boolean;
  selectedId: string | null;
  onPick: (n: TopicNode) => void;
  notice?: string;
  onRetry?: () => void;
}) {
  if (nodes.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-6 text-center">
        <p className="font-semibold text-white">No topics yet</p>
        <p className="mt-1 text-sm text-white/60">Upload a resume to build your practice map.</p>
      </div>
    );
  }
  return (
    <div>
      {notice && (
        <p className="mb-2 text-sm text-white/60" role="status">
          {notice}{' '}
          {onRetry && (
            <button type="button" onClick={onRetry} className="text-indigo-300 underline">
              Retry
            </button>
          )}
        </p>
      )}
      <ul className="grid gap-2 sm:grid-cols-2">
        {nodes.map((n) => (
          <li key={n.id}>
            <button
              type="button"
              onClick={() => onPick(n)}
              aria-pressed={selectedId === n.id}
              className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                selectedId === n.id ? 'border-accent bg-accent text-white' : 'border-border bg-surface-raised text-white'
              }`}
            >
              <span className="font-semibold">{n.label}</span>
              <span className="mt-0.5 block text-xs opacity-70">{coverageLabel(n)}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-white/40">
        Showing {nodes.length} of {total} topics.{capped ? ' Refine search or filters to see more.' : ''}
      </p>
    </div>
  );
}
