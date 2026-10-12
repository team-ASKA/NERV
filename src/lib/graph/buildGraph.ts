/** Canonical pure graph builder shared by report + training + dashboard. */
import {
  coverageLabel as _coverageLabel,
  shortLabel,
  stableTopicId,
  type BuiltGraph,
  type TopicEdge,
  type TopicEvidence,
  type TopicKind,
  type TopicNode,
} from '../../../shared/graph';

export { _coverageLabel as coverageLabel };

export interface GraphSource {
  resumeVersion: string;
  skills: string[];
  projects: Array<{ id?: string; label: string; text?: string }>;
  experience: Array<{ id?: string; label: string; text?: string }>;
  education: string[];
  achievements: string[];
}

export interface DiscussionEvidence {
  topicKey: string; // lowercase normalized label
  answerIds: string[];
  supported: boolean;
  needsPractice: boolean;
}

const SKILL_CATEGORIES: Array<{ name: string; tokens: string[] }> = [
  { name: 'Frontend', tokens: ['react', 'vue', 'angular', 'typescript', 'javascript', 'html', 'css', 'tailwind', 'next.js', 'redux'] },
  { name: 'Backend', tokens: ['node', 'express', 'python', 'django', 'fastapi', 'java', 'spring', 'go', 'rust', 'postgres', 'mysql', 'mongodb', 'redis'] },
  { name: 'DevOps', tokens: ['docker', 'kubernetes', 'aws', 'gcp', 'azure', 'terraform', 'ci/cd', 'jenkins', 'github actions'] },
  { name: 'Mobile', tokens: ['flutter', 'react native', 'swift', 'kotlin', 'android', 'ios'] },
  { name: 'Data & AI', tokens: ['pytorch', 'tensorflow', 'scikit-learn', 'pandas', 'numpy', 'llm', 'rag', 'langchain', 'ml'] },
  { name: 'Practices', tokens: ['testing', 'jest', 'vitest', 'playwright', 'system design', 'graphql', 'rest', 'websockets', 'microservices'] },
];

function norm(s: string): string {
  return s.trim().toLowerCase();
}

function categoryFor(skill: string): string {
  const n = ` ${norm(skill)} `;
  for (const c of SKILL_CATEGORIES) {
    for (const t of c.tokens) {
      // Exact token match on padded string: avoids 'go' matching 'django', etc.
      if (n.includes(` ${t} `) || norm(skill) === t) return c.name;
    }
  }
  return 'Other';
}

export function buildGraph(source: GraphSource, evidence: DiscussionEvidence[] = []): BuiltGraph {
  const warnings: string[] = [];
  const nodes: TopicNode[] = [];
  const edges: TopicEdge[] = [];
  const seen = new Set<string>();
  const evByKey = new Map(evidence.map((e) => [norm(e.topicKey), e]));

  const pushNode = (n: TopicNode) => {
    if (seen.has(n.id)) {
      warnings.push(`Duplicate node id ${n.id} skipped.`);
      return;
    }
    seen.add(n.id);
    nodes.push(n);
  };
  const pushEdge = (from: string, to: string, kind: TopicEdge['kind']) => {
    const id = `edge:${from}→${to}:${kind}`;
    if (edges.some((e) => e.id === id)) return;
    edges.push({ id, from, to, kind });
  };

  const root: TopicNode = {
    id: `root:${source.resumeVersion}`,
    kind: 'root',
    label: 'Your practice map',
    shortLabel: 'Practice map',
    evidence: 'unassessed',
    evidenceTurnIds: [],
    actionable: false,
  };
  pushNode(root);

  // Categories first (stable, curated).
  const catIds = new Map<string, string>();
  for (const c of [...SKILL_CATEGORIES.map((c) => c.name), 'Other']) {
    const id = stableTopicId('category', source.resumeVersion, c);
    catIds.set(c, id);
    pushNode({ id, kind: 'category', label: c, shortLabel: shortLabel(c), evidence: 'unassessed', evidenceTurnIds: [], actionable: false, categoryId: id });
    pushEdge(root.id, id, 'contains');
  }

  const evidenceFor = (label: string): { ev: TopicEvidence; ids: string[]; d: number; e: number } => {
    const hit = evByKey.get(norm(label));
    if (!hit || hit.answerIds.length === 0) return { ev: 'unassessed', ids: [], d: 0, e: 0 };
    const distinct = [...new Set(hit.answerIds)];
    if (hit.needsPractice) return { ev: 'needs-practice', ids: distinct, d: distinct.length, e: distinct.length };
    if (hit.supported) return { ev: 'supported', ids: distinct, d: distinct.length, e: distinct.length };
    return { ev: 'discussed', ids: distinct, d: distinct.length, e: distinct.length };
  };

  const addSkill = (skill: string, entityId?: string, text?: string) => {
    const cat = categoryFor(skill);
    const catId = catIds.get(cat) ?? catIds.get('Other')!;
    const id = stableTopicId('skill', source.resumeVersion, entityId ?? skill);
    const { ev, ids, d, e } = evidenceFor(skill);
    pushNode({
      id, kind: 'skill', label: skill.trim(), shortLabel: shortLabel(skill),
      sourceEntityId: entityId, sourceText: text, categoryId: catId,
      evidence: ev as TopicEvidence, evidenceTurnIds: ids,
      discussedAnswerCount: d, eligibleAnswerCount: Math.max(e, ids.length > 0 ? ids.length : 0),
      actionable: true,
    });
    pushEdge(catId, id, 'contains');
  };

  const addEntity = (kind: Extract<TopicKind, 'project' | 'experience' | 'education' | 'achievement'>, label: string, entityId?: string, text?: string) => {
    if (!label.trim()) return;
    const id = stableTopicId(kind, source.resumeVersion, entityId ?? label);
    const { ev, ids, d, e } = evidenceFor(label);
    pushNode({
      id, kind, label: label.trim(), shortLabel: shortLabel(label),
      sourceEntityId: entityId, sourceText: text ?? label,
      evidence: ev, evidenceTurnIds: ids,
      discussedAnswerCount: d, eligibleAnswerCount: Math.max(e, 0),
      actionable: kind === 'project' || kind === 'experience',
    });
    pushEdge(root.id, id, 'contains');
  };

  // Dedupe case-insensitively but keep the first display label.
  const seenSkill = new Set<string>();
  for (const s of source.skills) {
    const k = norm(s);
    if (!k || seenSkill.has(k)) continue;
    seenSkill.add(k);
    addSkill(s);
  }
  source.projects.forEach((p, i) => addEntity('project', p.label, p.id ?? `project-${i}`, p.text));
  source.experience.forEach((x, i) => addEntity('experience', x.label, x.id ?? `experience-${i}`, x.text));
  const seenEdu = new Set<string>();
  for (const e of source.education) {
    if (!e.trim() || seenEdu.has(norm(e))) continue;
    seenEdu.add(norm(e));
    addEntity('education', e);
  }
  const seenAch = new Set<string>();
  for (const a of source.achievements) {
    if (!a.trim() || seenAch.has(norm(a))) continue;
    seenAch.add(norm(a));
    addEntity('achievement', a);
  }

  return { nodes, edges, warnings };
}
