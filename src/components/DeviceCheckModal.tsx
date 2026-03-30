import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, Camera, CameraOff, CheckCircle, XCircle, AlertCircle, ChevronRight } from 'lucide-react';

interface DeviceCheckProps {
  onComplete: () => void;
  onSkip?: () => void;
  roundName?: string;
}

type CheckState = 'idle' | 'testing' | 'pass' | 'fail';

/**
 * Pre-interview Device Check Modal
 * Tests the user's microphone and optional camera before starting an interview round.
 * Only fires once per session (stored in sessionStorage).
 */
const DeviceCheckModal: React.FC<DeviceCheckProps> = ({ onComplete, onSkip, roundName = 'Interview' }) => {
  const [micState, setMicState] = useState<CheckState>('idle');
  const [cameraState, setCameraState] = useState<CheckState>('idle');
  const [audioLevel, setAudioLevel] = useState(0);
  const [isPreviewOn, setIsPreviewOn] = useState(false);
  const [step, setStep] = useState<'intro' | 'mic' | 'camera' | 'done'>('intro');

  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Cleanup streams on unmount
  useEffect(() => {
    return () => {
      stopAll();
    };
  }, []);

  const stopAll = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setAudioLevel(0);
    setIsPreviewOn(false);
  }, []);

  const testMic = async () => {
    setMicState('testing');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const data = new Uint8Array(analyser.frequencyBinCount);

      let maxLevel = 0;
      let sampleCount = 0;

      const tick = () => {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        const normalized = Math.min(100, (avg / 128) * 100);
        setAudioLevel(normalized);
        if (normalized > maxLevel) maxLevel = normalized;
        sampleCount++;

        if (sampleCount < 60) { // ~2 seconds
          animFrameRef.current = requestAnimationFrame(tick);
        } else {
          // Check if mic captured anything
          cancelAnimationFrame(animFrameRef.current!);
          stream.getTracks().forEach(t => t.stop());
          setAudioLevel(0);
          setMicState(maxLevel > 5 ? 'pass' : 'fail');
        }
      };
      animFrameRef.current = requestAnimationFrame(tick);
    } catch {
      setMicState('fail');
    }
  };

  const testCamera = async () => {
    setCameraState('testing');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      streamRef.current = stream;
      setIsPreviewOn(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      // Wait 2 seconds for a visual check, then pass automatically
      setTimeout(() => {
        setCameraState('pass');
      }, 2000);
    } catch {
      setCameraState('fail');
    }
  };

  const handleContinue = () => {
    stopAll();
    if (step === 'intro') { setStep('mic'); return; }
    if (step === 'mic') { setStep('camera'); return; }
    if (step === 'camera') { setStep('done'); return; }
    onComplete();
  };

  const StateIcon = ({ state }: { state: CheckState }) => {
    if (state === 'pass') return <CheckCircle className="w-5 h-5 text-green-400" />;
    if (state === 'fail') return <XCircle className="w-5 h-5 text-red-400" />;
    if (state === 'testing') return <div className="w-5 h-5 rounded-full border-2 border-violet-400 border-t-transparent animate-spin" />;
    return <AlertCircle className="w-5 h-5 text-slate-400" />;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md">
      <div className="relative bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border border-white/10 rounded-2xl p-8 w-full max-w-md shadow-2xl mx-4">
        {/* Header */}
        <div className="text-center mb-6">
          <h2 className="text-xl font-bold text-white mb-1">Device Check</h2>
          <p className="text-slate-400 text-sm">Before starting {roundName}, let's verify your setup</p>
        </div>

        {/* Intro */}
        {step === 'intro' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 bg-white/5 rounded-xl p-4 border border-white/10">
              <Mic className="w-6 h-6 text-violet-400 shrink-0" />
              <p className="text-sm text-slate-300">Microphone — You'll be answering questions verbally</p>
            </div>
            <div className="flex items-center gap-3 bg-white/5 rounded-xl p-4 border border-white/10">
              <Camera className="w-6 h-6 text-violet-400 shrink-0" />
              <p className="text-sm text-slate-300">Camera — Used for emotion detection & proctoring</p>
            </div>
          </div>
        )}

        {/* Mic Test */}
        {step === 'mic' && (
          <div className="space-y-4">
            <div className="text-center py-4">
              {micState === 'idle' && (
                <p className="text-slate-300 text-sm mb-4">Click to test your microphone — speak a few words</p>
              )}
              {micState === 'testing' && (
                <p className="text-slate-300 text-sm mb-4">Speak now — we're listening...</p>
              )}
              {micState === 'pass' && (
                <p className="text-green-400 text-sm mb-4">Microphone detected successfully!</p>
              )}
              {micState === 'fail' && (
                <p className="text-red-400 text-sm mb-4">No audio detected. Please check mic permissions.</p>
              )}

              {/* Audio level visualizer */}
              <div className="flex gap-1 justify-center items-end h-12 mb-4">
                {Array.from({ length: 20 }).map((_, i) => (
                  <div
                    key={i}
                    className="w-1.5 rounded-sm transition-all duration-75"
                    style={{
                      height: `${Math.max(8, (audioLevel / 100) * 48 * (0.4 + Math.sin(i * 0.8) * 0.6))}px`,
                      background: audioLevel > 5 ? 'linear-gradient(to top, #6366f1, #a78bfa)' : '#334155',
                    }}
                  />
                ))}
              </div>

              {micState === 'idle' && (
                <button
                  onClick={testMic}
                  className="px-6 py-2.5 bg-violet-600 hover:bg-violet-500 text-white rounded-lg text-sm font-medium transition-all"
                >
                  <Mic className="inline w-4 h-4 mr-2" />
                  Test Microphone
                </button>
              )}
              {micState === 'fail' && (
                <button
                  onClick={testMic}
                  className="px-6 py-2.5 bg-orange-600 hover:bg-orange-500 text-white rounded-lg text-sm font-medium transition-all"
                >
                  Retry
                </button>
              )}
            </div>
          </div>
        )}

        {/* Camera Test */}
        {step === 'camera' && (
          <div className="space-y-4">
            <div className="text-center py-2">
              <div className="relative w-full aspect-video bg-slate-800 rounded-xl overflow-hidden mb-3 border border-white/10">
                {isPreviewOn ? (
                  <video
                    ref={videoRef}
                    autoPlay
                    muted
                    playsInline
                    className="w-full h-full object-cover scale-x-[-1]"
                  />
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                    <CameraOff className="w-8 h-8 text-slate-600" />
                    <span className="text-slate-500 text-xs">Camera preview</span>
                  </div>
                )}
                {cameraState === 'pass' && (
                  <div className="absolute top-2 right-2 bg-green-500 rounded-full p-0.5">
                    <CheckCircle className="w-4 h-4 text-white" />
                  </div>
                )}
              </div>

              {cameraState === 'idle' && (
                <button
                  onClick={testCamera}
                  className="px-6 py-2.5 bg-violet-600 hover:bg-violet-500 text-white rounded-lg text-sm font-medium transition-all"
                >
                  <Camera className="inline w-4 h-4 mr-2" />
                  Test Camera
                </button>
              )}
              {cameraState === 'pass' && (
                <p className="text-green-400 text-sm">Camera is working!</p>
              )}
              {cameraState === 'fail' && (
                <p className="text-amber-400 text-sm">Camera unavailable — emotion detection will be limited.</p>
              )}
            </div>
          </div>
        )}

        {/* Done */}
        {step === 'done' && (
          <div className="text-center py-4 space-y-3">
            <p className="text-white font-semibold text-lg">You're all set!</p>
            <div className="flex justify-center gap-6 text-sm mt-2">
              <span className="flex items-center gap-1.5"><StateIcon state={micState} /> Microphone</span>
              <span className="flex items-center gap-1.5"><StateIcon state={cameraState} /> Camera</span>
            </div>
          </div>
        )}

        {/* Footer Buttons */}
        <div className="flex justify-between items-center mt-6 pt-4 border-t border-white/10">
          {onSkip && step !== 'done' ? (
            <button
              onClick={() => { stopAll(); onSkip(); }}
              className="text-sm text-slate-500 hover:text-slate-300 transition-colors"
            >
              Skip check
            </button>
          ) : <div />}

          <button
            onClick={step === 'done' ? () => { stopAll(); onComplete(); } : handleContinue}
            disabled={step === 'mic' && micState === 'testing'}
            className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white rounded-lg text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {step === 'done' ? 'Start Interview' : 'Continue'}
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeviceCheckModal;
