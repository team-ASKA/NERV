import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Play, Pause, SkipForward, SkipBack, VolumeX, Volume2, Maximize, AlertTriangle } from 'lucide-react';

interface VideoPlayerProps {
  src: string;
  question: string;
  answer: string;
  emotions: {
    name: string;
    score: number;
  }[];
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({ src, question, answer, emotions }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  
  // Process video source URL
  const videoSrc = useMemo(() => {
    // If it's already a full URL, use it as is
    if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('blob:')) {
      return src;
    }
    
    // If it's a relative path starting with /uploads, keep it as is
    if (src.startsWith('/uploads/')) {
      return src;
    }
    
    // Otherwise, assume it's a local path and add base URL
    return `${window.location.origin}${src.startsWith('/') ? '' : '/'}${src}`;
  }, [src]);
  
  // Handle video loading errors
  useEffect(() => {
    const handleError = () => {
      console.error('Error loading video:', videoSrc);
      setError('Failed to load video. The file may be missing or inaccessible.');
      setIsLoading(false);
    };
    
    const handleLoaded = () => {
      setIsLoading(false);
      setError(null);
    };
    
    const video = videoRef.current;
    if (video) {
      video.addEventListener('error', handleError);
      video.addEventListener('loadeddata', handleLoaded);
      
      return () => {
        video.removeEventListener('error', handleError);
        video.removeEventListener('loadeddata', handleLoaded);
      };
    }
  }, [videoSrc]);
  
  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play().catch(err => {
          console.error('Error playing video:', err);
          setError('Failed to play video. The file may be corrupted or in an unsupported format.');
        });
      }
      setIsPlaying(!isPlaying);
    }
  };
  
  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };
  
  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };
  
  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
      setIsLoading(false);
    }
  };
  
  const skipForward = () => {
    if (videoRef.current) {
      videoRef.current.currentTime = Math.min(videoRef.current.duration, videoRef.current.currentTime + 5);
    }
  };
  
  const skipBackward = () => {
    if (videoRef.current) {
      videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 5);
    }
  };
  
  const handleFullScreen = () => {
    if (videoRef.current) {
      if (videoRef.current.requestFullscreen) {
        videoRef.current.requestFullscreen();
      }
    }
  };
  
  return (
    <div className="bg-black/30 rounded-lg overflow-hidden border border-white/10">
      <div className="relative">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <div className="text-white text-center">
              <div className="w-10 h-10 border-4 border-white/30 border-t-white rounded-full animate-spin mx-auto mb-2"></div>
              <span className="text-sm">Loading video...</span>
            </div>
          </div>
        )}
        
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70">
            <div className="text-white text-center p-4">
              <AlertTriangle className="h-10 w-10 mx-auto mb-2 text-red-500" />
              <p className="text-sm">{error}</p>
            </div>
          </div>
        )}
        
        <video
          ref={videoRef}
          src={videoSrc}
          className="w-full rounded-t-lg"
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onEnded={() => setIsPlaying(false)}
          poster="/video-placeholder.jpg"
        />
        
        <div className="absolute inset-0 flex items-center justify-center">
          {!isPlaying && !error && (
            <button
              onClick={togglePlay}
              className="bg-white/20 backdrop-blur-sm hover:bg-white/30 text-white rounded-full p-4 transition-colors"
            >
              <Play className="h-8 w-8" />
            </button>
          )}
        </div>
      </div>
      
      <div className="p-4 bg-black/50">
        <div className="flex justify-between items-center mb-2">
          <div className="text-xs text-gray-400">
            {Math.floor(currentTime / 60)}:{Math.floor(currentTime % 60).toString().padStart(2, '0')} / 
            {Math.floor(duration / 60)}:{Math.floor(duration % 60).toString().padStart(2, '0')}
          </div>
          <div className="flex space-x-2">
            <button onClick={toggleMute} className="p-1 hover:bg-white/10 rounded">
              {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <button onClick={handleFullScreen} className="p-1 hover:bg-white/10 rounded">
              <Maximize className="h-4 w-4" />
            </button>
          </div>
        </div>
        
        <div className="h-1 bg-white/10 rounded-full mb-4 relative">
          <div 
            className="absolute top-0 left-0 h-full bg-white/80 rounded-full"
            style={{ width: `${(currentTime / duration) * 100}%` }}
          ></div>
          <input
            type="range"
            min="0"
            max={duration || 100}
            value={currentTime}
            onChange={(e) => {
              if (videoRef.current) {
                videoRef.current.currentTime = Number(e.target.value);
              }
            }}
            className="absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer"
            disabled={!!error}
          />
        </div>
        
        <div className="flex justify-center space-x-4">
          <button 
            onClick={skipBackward}
            className="p-2 hover:bg-white/10 rounded-full transition-colors"
            disabled={!!error}
          >
            <SkipBack className="h-5 w-5" />
          </button>
          <button
            onClick={togglePlay}
            className="p-2 hover:bg-white/10 rounded-full transition-colors"
            disabled={!!error}
          >
            {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
          </button>
          <button
            onClick={skipForward}
            className="p-2 hover:bg-white/10 rounded-full transition-colors"
            disabled={!!error}
          >
            <SkipForward className="h-5 w-5" />
          </button>
        </div>
      </div>
      
      <div className="p-4 border-t border-white/10">
        <h4 className="font-medium mb-2">{question}</h4>
        <p className="text-gray-300 text-sm mb-4">{answer}</p>
        
        <div className="grid grid-cols-2 gap-2">
          {emotions && emotions.length > 0 ? (
            emotions.slice(0, 4).map((emotion, idx) => (
              <div key={idx} className="bg-black/30 p-2 rounded flex justify-between items-center">
                <span className="text-xs capitalize">{emotion.name}</span>
                <span className="text-xs font-medium">{Math.round(emotion.score * 100)}%</span>
              </div>
            ))
          ) : (
            <div className="col-span-2 text-center text-xs text-gray-400 p-2">
              No emotional data available
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default VideoPlayer; 