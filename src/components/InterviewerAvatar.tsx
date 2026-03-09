import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';

// ─────────────────────────────────────────────────────────────────────────────
// Local Video Avatar
// Swaps between avatarspeaks.mp4 and userspeaks.mp4 based on conversation state.
// Implements a dual-buffer crossfade to hide the 7-second jump cut when looping.
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
    const videoRefA = useRef<HTMLVideoElement>(null);
    const videoRefB = useRef<HTMLVideoElement>(null);
    const userVideoRef = useRef<HTMLVideoElement>(null);
    
    // Track which buffer is currently playing
    const [activeBuffer, setActiveBuffer] = useState<'A' | 'B'>('A');
    const [isCrossfading, setIsCrossfading] = useState(false);

    // Watch for AI speech start
    useEffect(() => {
        if (isAvatarSpeaking) {
            const activeVideo = activeBuffer === 'A' ? videoRefA.current : videoRefB.current;
            if (activeVideo && activeVideo.paused) {
                activeVideo.currentTime = 0;
                activeVideo.play().catch(console.error);
            }
        }
    }, [isAvatarSpeaking, activeBuffer]);

    // Handle seamless looping via timeupdate
    const handleTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
        if (!isAvatarSpeaking || isCrossfading) return;
        
        const video = e.currentTarget;
        const fadeThreshold = 0.5; // Start crossfade 0.5s before end
        
        if (video.duration > 0 && video.currentTime > video.duration - fadeThreshold) {
            setIsCrossfading(true);
            
            // Switch buffers
            const nextBuffer = activeBuffer === 'A' ? 'B' : 'A';
            const nextVideo = nextBuffer === 'A' ? videoRefA.current : videoRefB.current;
            
            if (nextVideo) {
                nextVideo.currentTime = 0;
                nextVideo.play().then(() => {
                    setActiveBuffer(nextBuffer);
                    // Reset crossfade flag after transition completes
                    setTimeout(() => setIsCrossfading(false), 800);
                }).catch(console.error);
            }
        }
    };

    const showUserVideo = !isAvatarSpeaking;

    return (
        <div className="relative w-full h-full bg-black">
            {/* Avatar Speaks Video - Buffer A */}
            <video
                ref={videoRefA}
                src="/avatarspeaks.mp4"
                muted
                playsInline
                onTimeUpdate={activeBuffer === 'A' ? handleTimeUpdate : undefined}
                className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ${
                    isAvatarSpeaking && activeBuffer === 'A' ? 'opacity-100 z-10' : 'opacity-0 z-0'
                }`}
            />

            {/* Avatar Speaks Video - Buffer B */}
            <video
                ref={videoRefB}
                src="/avatarspeaks.mp4"
                muted
                playsInline
                onTimeUpdate={activeBuffer === 'B' ? handleTimeUpdate : undefined}
                className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ${
                    isAvatarSpeaking && activeBuffer === 'B' ? 'opacity-100 z-10' : 'opacity-0 z-0'
                }`}
            />

            {/* User Speaks (or Idle) Video */}
            <video
                ref={userVideoRef}
                src="/userspeaks.mp4"
                loop
                muted
                autoPlay
                playsInline
                className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ${
                    showUserVideo ? 'opacity-100 z-10' : 'opacity-0 z-0'
                }`}
            />

            {/* Speaking Indicator */}
            <div className="absolute top-2 left-2 flex items-center space-x-1.5 px-2 py-1 bg-black/50 backdrop-blur-sm rounded-full border border-white/10 z-20">
                <div
                    className={`w-1.5 h-1.5 rounded-full ${
                        isAvatarSpeaking ? 'bg-green-400 animate-pulse' :
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
                            className={`absolute inset-0 rounded-full border-4 ${RING_COLORS[accentColor]?.split(' ')[0] || RING_COLORS.blue.split(' ')[0]}`}
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
