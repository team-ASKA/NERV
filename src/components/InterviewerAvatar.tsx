import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

// ─────────────────────────────────────────────────────────────────────────────
// Local Video Avatar
// Swaps between avocadospeaks.mp4 and userspeaks.mp4 based on conversation state.
// ─────────────────────────────────────────────────────────────────────────────

interface InterviewerAvatarProps {
    isAvatarSpeaking?: boolean;
    isUserSpeaking?: boolean;
    accentColor?: 'blue' | 'green' | 'purple';
}

const RING_COLORS: Record<string, string> = {
    blue: 'border-blue-400/40 shadow-blue-500/30',
    green: 'border-green-400/40 shadow-green-500/30',
    purple: 'border-purple-400/40 shadow-purple-500/30',
};

export function InterviewerAvatar({
    isAvatarSpeaking = false,
    isUserSpeaking = false,
    accentColor = 'blue',
}: InterviewerAvatarProps) {
    const avatarVideoRef = useRef<HTMLVideoElement>(null);
    const userVideoRef = useRef<HTMLVideoElement>(null);

    // Watch for AI speech
    useEffect(() => {
        if (isAvatarSpeaking && avatarVideoRef.current) {
            // Only reset if it's currently paused, so it doesn't jerk back when rapidly triggered
            if (avatarVideoRef.current.paused) {
                avatarVideoRef.current.currentTime = 0;
            }
            avatarVideoRef.current.play().catch(console.error);
        }
    }, [isAvatarSpeaking]);

    // Render logic to determine which video is shown
    // Priorities: 1. Avatar Speaks, 2. User Speaks, 3. User Speaks (idle state)
    const showAvatarVideo = isAvatarSpeaking;
    const showUserVideo = !isAvatarSpeaking;

    return (
        <div className="relative w-full h-full bg-black">
            {/* Avatar Speaks Video */}
            <video
                ref={avatarVideoRef}
                src="/avatarspeaks.mp4"
                loop
                muted // we rely on Sarvam for audio
                playsInline
                className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ${showAvatarVideo ? 'opacity-100 z-10' : 'opacity-0 z-0'
                    }`}
            />

            {/* User Speaks (or Idle) Video */}
            <video
                ref={userVideoRef}
                src="/userspeaks.mp4"
                loop
                muted
                autoPlay // Start playing immediately as it's the default idle state
                playsInline
                className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ${showUserVideo ? 'opacity-100 z-10' : 'opacity-0 z-0'
                    }`}
            />

            {/* Speaking Indicator */}
            <div className="absolute top-2 left-2 flex items-center space-x-1.5 px-2 py-1 bg-black/50 backdrop-blur-sm rounded-full border border-white/10 z-20">
                <div
                    className={`w-1.5 h-1.5 rounded-full ${isAvatarSpeaking ? 'bg-green-400 animate-pulse' :
                            isUserSpeaking ? 'bg-blue-400 animate-pulse' : 'bg-gray-400'
                        }`}
                />
                <span className="text-[9px] text-gray-300 font-medium uppercase tracking-wider">
                    {isAvatarSpeaking ? 'Avatar Speaking' : isUserSpeaking ? 'Listening...' : 'Idle'}
                </span>
            </div>

            {/* Animated rings */}
            {(isAvatarSpeaking || isUserSpeaking) && (
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
