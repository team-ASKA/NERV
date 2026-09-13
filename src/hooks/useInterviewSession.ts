/**
 * useInterviewSession — the single interview loop shared by every round.
 *
 * Loop: stream the interviewer's question from `/api/interview/next` → speak it
 * (sentence-pipelined TTS) → open the mic → detect end-of-speech with VAD →
 * transcribe (`/api/stt`) → append to the transcript → ask the next question.
 * Difficulty/tone adaptation and persona live entirely on the server; this hook
 * only orchestrates media + timing and keeps the transcript authoritative.
 *
 * When VAD can't load, it degrades to manual push-to-talk (`toggleRecording`)
 * and always supports a typed answer (`submitText`) for accessibility. Emotion
 * is pulled from the page via `getEmotion` and folded into each request; it is
 * never required and never fabricated.
 *
 * The engine is created once and holds its own control state in closure vars,
 * mirroring UI-facing values into a reducer — this avoids React stale-closure
 * hazards in the async loop.
 */

import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { EmotionAggregate, ResumeContext, Round, TranscriptTurn } from '../types/interview';
import { createVad, type VadHandle } from '../lib/vad';
import { PcmRecorder } from '../lib/recorder';
import { voiceService } from '../services/voiceService';
import { streamNextQuestion, type NextQuestionRequest } from '../services/interviewService';
import { logger } from '../lib/logger';

export type InterviewPhase =
  | 'idle'
  | 'connecting'
  | 'speaking'
  | 'listening'
  | 'transcribing'
  | 'thinking'
  | 'ended'
  | 'error';

export interface UseInterviewSessionOptions {
  round: Round;
  resume: ResumeContext | null;
  /** Number of interviewer questions before the round ends. Default 6. */
  maxQuestions?: number;
  /** Technical round: current Monaco scratchpad contents. */
  getCode?: () => string;
  /** Current rolling emotion aggregate, or null when unavailable. */
  getEmotion?: () => EmotionAggregate | null;
  onInterviewerTurn?: (text: string) => void;
  onCandidateTurn?: (text: string) => void;
  onEnded?: (transcript: TranscriptTurn[]) => void;
}

interface SessionState {
  phase: InterviewPhase;
  transcript: TranscriptTurn[];
  currentQuestion: string;
  liveText: string;
  questionCount: number;
  isUserSpeaking: boolean;
  micActive: boolean;
  recording: boolean;
  vadAvailable: boolean;
  manualMode: boolean;
  degraded: boolean;
  error: string | null;
}

const INITIAL: SessionState = {
  phase: 'idle',
  transcript: [],
  currentQuestion: '',
  liveText: '',
  questionCount: 0,
  isUserSpeaking: false,
  micActive: false,
  recording: false,
  vadAvailable: false,
  manualMode: false,
  degraded: false,
  error: null,
};

const FALLBACK_QUESTION = 'Tell me about a project from your resume that you are most proud of, and your specific role in it.';

export interface InterviewSessionApi extends SessionState {
  maxQuestions: number;
  start: () => Promise<void>;
  end: () => void;
  repeat: () => void;
  retry: () => void;
  submitText: (text: string) => void;
  toggleRecording: () => void;
}

export function useInterviewSession(options: UseInterviewSessionOptions): InterviewSessionApi {
  const [state, patch] = useReducer(
    (prev: SessionState, next: Partial<SessionState>) => ({ ...prev, ...next }),
    INITIAL,
  );

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const engineRef = useRef<Engine | null>(null);
  if (!engineRef.current) {
    engineRef.current = createEngine(patch, optionsRef);
  }
  const engine = engineRef.current;

  // Release all media on unmount. `release` is reusable so React 18 StrictMode's
  // dev-only mount→unmount→mount cycle doesn't permanently kill the engine.
  useEffect(() => () => engine.release(), [engine]);

  const start = useCallback(() => engine.start(), [engine]);
  const end = useCallback(() => engine.end(), [engine]);
  const repeat = useCallback(() => engine.repeat(), [engine]);
  const retry = useCallback(() => engine.retry(), [engine]);
  const submitText = useCallback((text: string) => engine.submitText(text), [engine]);
  const toggleRecording = useCallback(() => engine.toggleRecording(), [engine]);

  return {
    ...state,
    maxQuestions: options.maxQuestions ?? 6,
    start,
    end,
    repeat,
    retry,
    submitText,
    toggleRecording,
  };
}

// ---- engine ----------------------------------------------------------------

interface Engine {
  start(): Promise<void>;
  end(): void;
  repeat(): void;
  retry(): void;
  submitText(text: string): void;
  toggleRecording(): void;
  release(): void;
}

type Patch = (next: Partial<SessionState>) => void;

function createEngine(patch: Patch, optionsRef: { current: UseInterviewSessionOptions }): Engine {
  // Authoritative control state (closure-local, never stale).
  let phase: InterviewPhase = 'idle';
  let transcript: TranscriptTurn[] = [];
  let questionCount = 0;
  let currentQuestion = '';
  let started = false;
  let ended = false;
  let manualMode = false;

  let vad: VadHandle | null = null;
  let micStream: MediaStream | null = null;
  let recorder: PcmRecorder | null = null;
  let abort: AbortController | null = null;

  const maxQuestions = () => optionsRef.current.maxQuestions ?? 6;

  const setPhase = (p: InterviewPhase) => {
    phase = p;
    patch({ phase: p });
  };

  const appendTurn = (role: TranscriptTurn['role'], text: string) => {
    transcript = [...transcript, { role, text }];
    if (role === 'interviewer') questionCount += 1;
    patch({ transcript, questionCount });
  };

  const ensureMic = async (): Promise<MediaStream | null> => {
    if (micStream) return micStream;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      return micStream;
    } catch (err) {
      logger.warn('[session] mic permission denied', (err as Error)?.message);
      patch({ error: 'Microphone access is required. You can type your answers instead.' });
      return null;
    }
  };

  // --- the loop -------------------------------------------------------------

  const askNext = async () => {
    if (ended) return;
    abort?.abort();
    abort = new AbortController();

    setPhase(questionCount === 0 ? 'connecting' : 'thinking');
    patch({ liveText: '', error: null });

    const opts = optionsRef.current;
    const req: NextQuestionRequest = {
      round: opts.round,
      resume: opts.resume,
      transcript,
      emotion: opts.getEmotion?.() ?? null,
      code: opts.round === 'technical' ? opts.getCode?.() : undefined,
    };

    let message = '';
    let degraded = false;
    try {
      for await (const ev of streamNextQuestion(req, abort.signal)) {
        if (ended) return;
        if ('delta' in ev) {
          message += ev.delta;
          patch({ liveText: message });
        } else {
          if (ev.done.message) message = ev.done.message;
          degraded = Boolean(ev.done.degraded);
        }
      }
    } catch (err) {
      logger.error('[session] askNext error', (err as Error)?.message);
    }

    if (ended) return;

    const finalMessage = message.trim() || FALLBACK_QUESTION;
    if (!message.trim()) degraded = true;

    currentQuestion = finalMessage;
    appendTurn('interviewer', finalMessage);
    patch({ currentQuestion: finalMessage, liveText: '', degraded });
    optionsRef.current.onInterviewerTurn?.(finalMessage);

    await speakQuestion(finalMessage);
  };

  const speakQuestion = async (text: string) => {
    if (ended) return;
    setPhase('speaking');
    patch({ isUserSpeaking: false });
    vad?.pause(); // avoid the mic hearing our own TTS
    patch({ micActive: false });

    try {
      await voiceService.speak(text);
    } catch {
      /* ignore playback issues */
    }

    if (ended) return;
    startListening();
  };

  const startListening = () => {
    if (ended) return;
    setPhase('listening');
    patch({ error: null });
    if (manualMode) {
      patch({ micActive: false, recording: false });
      return;
    }
    vad?.start();
    patch({ micActive: true });
  };

  const handleSpeechStart = () => {
    if (phase !== 'listening') return;
    patch({ isUserSpeaking: true });
  };

  const handleSpeechEnd = (pcm: Float32Array) => {
    patch({ isUserSpeaking: false });
    if (phase !== 'listening') return;
    vad?.pause();
    patch({ micActive: false });
    void processAnswer(pcm, 16000);
  };

  const processAnswer = async (pcm: Float32Array, sampleRate: number) => {
    if (ended) return;
    setPhase('transcribing');
    const text = await voiceService.transcribe(pcm, sampleRate);
    finishAnswer(text);
  };

  const finishAnswer = (text: string) => {
    if (ended) return;
    const clean = text.trim();
    if (!clean) {
      // Didn't catch anything — return to listening.
      startListening();
      return;
    }
    appendTurn('candidate', clean);
    optionsRef.current.onCandidateTurn?.(clean);

    if (questionCount >= maxQuestions()) {
      end();
      return;
    }
    void askNext();
  };

  // --- public methods -------------------------------------------------------

  const start = async () => {
    if (started) return;
    started = true;
    ended = false;
    voiceService.unlock();
    setPhase('connecting');
    patch({ error: null });

    vad = await createVad({
      onSpeechStart: handleSpeechStart,
      onSpeechEnd: handleSpeechEnd,
    });
    manualMode = !vad.available;
    patch({ vadAvailable: vad.available, manualMode });

    // Acquire the mic up front so the permission prompt appears before the
    // first question (VAD manages its own stream; manual mode needs ours).
    if (manualMode) {
      await ensureMic();
    }

    await askNext();
  };

  /** Stop all hardware/network without ending the session semantically. */
  const teardownMedia = () => {
    abort?.abort();
    voiceService.stopSpeaking();
    try {
      vad?.destroy();
    } catch {
      /* ignore */
    }
    vad = null;
    if (recorder?.isRecording) recorder.stop();
    recorder = null;
    micStream?.getTracks().forEach((t) => t.stop());
    micStream = null;
  };

  const end = () => {
    if (ended) return;
    ended = true;
    teardownMedia();
    setPhase('ended');
    patch({ micActive: false, recording: false, isUserSpeaking: false });
    optionsRef.current.onEnded?.(transcript);
  };

  const repeat = () => {
    if (ended || !currentQuestion) return;
    if (phase === 'listening') void speakQuestion(currentQuestion);
  };

  const retry = () => {
    if (ended) return;
    patch({ error: null });
    void askNext();
  };

  const submitText = (text: string) => {
    if (ended) return;
    if (phase !== 'listening') return;
    if (recorder?.isRecording) {
      recorder.stop();
      patch({ recording: false });
    }
    vad?.pause();
    patch({ micActive: false, isUserSpeaking: false });
    finishAnswer(text);
  };

  const toggleRecording = () => {
    if (ended || !manualMode) return;
    if (recorder?.isRecording) {
      const { pcm, sampleRate } = recorder.stop();
      patch({ recording: false, micActive: false });
      void processAnswer(pcm, sampleRate);
      return;
    }
    if (phase !== 'listening') return;
    void (async () => {
      const stream = await ensureMic();
      if (!stream || ended) return;
      recorder = new PcmRecorder();
      try {
        recorder.start(stream);
        patch({ recording: true, micActive: true });
      } catch (err) {
        logger.error('[session] recorder start failed', (err as Error)?.message);
        patch({ error: 'Could not start recording.' });
      }
    })();
  };

  /** Release media but keep the engine reusable (used by unmount cleanup). */
  const release = () => {
    teardownMedia();
    started = false;
    ended = false;
  };

  return { start, end, repeat, retry, submitText, toggleRecording, release };
}
