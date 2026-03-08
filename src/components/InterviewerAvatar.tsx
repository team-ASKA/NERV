import { useEffect, useRef, useState } from 'react';
import {
    didAgentService,
    ConnectionState,
    VideoState,
} from '../services/didAgentService';
import { Loader2, AlertCircle } from 'lucide-react';
import { motion } from 'framer-motion';

// ─────────────────────────────────────────────────────────────────────────────
// D-ID Real-Time Avatar
// Streams an interactive avatar via WebRTC using D-ID talks/streams API.
// ─────────────────────────────────────────────────────────────────────────────

interface InterviewerAvatarProps {
    isSpeaking?: boolean;
    accentColor?: 'blue' | 'green' | 'purple';
    /** Text for the agent to speak (lip-synced avatar). */
    speakText?: string;
    /** Called when the D-ID agent finishes initialising + connecting. */
    onAgentReady?: () => void;
    /** Called when speech finishes */
    onSpeechFinished?: () => void;
}

const RING_COLORS: Record<string, string> = {
    blue: 'border-blue-400/40 shadow-blue-500/30',
    green: 'border-green-400/40 shadow-green-500/30',
    purple: 'border-purple-400/40 shadow-purple-500/30',
};

const STATUS_COLORS: Record<string, string> = {
    blue: 'text-blue-400',
    green: 'text-green-400',
    purple: 'text-purple-400',
};

export function InterviewerAvatar({
    isSpeaking,
    accentColor = 'blue',
    speakText,
    onAgentReady,
    onSpeechFinished,
}: InterviewerAvatarProps) {
    const streamVideoRef = useRef<HTMLVideoElement>(null);
    const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
    const [videoState, setVideoState] = useState<VideoState>('idle');
    const [error, setError] = useState<string>('');
    const initRef = useRef(false);
    const lastSpeakTextRef = useRef<string>('');

    // ── Initialise the D-ID WebRTC stream on mount ───────────────────────────
    useEffect(() => {
        if (initRef.current) return;
        initRef.current = true;

        const init = async () => {
            await didAgentService.initialize({
                onSrcObjectReady: (srcObject) => {
                    if (streamVideoRef.current) {
                        streamVideoRef.current.srcObject = srcObject;
                    }
                },
                onConnectionStateChange: (state) => {
                    setConnectionState(state);
                    if (state === 'connected') {
                        onAgentReady?.();
                    }
                },
                onVideoStateChange: (state) => {
                    setVideoState(state);
                },
                onSpeechFinished: () => {
                    onSpeechFinished?.();
                },
                onError: (err) => {
                    setError(err);
                },
            });

            // Connect to start the WebRTC session
            await didAgentService.connect();
        };

        init();

        return () => {
            didAgentService.disconnect();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Speak when speakText changes ────────────────────────────────────────
    useEffect(() => {
        if (
            speakText &&
            speakText !== lastSpeakTextRef.current &&
            connectionState === 'connected'
        ) {
            lastSpeakTextRef.current = speakText;
            didAgentService.speak(speakText);
        }
    }, [speakText, connectionState]);

    // ── Render ──────────────────────────────────────────────────────────────
    const isConnected = connectionState === 'connected';
    const isStreaming = videoState === 'streaming';

    return (
        <div className="relative w-full h-full">
            {/* Single WebRTC stream video (handles both idle portrait and speaking animation) */}
            <video
                ref={streamVideoRef}
                className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ${isConnected ? 'opacity-100' : 'opacity-0'}`}
                autoPlay
                playsInline
            />

            {/* Connection status overlay */}
            {(connectionState === 'connecting' || connectionState === 'idle' || connectionState === 'error' || connectionState === 'disconnected' || true) && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm z-10 p-6 text-center">
                    {(connectionState === 'connecting' || connectionState === 'idle' || true) ? (
                        <>
                            <Loader2 className={`w-10 h-10 animate-spin mb-3 ${STATUS_COLORS[accentColor]}`} />
                            <p className={`text-sm font-medium ${STATUS_COLORS[accentColor]}`}>
                                {connectionState === 'connecting' ? 'Connecting to avatar...' : 'Initialising avatar...'}
                            </p>
                            <p className="text-[10px] text-gray-400 mt-2 font-mono uppercase tracking-widest opacity-70">
                                Global Session Credits: Expired
                            </p>
                            <p className="text-[9px] text-gray-500 mt-1 italic">
                                Switching to Simulation Mode for Showcase
                            </p>
                        </>
                    ) : null}
                </div>
            )}

            {/* Connected indicator (small dot) */}
            {isConnected && (
                <div className="absolute top-2 left-2 flex items-center space-x-1.5 px-2 py-1 bg-black/50 backdrop-blur-sm rounded-full border border-white/10 z-10">
                    <div
                        className={`w-1.5 h-1.5 rounded-full ${isStreaming ? 'bg-green-400 animate-pulse' : 'bg-green-400'
                            }`}
                    />
                    <span className="text-[9px] text-gray-300 font-medium uppercase tracking-wider">
                        {isStreaming ? 'Speaking' : 'Live'}
                    </span>
                </div>
            )}

            {/* Animated speaking rings — synced to actual stream activity or isSpeaking prop */}
            {(isSpeaking || isStreaming) && isConnected && (
                <div className="absolute inset-0 pointer-events-none z-20 overflow-hidden">
                    {[1, 1.5, 2].map((scale, i) => (
                        <motion.div
                            key={i}
                            className={`absolute inset-0 rounded-full border-4 ${RING_COLORS[accentColor].split(' ')[0]}`}
                            initial={{ scale: 0.8, opacity: 0 }}
                            animate={{
                                scale: scale * 1.2,
                                opacity: [0, 0.4, 0],
                            }}
                            transition={{
                                duration: 2,
                                repeat: Infinity,
                                delay: i * 0.6,
                                ease: "easeOut"
                            }}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

export default InterviewerAvatar;
