import { VideoType } from "@/lib/video/detector";

export interface UnifiedPlayerRef {
  play: () => Promise<void> | void;
  pause: () => void;
  seek: (seconds: number) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  isPaused: () => boolean;
}

export interface PlayerStateEvent {
  type: "play" | "pause" | "seek" | "buffering" | "ended";
  position: number;
  serverTimestamp?: number;
}

export interface VideoPlayerProps {
  src: string;
  videoType: VideoType;
  isHost?: boolean;
  onPlayerEvent?: (event: PlayerStateEvent) => void;
  onReady?: () => void;
  autoPlay?: boolean;
}
