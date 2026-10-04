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
  /**
   * Gentle drift correction: nudge playback speed (e.g. 0.92–1.08) instead
   * of seeking. No-op on players that can't do it.
   */
  setPlaybackRate?: (rate: number) => void;
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
   * Overrides the glass-controls role label (e.g. replays show their own
   * label instead of "Host Controlling"). Defaults from roleBadge.
   */
  controlLabel?: string;
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
  /**
   * Data Saver: cap HLS to its lowest rendition (exact byte savings are
   * reported back through onFragmentBytes).
   */
  dataSaver?: boolean;
  /** Exact HLS segment bytes (measured, not estimated). */
  onFragmentBytes?: (bytes: number) => void;
  /** "Pin to moment" markers rendered on the seekbar. */
  markers?: { id: string; seconds: number }[];
  /** Privileged tap on a marker jumps the video (else informational). */
  onMarkerTap?: (seconds: number) => void;
  /**
   * Room subtitles: blob: URL of the selected-language VTT, rendered via a
   * <track> element (native MP4/HLS/My Files only — YouTube embeds can't
   * take external tracks). Per-user language + size, synced for everyone.
   */
  subtitleTrackUrl?: string | null;
  /** Per-user caption size. */
  subtitleSize?: "s" | "m" | "l";
  onPlayerEvent?: (event: PlayerStateEvent) => void;
  onReady?: () => void;
  autoPlay?: boolean;
}
