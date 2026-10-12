/** Durable session repository: owned CRUD, CAS checkpoints, finalize-once. */
import { admin } from './supabaseAdmin';
import type { InterviewSession, RoundKind } from '../../shared/session';
import { emptyRounds } from '../../shared/session';

interface DbSession {
  id: string;
  user_id: string;
  resume_id: string | null;
  resume_snapshot: InterviewSession['resume'];
  resume_hash: string | null;
  status: InterviewSession['status'];
  current_round: RoundKind;
  duration_minutes: number;
  input_mode: InterviewSession['inputMode'];
  prompt_version: string;
  rubric_version: string;
  revision: number;
  created_at: string;
  updated_at: string;
}

export async function createSession(opts: {
  uid: string;
  resume: InterviewSession['resume'];
  genericMode: boolean;
  durationMinutes: number;
  inputMode: InterviewSession['inputMode'];
}): Promise<InterviewSession> {
  const db = admin();
  const { data, error } = await db
    .from('interview_sessions')
    .insert({
      user_id: opts.uid,
      resume_id: opts.resume?.resumeId ?? null,
      resume_snapshot: opts.resume,
      resume_hash: opts.resume?.contentHash ?? null,
      status: 'active',
      current_round: 'technical',
      duration_minutes: opts.durationMinutes,
      input_mode: opts.inputMode,
      prompt_version: 'v2',
      rubric_version: 'v2',
      revision: 0,
    })
    .select('*')
    .single();
  if (error || !data) throw new Error(`Could not create session: ${error?.message ?? 'unknown'}`);
  return toSession(data as DbSession, []);
}

export async function getSession(uid: string, id: string): Promise<InterviewSession | null> {
  const db = admin();
  const { data, error } = await db.from('interview_sessions').select('*').eq('id', id).eq('user_id', uid).single();
  if (error || !data) return null;
  const s = data as DbSession;
  const { data: turns } = await db
    .from('interview_turns')
    .select('*')
    .eq('session_id', id)
    .order('seq', { ascending: true });
  const { data: rounds } = await db.from('interview_rounds').select('*').eq('session_id', id);
  return toSession(s, (turns ?? []) as never[], (rounds ?? []) as never[]);
}

export async function activeSession(uid: string): Promise<{ id: string; status: string; currentRound: string } | null> {
  const db = admin();
  const { data } = await db
    .from('interview_sessions')
    .select('id,status,current_round')
    .eq('user_id', uid)
    .in('status', ['active', 'paused'])
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const r = data as { id: string; status: string; current_round: string };
  return { id: r.id, status: r.status, currentRound: r.current_round };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toSession(s: DbSession, turns: any[], rounds?: any[]): InterviewSession {
  const byRound: Record<RoundKind, InterviewSession['rounds'][RoundKind]> = emptyRounds();
  const roundMeta = new Map((rounds ?? []).map((r) => [r.round, r]));
  for (const t of turns) {
    const r = (t.round ?? 'technical') as RoundKind;
    byRound[r].turns.push({
      turnId: String(t.turn_uuid ?? t.id),
      sequence: Number(t.seq ?? 0),
      role: t.role,
      text: String(t.text ?? ''),
      deliveredText: t.delivered_text ?? null,
      questionId: t.question_id ? String(t.question_id) : null,
      status: t.status ?? 'complete',
      createdAt: String(t.created_at ?? new Date().toISOString()),
    });
  }
  for (const r of ['technical', 'core', 'hr'] as const) {
    const m = roundMeta.get(r) as { status?: string; elapsed_ms?: number; code_text?: string; code_language?: string } | undefined;
    byRound[r].status = ((m?.status ?? (byRound[r].turns.length ? 'active' : 'pending')) as typeof byRound[typeof r]['status']);
    byRound[r].elapsedMs = Number(m?.elapsed_ms ?? 0);
    byRound[r].codeText = m?.code_text ?? null;
    byRound[r].codeLanguage = m?.code_language ?? null;
    byRound[r].questionCount = byRound[r].turns.filter((t) => t.role === 'interviewer').length;
  }
  return {
    id: s.id,
    status: s.status,
    currentRound: s.current_round,
    resume: s.resume_snapshot,
    genericMode: !s.resume_snapshot,
    durationMinutes: s.duration_minutes,
    inputMode: s.input_mode,
    revision: s.revision,
    rounds: byRound,
    promptVersion: s.prompt_version,
    rubricVersion: s.rubric_version,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
  };
}
