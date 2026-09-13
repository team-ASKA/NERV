/**
 * InterviewRoom — the shared interview experience behind every round.
 *
 * Owns the hardware and the clock: webcam + facial-expression stream, the
 * countdown, tab-focus proctoring, the optional Monaco scratchpad, and the
 * `useInterviewSession` loop. Rounds differ only in copy, question budget and
 * where they navigate afterwards, so they pass props rather than re-implement
 * the loop.
 *
 * Everything degrades honestly: no camera means the expression panel says so,
 * no VAD means push-to-talk, and a typed answer always works.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  Camera,
  CameraOff,
  CheckCircle2,
  Clock,
  Eye,
  LogOut,
  MessageSquare,
  ShieldAlert,
  SquareCode,
} from 'lucide-react';
import type { EmotionAggregate, ResumeContext, Round, TranscriptTurn } from '../../types/interview';
import { ROUND_LABELS } from '../../types/interview';
import { useInterviewSession } from '../../hooks/useInterviewSession';
import { captureJpegBase64, emotionService } from '../../services/emotionService';
import {
  makeMessageId,
  toQuestionExpression,
  type LegacyMessage,
  type QuestionExpression,
  type RoundArtifacts,
} from '../../lib/roundPayload';
import { logger } from '../../lib/logger';
import { Badge, Button, Card, Modal } from '../ui';
import InterviewerAvatar from '../InterviewerAvatar';
import DeviceCheckModal from '../DeviceCheckModal';
import { AnswerControls } from './AnswerControls';
import { TranscriptView } from './TranscriptView';
import { CodeScratchpad, type ScratchpadLanguage } from './CodeScratchpad';
import { EmotionReadout } from './EmotionReadout';
import { cn } from '../../lib/cn';

const DEVICE_CHECK_KEY = 'nerv_device_checked';

export interface InterviewRoomIntro {
  eyebrow: string;
  title: string;
  description: string;
  bullets: string[];
}

export interface InterviewRoomProps {
  round: Round;
  resume: ResumeContext | null;
  /** Wall-clock budget for the round, in minutes. */
  durationMinutes: number;
  /** Interviewer questions before the round auto-completes. */
  maxQuestions?: number;
  /** Technical round: show the Monaco scratchpad. */
  enableCode?: boolean;
  intro: InterviewRoomIntro;
  /** Label of the primary button on the completion card. */
  completeLabel: string;
  onComplete: (artifacts: RoundArtifacts) => void;
  /** Optional escape hatch on the completion card (e.g. "Finish and see report"). */
  secondaryAction?: { label: string; onClick: (artifacts: RoundArtifacts) => void };
  onExit: () => void;
}

type Stage = 'intro' | 'live' | 'complete';

export function InterviewRoom({
  round,
  resume,
  durationMinutes,
  maxQuestions = 6,
  enableCode = false,
  intro,
  completeLabel,
  onComplete,
  secondaryAction,
  onExit,
}: InterviewRoomProps) {
  const [stage, setStage] = useState<Stage>('intro');
  const [showDeviceCheck, setShowDeviceCheck] = useState(
    () => sessionStorage.getItem(DEVICE_CHECK_KEY) !== 'true',
  );
  const [tab, setTab] = useState<'chat' | 'code'>('chat');
  const [remaining, setRemaining] = useState(durationMinutes * 60);
  const [emotion, setEmotion] = useState<EmotionAggregate | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [tabSwitches, setTabSwitches] = useState(0);
  const [showProctorWarning, setShowProctorWarning] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [code, setCode] = useState('');
  const [language, setLanguage] = useState<ScratchpadLanguage>('javascript');

  const videoRef = useRef<HTMLVideoElement>(null);
  const camStreamRef = useRef<MediaStream | null>(null);
  const codeRef = useRef('');
  const remainingRef = useRef(durationMinutes * 60);
  const tabSwitchRef = useRef(0);
  const startedRef = useRef(false);
  const seqRef = useRef(0);
  const messagesRef = useRef<LegacyMessage[]>([]);
  const expressionsRef = useRef<Map<string, QuestionExpression>>(new Map());
  const lastQuestionIdRef = useRef<string | null>(null);
  const emotionEverAvailableRef = useRef(false);
  const artifactsRef = useRef<RoundArtifacts | null>(null);

  codeRef.current = code;
  tabSwitchRef.current = tabSwitches;

  // ---- camera + expression stream -----------------------------------------

  const stopCamera = useCallback(() => {
    emotionService.stop();
    camStreamRef.current?.getTracks().forEach((t) => t.stop());
    camStreamRef.current = null;
    setCameraOn(false);
  }, []);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      });
      camStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setCameraOn(true);
      setCameraError(null);

      const ok = await emotionService.start(() =>
        videoRef.current ? captureJpegBase64(videoRef.current) : null,
      );
      if (ok) emotionEverAvailableRef.current = true;
    } catch (err) {
      logger.warn('[room] camera unavailable', (err as Error)?.message);
      setCameraOn(false);
      setCameraError('Camera access was blocked, so expressions were not analysed.');
    }
  }, []);

  useEffect(() => emotionService.subscribe(setEmotion), []);

  useEffect(() => {
    if (emotion?.available) emotionEverAvailableRef.current = true;
  }, [emotion]);

  // Release hardware if the page unmounts mid-round.
  useEffect(() => () => stopCamera(), [stopCamera]);

  // ---- session wiring ------------------------------------------------------

  const getCode = useCallback(() => codeRef.current, []);

  const getEmotion = useCallback((): EmotionAggregate | null => {
    const agg = emotionService.getAggregate();
    return agg.available ? agg : null;
  }, []);

  const handleInterviewerTurn = useCallback(
    (text: string) => {
      const id = makeMessageId(round, 'ai', ++seqRef.current);
      lastQuestionIdRef.current = id;
      messagesRef.current.push({ id, text, sender: 'ai', timestamp: new Date(), round });
    },
    [round],
  );

  const handleCandidateTurn = useCallback(
    (text: string) => {
      const id = makeMessageId(round, 'user', ++seqRef.current);
      messagesRef.current.push({ id, text, sender: 'user', timestamp: new Date(), round });

      // Snapshot how the candidate looked while answering — only if real.
      const snapshot = toQuestionExpression(emotionService.getAggregate());
      if (snapshot && lastQuestionIdRef.current) {
        expressionsRef.current.set(lastQuestionIdRef.current, snapshot);
      }
    },
    [round],
  );

  const handleEnded = useCallback(
    (transcript: TranscriptTurn[]) => {
      const elapsedSeconds = durationMinutes * 60 - remainingRef.current;
      artifactsRef.current = {
        round,
        transcript,
        messages: messagesRef.current.slice(),
        questionExpressions: Array.from(expressionsRef.current.entries()),
        emotionAvailable: emotionEverAvailableRef.current,
        durationMinutes: Math.max(1, Math.round(elapsedSeconds / 60)),
        tabSwitches: tabSwitchRef.current,
        ...(enableCode ? { code: codeRef.current, codeLanguage: language } : {}),
      };
      stopCamera();
      setStage('complete');
    },
    // `language` is only read at completion time; re-creating on change is fine.
    [round, durationMinutes, enableCode, language, stopCamera],
  );

  const session = useInterviewSession({
    round,
    resume,
    maxQuestions,
    getCode: enableCode ? getCode : undefined,
    getEmotion,
    onInterviewerTurn: handleInterviewerTurn,
    onCandidateTurn: handleCandidateTurn,
    onEnded: handleEnded,
  });

  // `session` is a fresh object each render; hold `end` in a ref so effects can
  // call it without re-subscribing (which would restart the countdown).
  const endRef = useRef(session.end);
  endRef.current = session.end;

  // ---- clock ---------------------------------------------------------------

  useEffect(() => {
    if (stage !== 'live') return;
    const id = window.setInterval(() => {
      const next = remainingRef.current - 1;
      remainingRef.current = Math.max(0, next);
      setRemaining(remainingRef.current);
      if (next <= 0) {
        window.clearInterval(id);
        endRef.current();
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [stage]);

  // ---- proctoring ----------------------------------------------------------

  useEffect(() => {
    if (stage !== 'live') return;
    const flag = () => {
      if (document.visibilityState === 'visible') return;
      setTabSwitches((n) => n + 1);
      setShowProctorWarning(true);
      window.setTimeout(() => setShowProctorWarning(false), 5000);
    };
    const onBlur = () => {
      setTabSwitches((n) => n + 1);
      setShowProctorWarning(true);
      window.setTimeout(() => setShowProctorWarning(false), 5000);
    };
    document.addEventListener('visibilitychange', flag);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('visibilitychange', flag);
      window.removeEventListener('blur', onBlur);
    };
  }, [stage]);

  // ---- stage transitions ---------------------------------------------------

  const beginRound = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    setStage('live');
    await startCamera();
    await session.start();
  }, [session, startCamera]);

  const finishDeviceCheck = useCallback(() => {
    sessionStorage.setItem(DEVICE_CHECK_KEY, 'true');
    setShowDeviceCheck(false);
  }, []);

  const timeLabel = useMemo(() => {
    const m = Math.floor(remaining / 60);
    const s = remaining % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }, [remaining]);

  const lowTime = remaining <= 60;
  const progress = Math.min(session.questionCount, maxQuestions);

  // ---- render --------------------------------------------------------------

  if (showDeviceCheck && stage === 'intro') {
    return (
      <DeviceCheckModal
        roundName={`the ${ROUND_LABELS[round]} round`}
        onComplete={finishDeviceCheck}
        onSkip={finishDeviceCheck}
      />
    );
  }

  if (stage === 'intro') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-primary px-4 py-10">
        <Card className="w-full max-w-xl animate-fade-in-up">
          <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-accent-soft">
            {intro.eyebrow}
          </div>
          <h1 className="text-2xl font-bold text-white">{intro.title}</h1>
          <p className="mt-2 text-sm text-muted">{intro.description}</p>

          <ul className="mt-5 space-y-2.5">
            {intro.bullets.map((b) => (
              <li key={b} className="flex items-start gap-2.5 text-sm text-muted">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                {b}
              </li>
            ))}
          </ul>

          <div className="mt-5 flex flex-wrap gap-2">
            <Badge variant="outline">{durationMinutes} min</Badge>
            <Badge variant="outline">{maxQuestions} questions</Badge>
            <Badge variant="outline">Voice answers</Badge>
            {enableCode && <Badge variant="outline">Code scratchpad</Badge>}
          </div>

          <div className="mt-7 flex items-center justify-between gap-3">
            <Button variant="ghost" leftIcon={<LogOut size={15} />} onClick={onExit}>
              Back
            </Button>
            <Button size="lg" rightIcon={<ArrowRight size={16} />} onClick={() => void beginRound()}>
              Start round
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (stage === 'complete') {
    const artifacts = artifactsRef.current;
    return (
      <div className="flex min-h-screen items-center justify-center bg-primary px-4 py-10">
        <Card className="w-full max-w-lg animate-scale-in text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-success-muted">
            <CheckCircle2 size={22} className="text-success" />
          </div>
          <h2 className="text-xl font-bold text-white">{ROUND_LABELS[round]} round complete</h2>
          <p className="mt-2 text-sm text-muted">
            {artifacts?.messages.filter((m) => m.sender === 'user').length ?? 0} answers recorded over{' '}
            {artifacts?.durationMinutes ?? 0} min.
          </p>

          {artifacts && !artifacts.emotionAvailable && (
            <p className="mt-3 text-xs text-muted-foreground">
              Expression analysis was unavailable — your report will score content only.
            </p>
          )}

          <Button
            className="mt-6"
            size="lg"
            fullWidth
            rightIcon={<ArrowRight size={16} />}
            onClick={() => artifacts && onComplete(artifacts)}
          >
            {completeLabel}
          </Button>

          {secondaryAction && (
            <Button
              className="mt-2"
              variant="ghost"
              fullWidth
              onClick={() => artifacts && secondaryAction.onClick(artifacts)}
            >
              {secondaryAction.label}
            </Button>
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-primary text-white">
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-surface-raised px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="font-montserrat text-lg font-bold tracking-tight">NERV</span>
          <span className="hidden h-4 w-px bg-border-strong sm:block" />
          <Badge variant="accent">{ROUND_LABELS[round]}</Badge>
          <span className="hidden text-sm text-muted sm:inline">
            Question {Math.max(1, progress)} of {maxQuestions}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {tabSwitches > 0 && (
            <Badge variant="warning" dot>
              {tabSwitches} tab {tabSwitches === 1 ? 'switch' : 'switches'}
            </Badge>
          )}
          <span
            className={cn(
              'flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm font-medium tabular-nums',
              lowTime ? 'border-danger/30 bg-danger-muted text-danger' : 'border-border bg-surface text-muted',
            )}
          >
            <Clock size={14} />
            {timeLabel}
          </span>
          <Button size="sm" variant="danger" onClick={() => setConfirmExit(true)}>
            End round
          </Button>
        </div>
      </header>

      {/* Progress */}
      <div className="h-0.5 w-full shrink-0 bg-white/5">
        <div
          className="h-full bg-accent transition-[width] duration-500"
          style={{ width: `${(progress / maxQuestions) * 100}%` }}
        />
      </div>

      {showProctorWarning && (
        <div className="flex shrink-0 items-center gap-2 border-b border-warning/30 bg-warning-muted px-4 py-2 text-xs text-warning sm:px-6">
          <ShieldAlert size={14} />
          Leaving the interview window is recorded and shown in your report.
        </div>
      )}

      {/* Body */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 lg:grid-cols-5">
        {/* Left: conversation / scratchpad */}
        <section className="flex min-h-0 flex-col border-border lg:col-span-3 lg:border-r">
          {enableCode && (
            <div className="flex shrink-0 gap-1 border-b border-border bg-surface px-4 py-2 sm:px-6">
              <TabButton active={tab === 'chat'} onClick={() => setTab('chat')} icon={<MessageSquare size={14} />}>
                Conversation
              </TabButton>
              <TabButton active={tab === 'code'} onClick={() => setTab('code')} icon={<SquareCode size={14} />}>
                Scratchpad
              </TabButton>
            </div>
          )}

          {tab === 'chat' || !enableCode ? (
            <TranscriptView
              className="min-h-0 flex-1"
              turns={session.transcript}
              liveText={session.liveText}
              pending={session.phase === 'connecting' || session.phase === 'thinking'}
            />
          ) : (
            <CodeScratchpad
              className="min-h-0 flex-1"
              value={code}
              onChange={setCode}
              language={language}
              onLanguageChange={setLanguage}
            />
          )}

          <AnswerControls
            className="shrink-0"
            phase={session.phase}
            isUserSpeaking={session.isUserSpeaking}
            micActive={session.micActive}
            recording={session.recording}
            manualMode={session.manualMode}
            error={session.error}
            onToggleRecording={session.toggleRecording}
            onSubmitText={session.submitText}
            onRepeat={session.repeat}
            onRetry={session.retry}
          />
        </section>

        {/* Right: presence */}
        <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto bg-surface/40 p-4 lg:col-span-2">
          <div className="overflow-hidden rounded-2xl border border-border bg-black">
            <div className="relative aspect-video">
              <InterviewerAvatar
                isAvatarSpeaking={session.phase === 'speaking'}
                isUserSpeaking={session.isUserSpeaking}
                accentColor="purple"
              />
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border bg-black">
            <div className="relative aspect-video">
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className={cn(
                  'h-full w-full scale-x-[-1] object-cover transition-opacity',
                  cameraOn ? 'opacity-100' : 'opacity-0',
                )}
              />
              {!cameraOn && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                  <CameraOff size={22} />
                  <span className="text-xs">Camera off</span>
                </div>
              )}
              <div className="absolute left-2 top-2 flex items-center gap-1.5 rounded-full border border-white/10 bg-black/50 px-2 py-1 backdrop-blur-sm">
                {cameraOn ? <Camera size={11} className="text-success" /> : <CameraOff size={11} className="text-muted" />}
                <span className="text-[9px] font-medium uppercase tracking-wider text-gray-300">You</span>
              </div>
            </div>
          </div>

          <EmotionReadout aggregate={emotion} unavailableReason={cameraError} />

          {session.degraded && (
            <div className="flex items-start gap-2 rounded-2xl border border-warning/30 bg-warning-muted px-3 py-2.5 text-xs text-warning">
              <Eye size={13} className="mt-px shrink-0" />
              Running on a backup question set — the interviewer service is unreachable.
            </div>
          )}
        </aside>
      </div>

      <Modal
        open={confirmExit}
        onClose={() => setConfirmExit(false)}
        title="End this round?"
        description="Your answers so far are kept and included in the report."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmExit(false)}>
              Keep going
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmExit(false);
                session.end();
              }}
            >
              End round
            </Button>
          </>
        }
      />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
        active ? 'bg-accent-muted text-accent-soft' : 'text-muted hover:bg-white/5 hover:text-white',
      )}
    >
      {icon}
      {children}
    </button>
  );
}

export default InterviewRoom;
