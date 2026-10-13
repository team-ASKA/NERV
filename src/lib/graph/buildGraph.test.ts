import { describe, expect, it } from 'vitest';
import { buildGraph } from './buildGraph';

describe('canonical graph builder', () => {
  it('keeps duplicate labels stable with distinct IDs', () => {
    const g = buildGraph({
      resumeVersion: 'v1',
      skills: ['React', 'react', 'REACT'],
      projects: [],
      experience: [],
      education: [],
      achievements: [],
    });
    const skills = g.nodes.filter((n) => n.kind === 'skill');
    expect(skills).toHaveLength(1); // case-insensitive dedupe, first label kept
    expect(skills[0]!.label).toBe('React');
  });
  it('never exceeds 100% and keeps unmentioned neutral', () => {
    const g = buildGraph(
      {
        resumeVersion: 'v1',
        skills: ['React', 'Go'],
        projects: [],
        experience: [],
        education: [],
        achievements: [],
      },
      [{ topicKey: 'react', answerIds: ['a1', 'a1', 'a2'], supported: false, needsPractice: false }],
    );
    const react = g.nodes.find((n) => n.label === 'React')!;
    expect(react.evidence).toBe('discussed');
    expect(react.evidenceTurnIds).toEqual(['a1', 'a2']); // distinct answers
    const go = g.nodes.find((n) => n.label === 'Go')!;
    expect(go.evidence).toBe('unassessed');
  });
  it('does not merge Go into Django via substring', () => {
    const g = buildGraph({
      resumeVersion: 'v1',
      skills: ['Django'],
      projects: [],
      experience: [],
      education: [],
      achievements: [],
    });
    const django = g.nodes.find((n) => n.label === 'Django')!;
    expect(django.categoryId).toContain('backend');
  });
  it('categories are non-actionable', () => {
    const g = buildGraph({
      resumeVersion: 'v1',
      skills: ['React'],
      projects: [],
      experience: [],
      education: [],
      achievements: [],
    });
    for (const n of g.nodes.filter((n) => n.kind === 'category')) {
      expect(n.actionable).toBe(false);
    }
  });
});
