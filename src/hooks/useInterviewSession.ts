/**
 * useInterviewSession — the single interview loop shared by every round.
 *
 * Loop: stream the interviewer's question from `/api/interview/next` → speak it
 * as it arrives (sentence-pipelined TTS) → open the mic → detect end-of-speech
 * with VAD → transcribe (`/api/stt`) → append to the transcript → ask the next
 * question. Difficulty/tone adaptation and persona live entirely on the server;
 * this hook only orchestrates media + timing and keeps the transcript
 * authoritative.
 *
 * LATENCY
 * -------
 * The gap between a candidate finishing their answer and hearing the next
 * question is the thing that makes a mock interview feel fake, so the work is
 * overlapped rather than queued:
 *   • Speech synthesis starts on the first complete sentence, while the model
 *     is still generating the rest — not after the full reply has arrived.
 *   • The VAD model (a few hundred KB from a CDN) loads *alongside* the first
 *     question instead of before it.
 *   • The STT/TTS functions are pinged on start, so their cold start happens
 *     while the candidate is still hearing the opening question.
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
import { voiceService, type Utterance } from '../services/voiceService';
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
  /**
   * The round's opening question, written ahead of time by the worker. When
   * present, question one is spoken immediately instead of being generated —
   * the difference between a second or two of silence at the start of an
   * interview and none. Read once at the first turn; later turns always stream.
   */
  opener?: string | null;
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

/**
 * How long after the interviewer starts talking before an interruption counts.
 * Covers the tail of the candidate's previous sentence and the onset of our own
 * audio; without it a throat-clear would cut the question off at word two.
 */
const BARGE_IN_GRACE_MS = 700;

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
  let vadPromise: Promise<VadHandle> | null = null;
  /** Only true when the mic runs with echo cancellation — see `lib/vad.ts`. */
  let bargeIn = false;
  let speakingSince = 0;
  let utterance: Utterance | null = null;
  let micStream: MediaStream | null = null;
  let recorder: PcmRecorder | null = null;
  let abort: AbortController | null = null;
  /**
   * Bumped on every teardown. Mic and VAD acquisition are async, so a request
   * issued before a teardown can resolve after it; adopting that handle would
   * leave the microphone open on a session nobody is in. Anything awaiting
   * hardware compares the generation it started in and releases what it got.
   */
  let generation = 0;

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
    const gen = generation;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (gen !== generation) {
        // Torn down while the permission prompt was open.
        stream.getTracks().forEach((t) => t.stop());
        return null;
      }
      micStream = stream;
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

    // Speak while the model is still writing: the utterance takes text as it
    // arrives and synthesises each sentence the moment it is complete.
    if (!bargeIn) vad?.pause();
    patch({ micActive: false, isUserSpeaking: false });
    const speech = voiceService.speakStreaming({ onStart: () => markSpeaking() });
    utterance = speech;

    // A primed opener is the same prompt, run in advance against the same
    // resume, so speaking it is not an approximation of question one — it *is*
    // question one, minus the wait. Only the first turn can use it; everything
    // after depends on what the candidate just said.
    const primed = questionCount === 0 ? (opts.opener ?? '').trim() : '';

    let message = primed;
    let spoken = false;
    let degraded = false;
    if (!primed) {
      try {
        for await (const ev of streamNextQuestion(req, abort.signal)) {
          if (ended) {
            speech.cancel();
            return;
          }
          if ('delta' in ev) {
            message += ev.delta;
            spoken = true;
            speech.push(ev.delta);
            patch({ liveText: message });
          } else {
            if (ev.done.message) message = ev.done.message;
            degraded = Boolean(ev.done.degraded);
          }
        }
      } catch (err) {
        logger.error('[session] askNext error', (err as Error)?.message);
      }
    }

    if (ended) {
      speech.cancel();
      return;
    }

    const finalMessage = message.trim() || FALLBACK_QUESTION;
    if (!message.trim()) degraded = true;
    // A non-streaming fallback delivers the whole reply at once, so nothing has
    // been handed to the synthesiser yet.
    if (!spoken) speech.push(finalMessage);
    speech.end();

    currentQuestion = finalMessage;
    appendTurn('interviewer', finalMessage);
    patch({ currentQuestion: finalMessage, liveText: '', degraded });
    optionsRef.current.onInterviewerTurn?.(finalMessage);

    await speech.done;
    if (utterance === speech) utterance = null;
    // A barge-in (or an end) has already moved us on; only a clean finish hands
    // the floor over.
    if (!ended && phase === 'speaking') startListening();
  };

  /** Entering the speaking phase, from either speech path. */
  const markSpeaking = () => {
    if (ended) return;
    speakingSince = Date.now();
    setPhase('speaking');
    patch({ isUserSpeaking: false });
    // With echo cancellation the detector can stay live through our own audio,
    // which is what allows the candidate to cut in.
    if (bargeIn) {
      vad?.start();
      patch({ micActive: true });
    } else {
      vad?.pause();
      patch({ micActive: false });
    }
  };

  /** Re-speak a known question (the Repeat control). Not streamed. */
  const speakQuestion = async (text: string) => {
    if (ended) return;
    utterance?.cancel();
    utterance = null;
    // Move to the speaking phase now so the mic stops being treated as an
    // answer, and re-stamp the grace window when audio actually begins —
    // synthesis of the first sentence can take most of a second.
    markSpeaking();
    try {
      await voiceService.speak(text, { onStart: () => markSpeaking() });
    } catch {
      /* ignore playback issues */
    }
    if (!ended && phase === 'speaking') startListening();
  };

  const startListening = () => {
    if (ended) return;
    setPhase('listening');
    patch({ error: null });
    if (manualMode) {
      patch({ micActive: false, recording: false });
      return;
    }
    if (vad) {
      vad.start();
      patch({ micActive: true });
      return;
    }
    // The model is still loading; adopt the mic the moment it is ready.
    void ensureVad().then(() => {
      if (!ended && phase === 'listening') startListening();
    });
  };

  const handleSpeechStart = () => {
    // Cutting in mid-question: stop the interviewer and take the answer.
    if (phase === 'speaking') {
      if (!bargeIn || Date.now() - speakingSince < BARGE_IN_GRACE_MS) return;
      logger.info('[session] barge-in');
      utterance?.cancel();
      utterance = null;
      voiceService.stopSpeaking();
      setPhase('listening');
      patch({ isUserSpeaking: true, micActive: true });
      return;
    }
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

  /**
   * Load the detector once, lazily. Kicked off in parallel with the first
   * question so its download is not on the critical path.
   */
  const ensureVad = (): Promise<VadHandle> => {
    if (!vadPromise) {
      const gen = generation;
      vadPromise = createVad({ onSpeechStart: handleSpeechStart, onSpeechEnd: handleSpeechEnd }).then(
        (handle) => {
          if (gen !== generation) {
            // The session ended while the model was still downloading. The
            // handle already holds the mic, so release it rather than adopt it.
            handle.destroy();
            return handle;
          }
          vad = handle;
          manualMode = !handle.available;
          bargeIn = handle.available && handle.echoCancelled;
          patch({ vadAvailable: handle.available, manualMode });
          if (manualMode) void ensureMic();
          return handle;
        },
      );
    }
    return vadPromise;
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
    // Wake the speech proxies so their cold start lands here rather than on the
    // candidate's first answer.
    voiceService.warm();
    setPhase('connecting');
    patch({ error: null });

    // Deliberately not awaited: the detector downloads while the opening
    // question is being generated and spoken.
    void ensureVad();

    await askNext();
  };

  /** Stop all hardware/network without ending the session semantically. */
  const teardownMedia = () => {
    // Invalidate anything still waiting on hardware (see `generation`).
    generation += 1;
    abort?.abort();
    utterance?.cancel();
    utterance = null;
    voiceService.stopSpeaking();
    try {
      vad?.destroy();
    } catch {
      /* ignore */
    }
    vad = null;
    vadPromise = null;
    bargeIn = false;
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

  /**
   * Release media but keep the engine reusable (used by unmount cleanup).
   * `ended` is left set so an in-flight `askNext` unwinds instead of speaking
   * into a dead component or re-opening the mic; `start` clears it again, which
   * is what lets React 18 StrictMode's mount→unmount→mount survive.
   */
  const release = () => {
    ended = true;
    teardownMedia();
    started = false;
  };

  return { start, end, repeat, retry, submitText, toggleRecording, release };
}
