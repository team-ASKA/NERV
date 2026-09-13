import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  Camera,
  CameraOff,
  CheckCircle2,
  ChevronRight,
  Mic,
  XCircle,
} from 'lucide-react';
import { Button } from './ui';
import { cn } from '../lib/cn';

interface DeviceCheckProps {
  onComplete: () => void;
  onSkip?: () => void;
  roundName?: string;
}

type CheckState = 'idle' | 'testing' | 'pass' | 'fail';
type Step = 'intro' | 'mic' | 'camera' | 'done';

const MIC_SAMPLE_FRAMES = 60; // ~2s at 30fps
const MIC_PASS_LEVEL = 5;

/**
 * Pre-interview device check: confirms the microphone actually picks up sound
 * and gives the candidate a camera preview. Camera failure is non-blocking —
 * the interview runs without expression analysis.
 */
export default function DeviceCheckModal({
  onComplete,
  onSkip,
  roundName = 'your interview',
}: DeviceCheckProps) {
  const [step, setStep] = useState<Step>('intro');
  const [micState, setMicState] = useState<CheckState>('idle');
  const [cameraState, setCameraState] = useState<CheckState>('idle');
  const [audioLevel, setAudioLevel] = useState(0);
  const [previewOn, setPreviewOn] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const frameRef = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const stopAll = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => undefined);
      audioCtxRef.current = null;
    }
    setAudioLevel(0);
    setPreviewOn(false);
  }, []);

  useEffect(() => stopAll, [stopAll]);

  const testMic = async () => {
    setMicState('testing');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(stream).connect(analyser);

      const data = new Uint8Array(analyser.frequencyBinCount);
      let peak = 0;
      let frames = 0;

      const tick = () => {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        const level = Math.min(100, (avg / 128) * 100);
        setAudioLevel(level);
        peak = Math.max(peak, level);

        if (++frames < MIC_SAMPLE_FRAMES) {
          frameRef.current = requestAnimationFrame(tick);
          return;
        }
        stopAll();
        setMicState(peak > MIC_PASS_LEVEL ? 'pass' : 'fail');
      };
      frameRef.current = requestAnimationFrame(tick);
    } catch {
      stopAll();
      setMicState('fail');
    }
  };

  const testCamera = async () => {
    setCameraState('testing');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      streamRef.current = stream;
      setPreviewOn(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      window.setTimeout(() => setCameraState('pass'), 1500);
    } catch {
      setCameraState('fail');
    }
  };

  const advance = () => {
    stopAll();
    if (step === 'intro') return setStep('mic');
    if (step === 'mic') return setStep('camera');
    if (step === 'camera') return setStep('done');
    return onComplete();
  };

  const finish = () => {
    stopAll();
    onComplete();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md animate-scale-in rounded-2xl border border-border bg-surface-overlay shadow-card">
        <div className="border-b border-border px-6 py-5 text-center">
          <h2 className="text-lg font-semibold text-white">Device check</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Before starting {roundName}, let’s verify your setup.
          </p>
        </div>

        <div className="px-6 py-5">
          {step === 'intro' && (
            <div className="space-y-3">
              <IntroRow
                icon={<Mic size={18} className="text-accent-soft" />}
                title="Microphone"
                detail="Required — you answer every question out loud."
              />
              <IntroRow
                icon={<Camera size={18} className="text-accent-soft" />}
                title="Camera"
                detail="Optional — enables expression analysis in your report."
              />
            </div>
          )}

          {step === 'mic' && (
            <div className="text-center">
              <p
                className={cn(
                  'mb-4 text-sm',
                  micState === 'pass' && 'text-success',
                  micState === 'fail' && 'text-danger',
                  (micState === 'idle' || micState === 'testing') && 'text-muted',
                )}
              >
                {micState === 'idle' && 'Click below, then say a few words.'}
                {micState === 'testing' && 'Speak now — we’re listening…'}
                {micState === 'pass' && 'Microphone is working.'}
                {micState === 'fail' && 'No audio detected. Check your mic permissions and try again.'}
              </p>

              <div className="mb-5 flex h-12 items-end justify-center gap-1">
                {Array.from({ length: 20 }).map((_, i) => {
                  const shape = 0.4 + Math.sin(i * 0.8) * 0.6;
                  const live = audioLevel > MIC_PASS_LEVEL;
                  return (
                    <div
                      key={i}
                      className={cn(
                        'w-1.5 rounded-sm transition-all duration-75',
                        live ? 'bg-accent' : 'bg-white/10',
                      )}
                      style={{ height: `${Math.max(6, (audioLevel / 100) * 48 * shape)}px` }}
                    />
                  );
                })}
              </div>

              {micState !== 'testing' && micState !== 'pass' && (
                <Button leftIcon={<Mic size={15} />} onClick={testMic}>
                  {micState === 'fail' ? 'Try again' : 'Test microphone'}
                </Button>
              )}
            </div>
          )}

          {step === 'camera' && (
            <div className="text-center">
              <div className="relative mb-4 aspect-video w-full overflow-hidden rounded-xl border border-border bg-black">
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  playsInline
                  className={cn(
                    'h-full w-full scale-x-[-1] object-cover transition-opacity',
                    previewOn ? 'opacity-100' : 'opacity-0',
                  )}
                />
                {!previewOn && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                    <CameraOff size={22} />
                    <span className="text-xs">Camera preview</span>
                  </div>
                )}
                {cameraState === 'pass' && (
                  <div className="absolute right-2 top-2 rounded-full bg-success p-0.5">
                    <CheckCircle2 size={14} className="text-white" />
                  </div>
                )}
              </div>

              {cameraState === 'idle' && (
                <Button leftIcon={<Camera size={15} />} onClick={testCamera}>
                  Test camera
                </Button>
              )}
              {cameraState === 'pass' && <p className="text-sm text-success">Camera is working.</p>}
              {cameraState === 'fail' && (
                <p className="text-sm text-warning">
                  Camera unavailable — the interview still runs, without expression analysis.
                </p>
              )}
            </div>
          )}

          {step === 'done' && (
            <div className="space-y-4 text-center">
              <p className="text-base font-semibold text-white">You’re all set.</p>
              <div className="flex justify-center gap-6 text-sm text-muted">
                <span className="flex items-center gap-1.5">
                  <StateIcon state={micState} /> Microphone
                </span>
                <span className="flex items-center gap-1.5">
                  <StateIcon state={cameraState} /> Camera
                </span>
              </div>
              {micState !== 'pass' && (
                <p className="text-xs text-muted-foreground">
                  Your mic isn’t confirmed — you can still type your answers.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-4">
          {onSkip && step !== 'done' ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                stopAll();
                onSkip();
              }}
            >
              Skip check
            </Button>
          ) : (
            <div />
          )}

          <Button
            rightIcon={<ChevronRight size={16} />}
            onClick={step === 'done' ? finish : advance}
            disabled={micState === 'testing' || cameraState === 'testing'}
          >
            {step === 'done' ? 'Start interview' : 'Continue'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function IntroRow({
  icon,
  title,
  detail,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-surface-raised px-4 py-3">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div>
        <div className="text-sm font-medium text-white">{title}</div>
        <div className="text-xs text-muted-foreground">{detail}</div>
      </div>
    </div>
  );
}

function StateIcon({ state }: { state: CheckState }) {
  if (state === 'pass') return <CheckCircle2 size={16} className="text-success" />;
  if (state === 'fail') return <XCircle size={16} className="text-danger" />;
  if (state === 'testing')
    return <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />;
  return <AlertCircle size={16} className="text-muted-foreground" />;
}
