import { VideoType } from "@/lib/video/detector";

export interface UnifiedPlayerRef {
  play: () => Promise<void> | void;
  pause: () => void;
  seek: (seconds: number) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  isPaused: () => boolean;
  /**
   * Enter fullscreen using the best API for the device: element fullscreen
   * on desktop/Android, webkitEnterFullscreen on iPhone Safari.
   */
  requestFullscreen?: () => void;
  /** Direct access for features like P2P captureStream(). */
  getVideoElement?: () => HTMLVideoElement | null;
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
  /** Hosts + co-hosts may drive playback. Defaults to isHost. */
  canControl?: boolean;
  /** Badge shown on the player: host crown, co-host clapper, or follower. */
  roleBadge?: "host" | "cohost" | "viewer";
  /**
   * "My Files" rooms: per-device blob: URL for the viewer's own copy.
   * When videoType is localfile and this is missing, the player renders a
   * "pick your file" placeholder instead of a broken video.
   */
  localSrc?: string;
  /**
   * Fired when a programmatic play() is rejected by the browser autoplay
   * policy (NotAllowedError) so the room can show a tap-to-play overlay.
   */
  onAutoplayBlocked?: () => void;
  onPlayerEvent?: (event: PlayerStateEvent) => void;
  onReady?: () => void;
  autoPlay?: boolean;
}
