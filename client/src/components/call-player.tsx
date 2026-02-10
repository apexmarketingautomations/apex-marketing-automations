import { useState, useRef, useEffect } from "react";
import { Play, Pause, FileText, Phone, Clock, User, Bot } from "lucide-react";
import { motion } from "framer-motion";

interface TranscriptLine {
  role: string;
  message: string;
  timestamp?: number;
}

interface CallPlayerProps {
  recordingUrl?: string | null;
  transcript?: TranscriptLine[];
  duration?: number;
  callerNumber?: string;
  status?: string;
  createdAt?: string;
}

export function CallPlayer({ recordingUrl, transcript = [], duration, callerNumber, status, createdAt }: CallPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(duration || 0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (progressInterval.current) clearInterval(progressInterval.current);
    };
  }, []);

  const togglePlay = () => {
    if (!audioRef.current || !recordingUrl) return;

    if (isPlaying) {
      audioRef.current.pause();
      if (progressInterval.current) clearInterval(progressInterval.current);
    } else {
      audioRef.current.play();
      progressInterval.current = setInterval(() => {
        if (audioRef.current) {
          const cur = audioRef.current.currentTime;
          const dur = audioRef.current.duration || 1;
          setCurrentTime(cur);
          setProgress((cur / dur) * 100);
        }
      }, 100);
    }
    setIsPlaying(!isPlaying);
  };

  const handleEnded = () => {
    setIsPlaying(false);
    setProgress(0);
    setCurrentTime(0);
    if (progressInterval.current) clearInterval(progressInterval.current);
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setAudioDuration(audioRef.current.duration);
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    audioRef.current.currentTime = pct * (audioRef.current.duration || 0);
    setProgress(pct * 100);
    setCurrentTime(audioRef.current.currentTime);
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden" data-testid="call-player">
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Phone size={14} className="text-green-400" />
            <span className="text-sm font-medium text-white">
              {callerNumber || "Unknown Caller"}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {status && (
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                status === "ended" ? "bg-neutral-500/20 text-neutral-400"
                : status === "in-progress" ? "bg-green-500/20 text-green-400"
                : "bg-amber-500/20 text-amber-400"
              }`} data-testid="text-call-status">
                {status}
              </span>
            )}
            {createdAt && (
              <span className="text-xs text-neutral-500 flex items-center gap-1">
                <Clock size={10} /> {new Date(createdAt).toLocaleString()}
              </span>
            )}
          </div>
        </div>

        {recordingUrl && (
          <div className="flex items-center gap-3">
            <button
              onClick={togglePlay}
              className="w-9 h-9 rounded-full bg-green-500 flex items-center justify-center text-black hover:bg-green-400 transition-colors flex-shrink-0"
              data-testid="button-play-pause"
            >
              {isPlaying ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
            </button>
            <div
              className="flex-1 h-2 bg-neutral-800 rounded-full overflow-hidden cursor-pointer"
              onClick={handleSeek}
              data-testid="progress-bar"
            >
              <motion.div
                className="h-full bg-green-500 rounded-full"
                style={{ width: `${progress}%` }}
                transition={{ duration: 0.1 }}
              />
            </div>
            <span className="text-xs text-neutral-400 font-mono w-16 text-right">
              {formatTime(currentTime)} / {formatTime(audioDuration)}
            </span>
            <audio
              ref={audioRef}
              src={recordingUrl}
              onEnded={handleEnded}
              onLoadedMetadata={handleLoadedMetadata}
              preload="metadata"
            />
          </div>
        )}

        {!recordingUrl && (
          <div className="text-xs text-neutral-500 italic flex items-center gap-1">
            <FileText size={12} /> No recording available
          </div>
        )}
      </div>

      {transcript.length > 0 && (
        <div className="border-t border-white/5">
          <div className="px-4 py-2 flex items-center gap-1.5">
            <FileText size={12} className="text-neutral-400" />
            <span className="text-xs font-medium text-neutral-400">Transcript</span>
          </div>
          <div className="max-h-48 overflow-y-auto px-4 pb-4 space-y-2" data-testid="transcript-view">
            {transcript.map((line, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <span className="flex-shrink-0 mt-0.5">
                  {line.role === "assistant" || line.role === "ai" || line.role === "bot" ? (
                    <Bot size={14} className="text-green-400" />
                  ) : (
                    <User size={14} className="text-blue-400" />
                  )}
                </span>
                <div>
                  <span className={`text-xs font-medium ${
                    line.role === "assistant" || line.role === "ai" || line.role === "bot"
                      ? "text-green-400" : "text-blue-400"
                  }`}>
                    {line.role === "assistant" || line.role === "ai" || line.role === "bot" ? "AI" : "CALLER"}
                  </span>
                  <p className="text-neutral-300 text-sm leading-relaxed">{line.message}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
