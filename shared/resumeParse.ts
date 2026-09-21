/**
 * Resume parsing helpers: section-aware chunking, a deterministic regex
 * extractor, and merge/cap utilities.
 *
 * Long resumes used to be truncated at a fixed character count, which quietly
 * dropped whole sections (usually education and the tail of the project list).
 * Instead we split on recognised headings and pack whole sections into chunks
 * that each fit the model's budget, so nothing is lost — every chunk is parsed
 * and the results are merged.
 *
 * Lives in `shared/` because the Vercel API and the BullMQ worker must extract
 * identically: a resume parsed by one and re-parsed by the other has to produce
 * the same structure, or the interviewer's grounding changes depending on which
 * path ran. Dependency-free by construction — no Node built-ins, no DOM.
 */

/** Fields the parser produces, in the order they matter to the interviewer. */
export interface ParsedResume {
  name: string;
  title: string;
  summary: string;
  skills: string[];
  projects: string[];
  achievements: string[];
  experience: string[];
  education: string[];
}

export const EMPTY_PARSED: ParsedResume = {
  name: '',
  title: '',
  summary: '',
  skills: [],
  projects: [],
  achievements: [],
  experience: [],
  education: [],
};

/** Per-field caps — keeps prompts bounded and the report readable. */
const CAPS: Record<keyof Omit<ParsedResume, 'name' | 'title' | 'summary'>, number> = {
  skills: 24,
  projects: 12,
  achievements: 12,
  experience: 12,
  education: 6,
};

/** Characters per chunk. ~1.8k tokens — comfortable for every provider. */
export const CHUNK_BUDGET = 7000;
/** Hard ceiling on chunks so one pathological upload can't fan out forever. */
export const MAX_CHUNKS = 4;

// ---------------------------------------------------------------------------
// Section detection
// ---------------------------------------------------------------------------

export type SectionKind =
  | 'skills'
  | 'projects'
  | 'achievements'
  | 'experience'
  | 'education'
  | 'summary'
  | 'other';

const HEADINGS: Array<{ kind: SectionKind; re: RegExp }> = [
  { kind: 'skills', re: /^(technical\s+)?(skills?|technologies|tech\s+stack|competenc(?:y|ies)|tools)\b/i },
  { kind: 'projects', re: /^(personal\s+|academic\s+|key\s+)?(projects?|portfolio|open[-\s]?source)\b/i },
  { kind: 'achievements', re: /^(achievements?|accomplishments?|awards?|honou?rs?|activities|extra[-\s]?curricular)\b/i },
  {
    kind: 'experience',
    re: /^(work\s+|professional\s+|relevant\s+)?(experience|employment|internships?|positions?\s+held)\b/i,
  },
  { kind: 'education', re: /^(education|academics?|academic\s+background|qualifications?|certifications?|courses?)\b/i },
  { kind: 'summary', re: /^(summary|profile|objective|about\s+me|professional\s+summary)\b/i },
];

export interface ResumeSection {
  kind: SectionKind;
  heading: string;
  body: string;
}

/**
 * A heading line is short, has no sentence-ending punctuation, and matches one
 * of the known section names (optionally decorated with colons or underscores).
 */
function headingKind(line: string): SectionKind | null {
  const clean = line.trim().replace(/[:•\-_=|]+$/g, '').replace(/^[•\-_=|]+/g, '').trim();
  if (!clean || clean.length > 48) return null;
  if (/[.!?]$/.test(clean)) return null;
  for (const { kind, re } of HEADINGS) {
    if (re.test(clean)) return kind;
  }
  return null;
}

/** Split resume text into sections at recognised headings. */
export function splitSections(text: string): ResumeSection[] {
  const lines = text.split(/\r?\n/);
  const sections: ResumeSection[] = [];
  let current: ResumeSection = { kind: 'other', heading: '', body: '' };
  const buffer: string[] = [];

  const flush = () => {
    const body = buffer.join('\n').trim();
    if (body || current.heading) sections.push({ ...current, body });
    buffer.length = 0;
  };

  for (const line of lines) {
    const kind = headingKind(line);
    if (kind) {
      flush();
      current = { kind, heading: line.trim(), body: '' };
    } else {
      buffer.push(line);
    }
  }
  flush();

  return sections.filter((s) => s.body.length > 0 || s.heading.length > 0);
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

/** Split an oversized section body at line boundaries. */
function splitOversized(section: ResumeSection, budget: number): string[] {
  const out: string[] = [];
  const lines = section.body.split('\n');
  let buf = section.heading ? `${section.heading}\n` : '';

  for (const line of lines) {
    if (buf.length + line.length + 1 > budget && buf.trim()) {
      out.push(buf.trim());
      buf = section.heading ? `${section.heading} (continued)\n` : '';
    }
    buf += `${line}\n`;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/**
 * Pack sections into chunks under `budget`, keeping each section whole where
 * possible. Returns at least one chunk for any non-empty input.
 */
export function chunkResume(text: string, budget = CHUNK_BUDGET, maxChunks = MAX_CHUNKS): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= budget) return [trimmed];

  const sections = splitSections(trimmed);
  const pieces: string[] = [];

  for (const section of sections) {
    const whole = section.heading ? `${section.heading}\n${section.body}` : section.body;
    if (whole.length <= budget) pieces.push(whole.trim());
    else pieces.push(...splitOversized(section, budget));
  }

  // Pack adjacent pieces together so we issue as few model calls as possible.
  const chunks: string[] = [];
  let buf = '';
  for (const piece of pieces) {
    if (buf && buf.length + piece.length + 2 > budget) {
      chunks.push(buf);
      buf = piece;
    } else {
      buf = buf ? `${buf}\n\n${piece}` : piece;
    }
  }
  if (buf) chunks.push(buf);

  if (chunks.length <= maxChunks) return chunks;

  // Too many chunks: keep the first (identity + summary + skills usually live
  // there) and the most substantive remainder, then drop the rest.
  const kept = chunks.slice(0, maxChunks - 1);
  kept.push(chunks.slice(maxChunks - 1).join('\n\n').slice(0, budget));
  return kept;
}

// ---------------------------------------------------------------------------
// Deterministic extraction (no model required)
// ---------------------------------------------------------------------------

const TECH_KEYWORDS = [
  'JavaScript', 'TypeScript', 'Python', 'Java', 'C++', 'C#', 'Go', 'Rust', 'Swift', 'Kotlin', 'Ruby', 'PHP', 'Scala',
  'React', 'Angular', 'Vue', 'Svelte', 'Next.js', 'Node.js', 'Express', 'Django', 'Flask', 'Spring', 'FastAPI',
  'MongoDB', 'MySQL', 'PostgreSQL', 'SQLite', 'Redis', 'GraphQL', 'REST', 'Kafka', 'RabbitMQ', 'Elasticsearch',
  'AWS', 'Azure', 'GCP', 'Docker', 'Kubernetes', 'Terraform', 'Git', 'CI/CD', 'Jenkins', 'Linux',
  'HTML', 'CSS', 'Tailwind', 'SASS', 'Figma', 'Jest', 'Cypress', 'Playwright',
  'Machine Learning', 'Deep Learning', 'TensorFlow', 'PyTorch', 'Pandas', 'NumPy', 'OpenCV', 'NLP', 'LLM',
];

const BULLET = /^[\s•\-*▪◦·o]+|^\d+[.)]\s*/;

function bulletLines(body: string, minLength = 6): string[] {
  return body
    .split('\n')
    .map((l) => l.replace(BULLET, '').trim())
    .filter((l) => l.length >= minLength && !/^[A-Z\s]{0,3}$/.test(l));
}

/**
 * Heading-driven extraction used when no model is available, and merged under
 * the model's output otherwise so obvious items are never missed.
 */
export function regexExtract(text: string): ParsedResume {
  const sections = splitSections(text);
  const byKind = (kind: SectionKind) =>
    sections.filter((s) => s.kind === kind).map((s) => s.body).join('\n');

  const skillsBody = byKind('skills');
  const skills = skillsBody
    ? skillsBody
        .split(/[,;|\n•]/)
        .map((s) => s.replace(BULLET, '').replace(/^[a-z ]+:\s*/i, '').trim())
        .filter((s) => s.length > 1 && s.length < 40)
    : [];

  if (skills.length === 0) {
    const lower = text.toLowerCase();
    for (const kw of TECH_KEYWORDS) {
      if (lower.includes(kw.toLowerCase())) skills.push(kw);
    }
  }

  const achievements = bulletLines(byKind('achievements'));
  // Quantified bullets anywhere in the document are achievements too.
  for (const line of text.split('\n')) {
    const clean = line.replace(BULLET, '').trim();
    if (clean.length < 12 || clean.length > 220) continue;
    if (/\b\d+(\.\d+)?\s?(%|x|k\b|\+)|\b(ranked|won|awarded|first place|runner[- ]up|top \d+)\b/i.test(clean)) {
      achievements.push(clean);
    }
  }

  const education = bulletLines(byKind('education'));
  if (education.length === 0) {
    const degrees = text.match(/(B\.?\s?Tech|M\.?\s?Tech|B\.?E\b|MBA|B\.?Sc|M\.?Sc|Ph\.?D|Bachelor|Master|Diploma)[^\n]{0,110}/gi);
    if (degrees) education.push(...degrees.map((d) => d.trim()));
  }

  const firstLine = text.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  const looksLikeName = /^[A-Za-z][A-Za-z.'-]*(\s+[A-Za-z][A-Za-z.'-]*){0,3}$/.test(firstLine) && firstLine.length <= 48;

  return capResume({
    name: looksLikeName ? firstLine : '',
    title: '',
    summary: byKind('summary').split('\n').filter(Boolean).slice(0, 3).join(' ').slice(0, 400),
    skills,
    projects: bulletLines(byKind('projects')),
    achievements,
    experience: bulletLines(byKind('experience')),
    education,
  });
}

// ---------------------------------------------------------------------------
// Merge + validate
// ---------------------------------------------------------------------------

const dedupeKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function mergeList(...lists: Array<string[] | undefined>): string[] {
  const seen = new Map<string, string>();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      if (typeof raw !== 'string') continue;
      const value = raw.trim().replace(/\s+/g, ' ');
      if (value.length < 2) continue;
      const key = dedupeKey(value);
      if (!key) continue;
      const existing = seen.get(key);
      // Prefer the more informative variant when the same item appears twice.
      if (!existing || value.length > existing.length) seen.set(key, value);
    }
  }
  return [...seen.values()];
}

/** Enforce per-field caps and string lengths. */
export function capResume(input: ParsedResume): ParsedResume {
  const clamp = (list: string[], max: number, maxLen = 240) =>
    list.map((s) => s.slice(0, maxLen)).slice(0, max);

  return {
    name: (input.name || '').slice(0, 80),
    title: (input.title || '').slice(0, 120),
    summary: (input.summary || '').slice(0, 600),
    skills: clamp(input.skills, CAPS.skills, 48),
    projects: clamp(input.projects, CAPS.projects),
    achievements: clamp(input.achievements, CAPS.achievements),
    experience: clamp(input.experience, CAPS.experience),
    education: clamp(input.education, CAPS.education),
  };
}

/**
 * Merge parses from several chunks. Scalars take the first non-empty value
 * (chunk order follows document order, so identity wins from the top of the
 * resume); lists are unioned with case-insensitive de-duplication.
 */
export function mergeParsed(...parts: Array<Partial<ParsedResume> | null | undefined>): ParsedResume {
  const present = parts.filter(Boolean) as Array<Partial<ParsedResume>>;
  const firstNonEmpty = (key: 'name' | 'title' | 'summary') =>
    present.map((p) => (typeof p[key] === 'string' ? p[key]!.trim() : '')).find((v) => v.length > 0) ?? '';

  return capResume({
    name: firstNonEmpty('name'),
    title: firstNonEmpty('title'),
    summary: firstNonEmpty('summary'),
    skills: mergeList(...present.map((p) => p.skills)),
    projects: mergeList(...present.map((p) => p.projects)),
    achievements: mergeList(...present.map((p) => p.achievements)),
    experience: mergeList(...present.map((p) => p.experience)),
    education: mergeList(...present.map((p) => p.education)),
  });
}

/** True when the parse found nothing an interviewer could ground a question in. */
export function isEmptyParse(r: ParsedResume): boolean {
  return (
    r.skills.length === 0 &&
    r.projects.length === 0 &&
    r.experience.length === 0 &&
    r.education.length === 0 &&
    r.achievements.length === 0
  );
}

/**
 * Coerce whatever a model returned into a ParsedResume. Models occasionally
 * emit a string where a list belongs, or omit fields entirely; this never
 * throws, so one malformed chunk cannot fail the whole ingestion.
 */
export function coerceParsed(value: unknown): ParsedResume {
  if (!value || typeof value !== 'object') return { ...EMPTY_PARSED };
  const raw = value as Record<string, unknown>;

  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const list = (v: unknown): string[] => {
    if (Array.isArray(v)) {
      return v
        .map((item) => {
          if (typeof item === 'string') return item.trim();
          // Models like to return {name, description} objects for projects.
          if (item && typeof item === 'object') {
            const o = item as Record<string, unknown>;
            const parts = [o.name, o.title, o.role, o.description, o.summary, o.degree, o.institution]
              .filter((p): p is string => typeof p === 'string' && p.trim().length > 0);
            return parts.join(' — ');
          }
          return '';
        })
        .filter((s) => s.length > 0);
    }
    if (typeof v === 'string') {
      return v.split(/[,;\n•]/).map((s) => s.trim()).filter((s) => s.length > 1);
    }
    return [];
  };

  return capResume({
    name: str(raw.name),
    title: str(raw.title) || str(raw.role),
    summary: str(raw.summary) || str(raw.profile) || str(raw.objective),
    skills: list(raw.skills ?? raw.technologies),
    projects: list(raw.projects),
    achievements: list(raw.achievements ?? raw.awards),
    experience: list(raw.experience ?? raw.work),
    education: list(raw.education),
  });
}

/** Count words the same way on both sides of the wire — routing depends on it. */
export function countWords(text: string): number {
  const matches = text.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}
