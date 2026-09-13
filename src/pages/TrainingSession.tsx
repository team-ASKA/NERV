/**
 * Training session — the tutor that runs on what the interview actually found.
 *
 * The knowledge graph is built from the parsed resume; the tutor is a thin
 * client over `/api/tutor` (persona and provider live on the server). Voice is
 * the same stack the interview uses: `voiceService` for STT/TTS through the
 * proxies, Silero VAD for hands-free turn-taking with push-to-talk as the
 * fallback. No vendor key touches the browser.
 *
 * Honesty rules carried over from the report: a skill is only called "weak"
 * when there is interview coverage data to say so. Arriving here directly
 * (from the nav, with no interview state) shows every topic as unmeasured
 * rather than inventing gaps.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Brain,
  CheckCircle2,
  ChevronRight,
  HelpCircle,
  MessageSquare,
  Mic,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  Target,
  Trophy,
  Volume2,
  VolumeX,
  X,
  XCircle,
} from 'lucide-react';
import { KnowledgeGraph, type GraphData } from '../components/KnowledgeGraph';
import { InterviewerAvatar } from '../components/InterviewerAvatar';
import { tutorService } from '../services/tutorService';
import { voiceService } from '../services/voiceService';
import { createVad, type VadHandle } from '../lib/vad';
import { PcmRecorder } from '../lib/recorder';
import { logger } from '../lib/logger';
import { cn } from '../lib/cn';
import { Badge, Button, EmptyState, Markdown, Spinner } from '../components/ui';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'ai';
}

interface QuizQuestion {
  question: string;
  options: { label: string; text: string }[];
  correctIndex: number;
  explanation: string;
}

interface ResumeGraphData {
  skills?: string[];
  projects?: string[];
  experience?: string[];
  education?: string[];
  achievements?: string[];
}

interface TrainingSessionState {
  interviewId?: string;
  summaryMarkdown?: string;
  resumeSkills?: string[];
  skillMentions?: Record<string, number>;
  totalQuestions?: number;
  resumeData?: ResumeGraphData;
}

type Pane = 'graph' | 'chat' | 'quiz';
type LeftTab = 'graph' | 'topics';

/** A skill is "weak" below this many mentions across the interview. */
const WEAK_MENTION_THRESHOLD = 2;

const QUICK_PROMPTS = [
  'Explain that with an example',
  'Quiz me on this',
  'What should I practise next?',
  'Summarise what we covered',
];

// ---------------------------------------------------------------------------
// Graph construction
// ---------------------------------------------------------------------------

/** Shorten long labels so they fit neatly in a graph node. */
function truncateLabel(label: string, max = 28): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

const FRONTEND_KW = ['react', 'vue', 'angular', 'css', 'html', 'typescript', 'javascript', 'next', 'tailwind', 'redux', 'svelte', 'ui', 'ux'];
const BACKEND_KW = ['node', 'express', 'python', 'java', 'spring', 'django', 'flask', 'rust', 'go', 'c++', 'c#', '.net', 'fastapi', 'api', 'rest', 'graphql'];
const DB_KW = ['sql', 'mongo', 'postgres', 'mysql', 'redis', 'firebase', 'supabase', 'dynamodb', 'database', 'prisma'];
const DEVOPS_KW = ['docker', 'kubernetes', 'aws', 'gcp', 'azure', 'ci', 'cd', 'linux', 'nginx', 'terraform', 'cloud', 'vercel', 'netlify', 'git'];

/**
 * Root → [Skills, Projects, Experience, Education, Achievements], with skills
 * bucketed by discipline.
 *
 * `mentionCounts` is only passed through when the interview actually produced
 * coverage data — otherwise every node would render "0%", which reads as "you
 * never mentioned this" when the truth is "nothing measured it".
 */
function buildResumeGraph(
  resumeData: ResumeGraphData,
  mentionCounts: Record<string, number> | null,
  totalQs: number,
): GraphData {
  const skills = resumeData.skills ?? [];
  const projects = resumeData.projects ?? [];
  const experience = resumeData.experience ?? [];
  const education = resumeData.education ?? [];
  const achievements = resumeData.achievements ?? [];

  const total = skills.length + projects.length + experience.length + education.length + achievements.length;
  if (total === 0) return { nodes: [], edges: [] };

  const nodes: GraphData['nodes'] = [{ id: 'root', label: 'Resume', level: 0 }];
  const edges: GraphData['edges'] = [];

  if (skills.length > 0) {
    const skillsRootId = 'cat_Skills';
    nodes.push({ id: skillsRootId, label: 'Skills', level: 1 });
    edges.push({ from: 'root', to: skillsRootId });

    const buckets: Record<string, string[]> = { Frontend: [], Backend: [], Database: [], DevOps: [], Other: [] };
    for (const skill of skills) {
      const low = skill.toLowerCase();
      if (FRONTEND_KW.some((k) => low.includes(k))) buckets.Frontend.push(skill);
      else if (BACKEND_KW.some((k) => low.includes(k))) buckets.Backend.push(skill);
      else if (DB_KW.some((k) => low.includes(k))) buckets.Database.push(skill);
      else if (DEVOPS_KW.some((k) => low.includes(k))) buckets.DevOps.push(skill);
      else buckets.Other.push(skill);
    }

    for (const [bucket, bucketSkills] of Object.entries(buckets)) {
      if (bucketSkills.length === 0) continue;
      const subId = `sub_${bucket}`;
      nodes.push({ id: subId, label: bucket, level: 2 });
      edges.push({ from: skillsRootId, to: subId });
      for (const skill of bucketSkills) {
        nodes.push({
          id: `skill_${skill}`,
          label: truncateLabel(skill),
          level: 3,
          // Omitted entirely when unmeasured, so no percentage is drawn.
          ...(mentionCounts ? { mentionCount: mentionCounts[skill] ?? 0, totalQuestions: Math.max(1, totalQs) } : {}),
        });
        edges.push({ from: subId, to: `skill_${skill}` });
      }
    }
  }

  const branch = (
    key: string,
    label: string,
    items: string[],
    limit: number,
    labeller: (item: string) => string,
  ) => {
    if (items.length === 0) return;
    const rootId = `cat_${key}`;
    nodes.push({ id: rootId, label, level: 1 });
    edges.push({ from: 'root', to: rootId });
    items.slice(0, limit).forEach((item, i) => {
      nodes.push({ id: `${key.toLowerCase().slice(0, 4)}_${i}`, label: labeller(item), level: 2 });
      edges.push({ from: rootId, to: `${key.toLowerCase().slice(0, 4)}_${i}` });
    });
  };

  branch('Projects', 'Projects', projects, 10, (p) => truncateLabel(p.split(/[:–-]/)[0].trim(), 30));
  branch('Experience', 'Experience', experience, 8, (e) => truncateLabel(e.split(/[:(]/)[0].trim(), 30));
  branch('Education', 'Education', education, 5, (e) => truncateLabel(e, 32));
  branch('Achievements', 'Achievements', achievements, 8, (a) => truncateLabel(a, 32));

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Quiz parsing
// ---------------------------------------------------------------------------

/** Does this reply look like a quiz that belongs in the dedicated panel? */
function looksLikeQuiz(text: string): boolean {
  const questionBlocks = text.match(/\d+[.)][^\n]{5,}/g) ?? [];
  const optionLines = text.match(/^[A-D][.)][^\n]{3,}/gm) ?? [];
  return questionBlocks.length >= 2 && optionLines.length >= 4;
}

/** Parse the tutor's raw quiz text into structured MCQs. */
function parseQuizFromText(raw: string): QuizQuestion[] {
  const questions: QuizQuestion[] = [];
  const blocks = raw.split(/\n(?=\d+[.)])/g).filter((b) => b.trim());

  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length < 3) continue;

    const question = lines[0].replace(/^\d+[.)]\s*/, '').trim();
    const options: { label: string; text: string }[] = [];
    let correctIndex = 0;
    let explanation = '';

    for (const line of lines.slice(1)) {
      const optMatch = line.match(/^([A-D])[.)]\s*(.+)/i);
      if (optMatch) options.push({ label: optMatch[1].toUpperCase(), text: optMatch[2].trim() });

      const answerMatch = line.match(/(?:answer|correct)[:\s]+([A-D])\b/i);
      if (answerMatch) correctIndex = ['A', 'B', 'C', 'D'].indexOf(answerMatch[1].toUpperCase());

      if (/^explanation:/i.test(line)) explanation = line.replace(/^explanation:\s*/i, '').trim();
    }

    if (question && options.length >= 2) {
      questions.push({ question, options, correctIndex: Math.max(0, correctIndex), explanation });
    }
  }

  return questions;
}

/**
 * Flatten markdown before it goes to TTS — otherwise the voice reads out
 * asterisks, backticks and hash marks.
 */
function speakable(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' (code example on screen) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/(\*\*|__|\*|_)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Quiz panel
// ---------------------------------------------------------------------------

interface QuizPanelProps {
  topic: string;
  rawQuiz: string;
  onClose: () => void;
  onReveal: (score: number, total: number, missed: string[]) => void;
}

function QuizPanel({ topic, rawQuiz, onClose, onReveal }: QuizPanelProps) {
  const questions = useMemo(() => parseQuizFromText(rawQuiz), [rawQuiz]);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [revealed, setRevealed] = useState(false);

  // A new quiz reuses this component; clear the previous attempt.
  useEffect(() => {
    setAnswers({});
    setRevealed(false);
  }, [rawQuiz]);

  const score = questions.reduce((acc, q, i) => acc + (answers[i] === q.correctIndex ? 1 : 0), 0);
  const allAnswered = questions.length > 0 && Object.keys(answers).length === questions.length;

  const handleReveal = () => {
    setRevealed(true);
    const missed = questions.filter((q, i) => answers[i] !== q.correctIndex).map((q) => q.question);
    onReveal(score, questions.length, missed);
  };

  const header = (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <HelpCircle size={15} className="shrink-0 text-accent-soft" />
        <h3 className="truncate text-sm font-semibold text-white">Quiz · {topic}</h3>
      </div>
      <div className="flex items-center gap-2">
        {revealed && (
          <Badge variant={score === questions.length ? 'success' : score * 2 >= questions.length ? 'warning' : 'danger'}>
            {score}/{questions.length}
          </Badge>
        )}
        <button
          onClick={onClose}
          aria-label="Close quiz"
          className="rounded-lg p-1 text-muted transition-colors hover:bg-white/5 hover:text-white"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );

  // Parsing failed — show the tutor's raw text rather than nothing.
  if (questions.length === 0) {
    return (
      <div className="flex h-full flex-col">
        {header}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <Markdown>{rawQuiz}</Markdown>
        </div>
        <div className="shrink-0 border-t border-border p-3">
          <Button fullWidth variant="secondary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {header}

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        {revealed && (
          <div
            className={cn(
              'flex animate-fade-in items-center gap-3 rounded-xl border px-4 py-3',
              score === questions.length
                ? 'border-success/30 bg-success-muted'
                : score * 2 >= questions.length
                  ? 'border-warning/30 bg-warning-muted'
                  : 'border-danger/30 bg-danger-muted',
            )}
          >
            <Trophy
              size={18}
              className={cn(
                'shrink-0',
                score === questions.length ? 'text-success' : score * 2 >= questions.length ? 'text-warning' : 'text-danger',
              )}
            />
            <div>
              <p className="text-sm font-semibold text-white">
                {score === questions.length
                  ? 'Perfect score'
                  : score * 2 >= questions.length
                    ? 'Good attempt'
                    : 'Worth another pass'}
              </p>
              <p className="text-xs text-muted">
                {score} of {questions.length} correct
              </p>
            </div>
          </div>
        )}

        {questions.map((q, qIdx) => (
          <div key={qIdx} className="space-y-2.5">
            <p className="text-sm font-medium leading-relaxed text-white">
              <span className="mr-2 text-accent-soft">{qIdx + 1}.</span>
              {q.question}
            </p>
            <div className="space-y-1.5">
              {q.options.map((opt, optIdx) => {
                const isSelected = answers[qIdx] === optIdx;
                const isCorrect = q.correctIndex === optIdx;

                let tone = 'border-border bg-surface text-muted hover:border-border-strong hover:text-white';
                if (!revealed && isSelected) tone = 'border-accent/40 bg-accent-muted text-white';
                else if (revealed && isCorrect) tone = 'border-success/40 bg-success-muted text-white';
                else if (revealed && isSelected) tone = 'border-danger/30 bg-danger-muted text-muted';

                return (
                  <button
                    key={optIdx}
                    onClick={() => !revealed && setAnswers((prev) => ({ ...prev, [qIdx]: optIdx }))}
                    disabled={revealed}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors disabled:cursor-default',
                      tone,
                    )}
                  >
                    <span className="w-4 shrink-0 text-center text-[11px] font-semibold opacity-60">{opt.label}</span>
                    <span className="flex-1">{opt.text}</span>
                    {revealed && isCorrect && <CheckCircle2 size={15} className="shrink-0 text-success" />}
                    {revealed && isSelected && !isCorrect && <XCircle size={15} className="shrink-0 text-danger" />}
                  </button>
                );
              })}
            </div>
            {revealed && q.explanation && (
              <div className="animate-fade-in rounded-lg border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-muted">
                <span className="mb-0.5 block text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Explanation
                </span>
                {q.explanation}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="shrink-0 border-t border-border p-3">
        {revealed ? (
          <Button fullWidth variant="secondary" onClick={onClose}>
            Close quiz
          </Button>
        ) : (
          <Button fullWidth onClick={handleReveal} disabled={!allAnswered}>
            {allAnswered ? 'Reveal answers' : `Answer all ${questions.length} to reveal`}
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function TrainingSession() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = useMemo(() => (location.state ?? {}) as TrainingSessionState, [location.state]);

  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);
  const [degraded, setDegraded] = useState(false);

  const [voiceOn, setVoiceOn] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [recording, setRecording] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  const [activeNodeId, setActiveNodeId] = useState<string | number | null>(null);
  const [activeTopic, setActiveTopic] = useState<string | null>(null);
  const [quizText, setQuizText] = useState('');
  const [showQuiz, setShowQuiz] = useState(false);

  const [leftTab, setLeftTab] = useState<LeftTab>('graph');
  const [pane, setPane] = useState<Pane>('chat');

  const endRef = useRef<HTMLDivElement>(null);
  const vadRef = useRef<VadHandle | null>(null);
  const recorderRef = useRef<PcmRecorder | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  // ---- derived resume data -------------------------------------------------

  const resume = useMemo((): ResumeGraphData => {
    const base = state.resumeData ?? {};
    const merged = [...(base.skills ?? [])];
    for (const skill of state.resumeSkills ?? []) {
      if (!merged.includes(skill)) merged.push(skill);
    }
    return { ...base, skills: merged };
  }, [state.resumeData, state.resumeSkills]);

  const mentions = state.skillMentions;
  /** Did the interview produce coverage data at all? */
  const hasCoverage = Boolean(mentions && Object.keys(mentions).length > 0);

  const graphData = useMemo(
    () => buildResumeGraph(resume, hasCoverage ? (mentions ?? {}) : null, state.totalQuestions ?? 0),
    [resume, hasCoverage, mentions, state.totalQuestions],
  );

  const { weakSkills, coveredSkills } = useMemo(() => {
    const skills = resume.skills ?? [];
    if (!hasCoverage) return { weakSkills: [] as string[], coveredSkills: [] as string[] };
    return {
      weakSkills: skills.filter((s) => (mentions?.[s] ?? 0) < WEAK_MENTION_THRESHOLD),
      coveredSkills: skills.filter((s) => (mentions?.[s] ?? 0) >= WEAK_MENTION_THRESHOLD),
    };
  }, [resume.skills, hasCoverage, mentions]);

  // ---- chat plumbing -------------------------------------------------------

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking]);

  const push = useCallback((text: string, sender: Message['sender']) => {
    setMessages((prev) => [
      ...prev,
      { id: `${sender}_${prev.length}_${Date.now()}`, text, sender },
    ]);
  }, []);

  const speak = useCallback(async (text: string) => {
    if (mutedRef.current) return;
    // Never let the mic hear our own audio.
    vadRef.current?.pause();
    setSpeaking(true);
    try {
      await voiceService.speak(speakable(text));
    } catch {
      /* playback is best-effort */
    } finally {
      setSpeaking(false);
      if (vadRef.current?.available && !mutedRef.current) vadRef.current.start();
    }
  }, []);

  /**
   * Add a tutor reply. Quiz-shaped replies are routed to the panel instead of
   * the chat log — reading four MCQs aloud is useless, and the panel scores
   * them.
   */
  const addReply = useCallback(
    async (text: string) => {
      if (looksLikeQuiz(text)) {
        setQuizText(text);
        setShowQuiz(true);
        setPane('quiz');
        push('Your quiz is ready in the quiz panel.', 'ai');
        return;
      }
      push(text, 'ai');
      await speak(text);
    },
    [push, speak],
  );

  /** Init on first use so the tutor's history isn't reset mid-conversation. */
  const ensureSession = useCallback((): boolean => {
    if (sessionActive) return false;
    tutorService.initSession({
      resumeSkills: resume.skills ?? [],
      interviewSummary: state.summaryMarkdown || 'No interview summary was provided.',
      skillMentions: hasCoverage ? (mentions ?? {}) : {},
      weakSkills,
      currentTopic: null,
      resumeData: resume,
    });
    setSessionActive(true);
    voiceService.unlock();
    return true;
  }, [sessionActive, resume, state.summaryMarkdown, hasCoverage, mentions, weakSkills]);

  const ask = useCallback(
    async (prompt: string, opts: { echo?: string } = {}) => {
      if (thinking) return;
      ensureSession();
      if (opts.echo) push(opts.echo, 'user');
      setThinking(true);
      try {
        const reply = await tutorService.sendMessage(prompt);
        setDegraded(tutorService.isDegraded);
        await addReply(reply);
      } catch (err) {
        logger.warn('[training] tutor request failed', (err as Error)?.message);
        setDegraded(true);
        push('I could not reach the tutor just now. Try that again in a moment.', 'ai');
      } finally {
        setThinking(false);
      }
    },
    [thinking, ensureSession, push, addReply],
  );

  const sendDraft = useCallback(() => {
    const text = draft.trim();
    if (!text || thinking) return;
    setDraft('');
    void ask(text, { echo: text });
  }, [draft, thinking, ask]);

  // A ref so VAD's speech-end callback always reaches the current handler.
  const submitVoiceRef = useRef<(text: string) => void>(() => {});
  submitVoiceRef.current = (text: string) => {
    if (!text.trim()) return;
    void ask(text, { echo: text });
  };

  const startSession = useCallback(() => {
    ensureSession();
    void ask(
      `Start the session. Introduce yourself as the NERV tutor in one or two sentences, ${
        weakSkills.length
          ? `mention that ${weakSkills.slice(0, 3).join(', ')} came up least in the interview`
          : 'note that no interview coverage data was provided, so we can start anywhere'
      }, and invite me to pick a topic from the graph or ask a question.`,
    );
  }, [ensureSession, ask, weakSkills]);

  // ---- topics --------------------------------------------------------------

  const focusTopic = useCallback(
    (nodeId: string | number | null, label: string) => {
      setActiveNodeId(nodeId);
      setActiveTopic(label);
      setPane('chat');

      // Give the tutor the full resume line, not just the truncated node label.
      const id = String(nodeId ?? '');
      const index = Number.parseInt(id.split('_')[1] ?? '', 10);
      let context = label;
      if (id.startsWith('proj_') && resume.projects?.[index]) context = `the project "${resume.projects[index]}"`;
      else if (id.startsWith('expe_') && resume.experience?.[index]) context = `the role "${resume.experience[index]}"`;
      else if (id.startsWith('educ_') && resume.education?.[index]) context = `the qualification "${resume.education[index]}"`;
      else if (id.startsWith('achi_') && resume.achievements?.[index]) context = `the achievement "${resume.achievements[index]}"`;

      void ask(
        `I want to work on ${context}. Introduce it briefly, tie it to something on my resume, then ask me what I already know.`,
        { echo: `Let's work on ${label}` },
      );
    },
    [resume, ask],
  );

  const handleNodeSelect = useCallback(
    (nodeId: string | number, label: string) => {
      const node = graphData.nodes.find((n) => n.id === nodeId);
      // Only leaves are topics; category nodes are structure.
      if (!node || (node.level !== 2 && node.level !== 3)) return;
      focusTopic(nodeId, label);
    },
    [graphData.nodes, focusTopic],
  );

  const requestQuiz = useCallback(
    (topic: string) => {
      setActiveTopic(topic);
      void ask(
        `Give me a 4-question multiple choice quiz on "${topic}" at intermediate software-engineering level. Use the strict quiz format: numbered questions, options A. B. C. D., an "Answer:" line and an "Explanation:" line for each. No intro or outro text.`,
        { echo: `Quiz me on ${topic}` },
      );
    },
    [ask],
  );

  const requestFlashcards = useCallback(
    (topic: string) => {
      setActiveTopic(topic);
      void ask(
        `Make me 5 flashcards on "${topic}". Format each as a bolded question on one line followed by a concise answer on the next. No preamble.`,
        { echo: `Flashcards for ${topic}` },
      );
    },
    [ask],
  );

  const requestDeepDive = useCallback(
    (topic: string) => {
      setActiveTopic(topic);
      void ask(
        `Go deep on "${topic}". Cover how it works under the hood, the trade-offs, and the follow-up an interviewer would ask after a surface-level answer. Finish by asking me one hard question.`,
        { echo: `Deep dive on ${topic}` },
      );
    },
    [ask],
  );

  const handleQuizReveal = useCallback(
    (score: number, total: number, missed: string[]) => {
      void ask(
        missed.length === 0
          ? `I scored ${score}/${total} on that quiz. Push me with something harder on the same topic.`
          : `I scored ${score}/${total}. I got these wrong: ${missed.join(' | ')}. Explain what I misunderstood in each, briefly.`,
        { echo: `Quiz result: ${score}/${total}` },
      );
    },
    [ask],
  );

  const resetSession = useCallback(() => {
    tutorService.resetSession();
    setMessages([]);
    setSessionActive(false);
    setActiveTopic(null);
    setActiveNodeId(null);
    setShowQuiz(false);
    setQuizText('');
    setDegraded(false);
    voiceService.stopSpeaking();
  }, []);

  // ---- voice ---------------------------------------------------------------

  const transcribe = useCallback(async (pcm: Float32Array, sampleRate: number) => {
    setTranscribing(true);
    try {
      const text = await voiceService.transcribe(pcm, sampleRate);
      submitVoiceRef.current(text);
    } finally {
      setTranscribing(false);
    }
  }, []);

  const stopVoice = useCallback(() => {
    vadRef.current?.destroy();
    vadRef.current = null;
    if (recorderRef.current?.isRecording) recorderRef.current.stop();
    recorderRef.current = null;
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    setVoiceOn(false);
    setManualMode(false);
    setRecording(false);
    setUserSpeaking(false);
  }, []);

  const startVoice = useCallback(async () => {
    ensureSession();
    const vad = await createVad({
      onSpeechStart: () => {
        setUserSpeaking(true);
        // Barge-in: the candidate talking outranks the tutor.
        voiceService.stopSpeaking();
      },
      onSpeechEnd: (pcm) => {
        setUserSpeaking(false);
        void transcribe(pcm, 16000);
      },
      onMisfire: () => setUserSpeaking(false),
    });

    vadRef.current = vad;
    setVoiceOn(true);

    if (vad.available) {
      vad.start();
      setManualMode(false);
      return;
    }

    // No VAD — fall back to push-to-talk on our own stream.
    setManualMode(true);
    try {
      micStreamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (err) {
      logger.warn('[training] mic unavailable', (err as Error)?.message);
      stopVoice();
      push('I could not open your microphone. You can keep typing instead.', 'ai');
    }
  }, [ensureSession, transcribe, stopVoice, push]);

  const toggleRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder?.isRecording) {
      const { pcm, sampleRate } = recorder.stop();
      recorderRef.current = null;
      setRecording(false);
      void transcribe(pcm, sampleRate);
      return;
    }
    const stream = micStreamRef.current;
    if (!stream) return;
    const next = new PcmRecorder();
    try {
      next.start(stream);
      recorderRef.current = next;
      setRecording(true);
      voiceService.stopSpeaking();
    } catch (err) {
      logger.error('[training] recorder failed', (err as Error)?.message);
    }
  }, [transcribe]);

  // Muting mid-utterance should cut the audio, not wait it out.
  useEffect(() => {
    if (muted) voiceService.stopSpeaking();
  }, [muted]);

  // Release every device and cancel playback when leaving the page.
  useEffect(
    () => () => {
      vadRef.current?.destroy();
      vadRef.current = null;
      if (recorderRef.current?.isRecording) recorderRef.current.stop();
      recorderRef.current = null;
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
      voiceService.stopSpeaking();
    },
    [],
  );

  // ---- render --------------------------------------------------------------

  const busy = thinking || transcribing;
  const hasResumeData = graphData.nodes.length > 0;

  const voiceStatus = transcribing
    ? 'Transcribing…'
    : userSpeaking || recording
      ? 'Listening…'
      : speaking
        ? 'Tutor speaking'
        : voiceOn
          ? manualMode
            ? 'Push to talk'
            : 'Voice ready'
          : null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-primary text-white">
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-surface-raised px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            size="icon"
            variant="ghost"
            aria-label="Back to dashboard"
            onClick={() => navigate('/dashboard')}
          >
            <ArrowLeft size={16} />
          </Button>
          <span className="font-montserrat text-lg font-bold tracking-tight">NERV</span>
          <span className="hidden h-4 w-px bg-border-strong sm:block" />
          <Badge variant="accent">Training</Badge>
          {activeTopic && (
            <span className="hidden max-w-[220px] truncate text-sm text-muted lg:inline">{activeTopic}</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {degraded && (
            <Badge variant="warning" dot>
              Tutor offline
            </Badge>
          )}
          {voiceStatus && (
            <Badge variant={userSpeaking || recording ? 'success' : 'outline'} dot={userSpeaking || recording}>
              {voiceStatus}
            </Badge>
          )}
          <Button
            size="icon"
            variant="ghost"
            aria-label={muted ? 'Unmute tutor' : 'Mute tutor'}
            title={muted ? 'Unmute tutor' : 'Mute tutor'}
            onClick={() => setMuted((m) => !m)}
          >
            {muted ? <VolumeX size={16} className="text-danger" /> : <Volume2 size={16} />}
          </Button>
          {sessionActive && (
            <Button size="sm" variant="ghost" leftIcon={<RotateCcw size={14} />} onClick={resetSession}>
              <span className="hidden sm:inline">Reset</span>
            </Button>
          )}
        </div>
      </header>

      {/* Mobile pane switcher */}
      <div className="flex shrink-0 gap-1 border-b border-border bg-surface px-4 py-2 lg:hidden">
        {(
          [
            { id: 'graph', label: 'Topics', icon: Brain },
            { id: 'chat', label: 'Tutor', icon: MessageSquare },
            { id: 'quiz', label: 'Quiz', icon: HelpCircle },
          ] as const
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setPane(id)}
            className={cn(
              'inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
              pane === id ? 'bg-accent-muted text-accent-soft' : 'text-muted hover:bg-white/5 hover:text-white',
            )}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* ---- Left: graph / focus areas ---- */}
        <aside
          className={cn(
            'min-h-0 w-full shrink-0 flex-col border-border bg-surface/40 lg:flex lg:w-[360px] lg:border-r xl:w-[400px]',
            pane === 'graph' ? 'flex' : 'hidden',
          )}
        >
          <div className="flex shrink-0 border-b border-border">
            {(
              [
                { id: 'graph', label: 'Knowledge map', icon: Brain },
                { id: 'topics', label: 'Focus areas', icon: Target },
              ] as const
            ).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setLeftTab(id)}
                className={cn(
                  'flex flex-1 items-center justify-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
                  leftTab === id
                    ? 'border-accent text-white'
                    : 'border-transparent text-muted hover:text-white',
                )}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </div>

          {leftTab === 'graph' ? (
            <div className="min-h-0 flex-1">
              {hasResumeData ? (
                <KnowledgeGraph
                  data={graphData}
                  activeNodeId={activeNodeId}
                  onNodeSelect={handleNodeSelect}
                  onNodeQuiz={requestQuiz}
                  onNodeFlashcards={requestFlashcards}
                  onNodeDeepDive={requestDeepDive}
                />
              ) : (
                <div className="flex h-full items-center justify-center p-6">
                  <EmptyState
                    icon={<Brain size={22} />}
                    title="No resume data"
                    description="Upload a resume and finish an interview — the map is built from what we extract."
                    action={<Button size="sm" onClick={() => navigate('/dashboard')}>Go to dashboard</Button>}
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
              {!hasCoverage && (
                <p className="mb-3 rounded-lg border border-border bg-surface px-3 py-2.5 text-xs leading-relaxed text-muted">
                  No interview coverage data was passed to this session, so nothing is marked weak. Start
                  training from a finished interview to see which skills went unmentioned.
                </p>
              )}

              {weakSkills.length > 0 && (
                <>
                  <p className="px-1 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-widest text-warning">
                    Least covered
                  </p>
                  {weakSkills.map((skill) => (
                    <TopicRow key={skill} label={skill} tone="warning" onClick={() => focusTopic(`skill_${skill}`, skill)} />
                  ))}
                </>
              )}

              {coveredSkills.length > 0 && (
                <>
                  <p className="px-1 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-widest text-success">
                    Covered in the interview
                  </p>
                  {coveredSkills.map((skill) => (
                    <TopicRow key={skill} label={skill} tone="default" onClick={() => focusTopic(`skill_${skill}`, skill)} />
                  ))}
                </>
              )}

              {!hasCoverage &&
                (resume.skills ?? []).map((skill) => (
                  <TopicRow key={skill} label={skill} tone="default" onClick={() => focusTopic(`skill_${skill}`, skill)} />
                ))}

              {(resume.skills ?? []).length === 0 && (
                <p className="pt-8 text-center text-xs text-muted-foreground">No skills were extracted.</p>
              )}
            </div>
          )}
        </aside>

        {/* ---- Centre: conversation ---- */}
        <section
          className={cn(
            'min-h-0 flex-1 flex-col border-border lg:flex lg:border-r',
            pane === 'chat' ? 'flex' : 'hidden',
          )}
        >
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-6">
            {messages.length === 0 && !thinking && (
              <div className="flex h-full items-center justify-center">
                <EmptyState
                  icon={<Sparkles size={22} />}
                  title="Your tutor is ready"
                  description={
                    hasResumeData
                      ? 'Pick a topic from the map, or just start the session and ask anything.'
                      : 'Ask a question to begin — this session has no resume data to work from.'
                  }
                  action={
                    <Button loading={thinking} leftIcon={<Brain size={15} />} onClick={startSession}>
                      Start session
                    </Button>
                  }
                />
              </div>
            )}

            {messages.map((msg) => (
              <div
                key={msg.id}
                className={cn('flex animate-fade-in-up items-start gap-3', msg.sender === 'user' && 'flex-row-reverse')}
              >
                <div
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border',
                    msg.sender === 'ai'
                      ? 'border-accent/30 bg-accent-muted text-accent-soft'
                      : 'border-border bg-surface-raised text-muted',
                  )}
                >
                  {msg.sender === 'ai' ? <Brain size={15} /> : <span className="text-xs font-semibold">You</span>}
                </div>
                <div
                  className={cn(
                    'max-w-[85%] rounded-2xl border px-4 py-3',
                    msg.sender === 'ai'
                      ? 'rounded-tl-sm border-border bg-surface-raised'
                      : 'rounded-tr-sm border-accent/30 bg-accent-muted',
                  )}
                >
                  {msg.sender === 'ai' ? (
                    <Markdown>{msg.text}</Markdown>
                  ) : (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-white">{msg.text}</p>
                  )}
                </div>
              </div>
            ))}

            {busy && (
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-accent/30 bg-accent-muted text-accent-soft">
                  <Brain size={15} />
                </div>
                <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm border border-border bg-surface-raised px-4 py-3 text-sm text-muted">
                  <Spinner size={14} />
                  {transcribing ? 'Transcribing your answer…' : 'Thinking…'}
                </div>
              </div>
            )}

            <div ref={endRef} />
          </div>

          {/* Composer */}
          <div className="shrink-0 border-t border-border bg-surface-raised px-4 py-3 sm:px-6">
            {sessionActive && messages.length > 0 && (
              <div className="mb-2.5 flex gap-2 overflow-x-auto pb-1">
                {QUICK_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => void ask(prompt, { echo: prompt })}
                    disabled={busy}
                    className="shrink-0 rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-muted transition-colors hover:border-border-strong hover:text-white disabled:opacity-40"
                  >
                    {prompt}
                  </button>
                ))}
                {activeTopic && (
                  <button
                    onClick={() => requestQuiz(activeTopic)}
                    disabled={busy}
                    className="shrink-0 rounded-full border border-accent/30 bg-accent-muted px-3 py-1.5 text-xs text-accent-soft transition-colors hover:border-accent/50 disabled:opacity-40"
                  >
                    Quiz me on {activeTopic}
                  </button>
                )}
              </div>
            )}

            <div className="flex items-center gap-2">
              {manualMode ? (
                <Button
                  variant={recording ? 'danger' : 'secondary'}
                  leftIcon={recording ? <Square size={15} /> : <Mic size={15} />}
                  onClick={toggleRecording}
                  disabled={busy && !recording}
                >
                  {recording ? 'Stop' : 'Talk'}
                </Button>
              ) : (
                <Button
                  size="icon"
                  variant={voiceOn ? 'primary' : 'secondary'}
                  aria-label={voiceOn ? 'Turn voice off' : 'Turn voice on'}
                  title={voiceOn ? 'Turn voice off' : 'Answer by voice'}
                  onClick={() => (voiceOn ? stopVoice() : void startVoice())}
                >
                  <Mic size={15} />
                </Button>
              )}

              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendDraft();
                  }
                }}
                placeholder={busy ? 'Tutor is working…' : 'Ask your tutor anything…'}
                disabled={busy}
                className="h-10 flex-1 rounded-lg border border-border bg-input-bg px-3 text-sm text-white outline-none transition-colors placeholder:text-muted-foreground focus:border-accent disabled:opacity-50"
              />

              <Button size="icon" onClick={sendDraft} disabled={busy || !draft.trim()} aria-label="Send message">
                <Send size={15} />
              </Button>
            </div>
          </div>
        </section>

        {/* ---- Right: tutor presence + quiz ---- */}
        <aside
          className={cn(
            'min-h-0 w-full shrink-0 flex-col bg-surface/40 lg:flex lg:w-[340px] xl:w-[380px]',
            pane === 'quiz' ? 'flex' : 'hidden',
          )}
        >
          <div className="shrink-0 border-b border-border p-4">
            <div className="overflow-hidden rounded-2xl border border-border bg-black">
              <div className="relative aspect-video">
                {sessionActive ? (
                  <InterviewerAvatar
                    isAvatarSpeaking={speaking}
                    isUserSpeaking={userSpeaking || recording}
                    accentColor="purple"
                  />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-accent/30 bg-accent-muted">
                      <Sparkles size={18} className="text-accent-soft" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">NERV tutor</p>
                      <p className="mt-0.5 text-xs text-muted">Personalised from your interview</p>
                    </div>
                    <Button size="sm" loading={thinking} onClick={startSession}>
                      Start session
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <AnimatePresence mode="wait">
              {showQuiz ? (
                <motion.div
                  key="quiz"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 12 }}
                  transition={{ duration: 0.18 }}
                  className="flex min-h-0 flex-1 flex-col"
                >
                  <QuizPanel
                    topic={activeTopic ?? 'Practice'}
                    rawQuiz={quizText}
                    onClose={() => setShowQuiz(false)}
                    onReveal={handleQuizReveal}
                  />
                </motion.div>
              ) : (
                <div key="empty" className="flex flex-1 items-center justify-center p-6">
                  <EmptyState
                    icon={<Target size={22} />}
                    title="No quiz yet"
                    description="Ask for a quiz on any topic and it will be scored here."
                    action={
                      activeTopic ? (
                        <Button size="sm" variant="secondary" onClick={() => requestQuiz(activeTopic)} disabled={busy}>
                          Quiz me on {activeTopic}
                        </Button>
                      ) : undefined
                    }
                  />
                </div>
              )}
            </AnimatePresence>
          </div>
        </aside>
      </div>
    </div>
  );
}

function TopicRow({
  label,
  tone,
  onClick,
}: {
  label: string;
  tone: 'warning' | 'default';
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'group flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors',
        tone === 'warning'
          ? 'border-warning/25 bg-warning-muted hover:border-warning/40'
          : 'border-border bg-surface hover:border-border-strong',
      )}
    >
      <span className="truncate text-xs font-medium text-white">{label}</span>
      <ChevronRight size={14} className="shrink-0 text-muted transition-colors group-hover:text-white" />
    </button>
  );
}
