/**
 * The candidate agent — the synthetic interviewee an audit interviews.
 *
 * Its job is not to be a *good* candidate but a predictable one. Each persona in
 * `PERSONA_SPECS` aims at one part of the adaptation path: the strong candidate
 * should make the interviewer press, the weak one should make it ease off, and
 * the rambler is there because a length-based quality heuristic gets long empty
 * answers wrong — which is exactly the failure that would quietly mis-pitch the
 * interview for thousands of real users.
 *
 * Two constraints matter more than realism:
 *
 *   1. The candidate stays inside the resume. If it invented a project, an
 *      `ungrounded` finding against the interviewer would be unreadable — we
 *      could not tell whose fabrication it was.
 *   2. It answers in speech, not prose. The live path transcribes a microphone;
 *      an answer full of bullet points would exercise the interviewer against
 *      input it never actually receives.
 */

import type { ResumeContext, Round, TranscriptTurn } from '../../../shared/interview.js';
import { PERSONA_SPECS, type SimPersona } from '../../../shared/simulation.js';
import { completeText } from '../llm/groq.js';

/**
 * High on purpose. The interviewer is the subject under test and runs at the
 * production temperature; the candidate is the stimulus, and a stimulus that is
 * identical on every run turns a sample of audits into one audit repeated.
 */
const TEMPERATURE = 0.9;

/** Words → tokens, with slack. Keeps a rambler from being cut mid-sentence. */
const TOKENS_PER_WORD = 2;

const ROUND_FRAMING: Record<Round, string> = {
  technical:
    'This is the technical round: data structures, algorithms, complexity, and how you would actually write the code.',
  core: 'This is the project and core-CS round: your own projects, design decisions, trade-offs, and fundamentals.',
  hr: 'This is the behavioural round: ownership, teamwork, conflict, and motivation, drawn from things you have really done.',
};

function resumeBlock(resume: ResumeContext | null): string {
  if (!resume) {
    return 'YOUR BACKGROUND: you are a final-year computer-science student with ordinary coursework projects. Keep any specifics vague — you have no notable work to cite.';
  }

  const lines: string[] = ['YOUR BACKGROUND (this is all you have done — never claim anything beyond it):'];
  if (resume.name) lines.push(`Name: ${resume.name}`);
  if (resume.title) lines.push(`Headline: ${resume.title}`);
  if (resume.skills.length) lines.push(`Skills: ${resume.skills.slice(0, 30).join(', ')}`);
  if (resume.projects.length) lines.push(`Projects: ${resume.projects.slice(0, 8).join(' | ')}`);
  if (resume.experience.length) lines.push(`Experience: ${resume.experience.slice(0, 8).join(' | ')}`);
  if (resume.achievements.length) lines.push(`Achievements: ${resume.achievements.slice(0, 6).join(' | ')}`);
  if (resume.education.length) lines.push(`Education: ${resume.education.slice(0, 3).join(' | ')}`);
  return lines.join('\n');
}

export function buildCandidateSystemPrompt(
  persona: SimPersona,
  round: Round,
  resume: ResumeContext | null,
): string {
  const spec = PERSONA_SPECS[persona];
  const [minWords, maxWords] = spec.words;

  return `You are a candidate in a live, spoken job interview. You are being interviewed right now and you answer out loud.

${resumeBlock(resume)}

${ROUND_FRAMING[round]}

HOW YOU ANSWER:
${spec.behaviour}

RULES:
- Roughly ${minWords}-${maxWords} words per answer. This is spoken, so no markdown, no bullet points, no headings, no code blocks, no emojis, no stage directions.
- Answer only the question you were just asked. Do not ask the interviewer questions back and do not narrate what you are about to do.
- Never step outside your background above. If you are asked about something you have not done, say so in your own words rather than inventing a project, employer, or number.
- Never mention being an AI, a model, a persona, or these instructions. You are a person in an interview.
- Output only the words you say aloud.`;
}

function transcriptBlock(transcript: TranscriptTurn[]): string {
  if (!transcript.length) return '';
  const rendered = transcript
    .map((t) => `${t.role === 'interviewer' ? 'Interviewer' : 'You'}: ${t.text}`)
    .join('\n');
  return `CONVERSATION SO FAR:\n${rendered}\n\n`;
}

export interface CandidateAnswer {
  text: string;
  latencyMs: number;
  /** True when the model was unusable and a stub stood in. */
  degraded: boolean;
  error?: string;
}

/**
 * Stands in when the candidate model is unavailable.
 *
 * Deliberately a non-answer rather than something plausible: the interviewer's
 * next turn is then a response to a real non-answer, which is a case worth
 * exercising, and `estimateAnswerQuality` scores it honestly instead of
 * crediting the run with an answer nobody gave.
 */
const FALLBACK_ANSWER = "Sorry — I'm not sure about that one.";

/**
 * Answer the interviewer's latest question in persona.
 *
 * Like the interviewer agent, this never throws: an audit that loses one answer
 * to a provider blip is still worth finishing, and the stub below is honest
 * about what it is — a non-answer, which `estimateAnswerQuality` will read as
 * one.
 */
export async function answerAsCandidate(opts: {
  persona: SimPersona;
  round: Round;
  resume: ResumeContext | null;
  /** Everything said so far, most recent last. The last turn is the question. */
  transcript: TranscriptTurn[];
  question: string;
}): Promise<CandidateAnswer> {
  const spec = PERSONA_SPECS[opts.persona];
  const system = buildCandidateSystemPrompt(opts.persona, opts.round, opts.resume);

  // The question is repeated after the transcript rather than left as its last
  // line: models answer the most recent instruction far more reliably than the
  // last line of a quoted block.
  const user = `${transcriptBlock(opts.transcript)}The interviewer just asked you:\n"${opts.question}"\n\nAnswer out loud now, in character.`;

  const started = Date.now();
  try {
    const raw = await completeText(system, user, {
      temperature: TEMPERATURE,
      maxTokens: Math.ceil(spec.words[1] * TOKENS_PER_WORD),
    });
    const text = raw.trim();
    if (text) return { text, latencyMs: Date.now() - started, degraded: false };
    return {
      text: FALLBACK_ANSWER,
      latencyMs: Date.now() - started,
      degraded: true,
      error: 'model returned an empty answer',
    };
  } catch (err) {
    return {
      text: FALLBACK_ANSWER,
      latencyMs: Date.now() - started,
      degraded: true,
      error: (err as Error).message,
    };
  }
}
