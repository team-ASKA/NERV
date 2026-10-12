/**
 * Canonical topic-graph model. IDs are stable (type + entity), never parsed
 * out of display labels. Evidence is explicit; mentions alone never imply skill.
 */

export type TopicKind = 'root' | 'category' | 'skill' | 'project' | 'experience' | 'education' | 'achievement';
export type TopicEvidence = 'unassessed' | 'discussed' | 'supported' | 'needs-practice';

export interface TopicNode {
  id: string;
  kind: TopicKind;
  label: string;
  shortLabel: string;
  sourceEntityId?: string;
  sourceText?: string;
  categoryId?: string;
  evidence: TopicEvidence;
  evidenceTurnIds: string[];
  discussedAnswerCount?: number;
  eligibleAnswerCount?: number;
  actionable: boolean;
}

export interface TopicEdge {
  id: string;
  from: string;
  to: string;
  kind: 'contains' | 'uses';
}

export interface BuiltGraph {
  nodes: TopicNode[];
  edges: TopicEdge[];
  warnings: string[];
}

export function shortLabel(label: string, max = 22): string {
  const t = label.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function stableTopicId(kind: TopicKind, scope: string, key: string): string {
  const norm = key.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'topic';
  return `${kind}:${scope}:${norm}`;
}

export function coverageLabel(n: Pick<TopicNode, 'discussedAnswerCount' | 'eligibleAnswerCount'>): string {
  const d = n.discussedAnswerCount ?? 0;
  const e = n.eligibleAnswerCount ?? 0;
  if (!e || e <= 0) return d > 0 ? `Discussed in ${d} answer${d === 1 ? '' : 's'}` : 'Not yet discussed';
  const pct = Math.max(0, Math.min(100, Math.round((d / e) * 100)));
  return `${pct}% discussed · ${d}/${e} answers`;
}
