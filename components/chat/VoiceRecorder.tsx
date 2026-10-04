"use client";

import { useEffect, useRef, useState } from "react";
import {
  VOICE_MAX_SECONDS,
  VOICE_MIN_SECONDS,
  audioExtension,
  formatClock,
  peaksFromSamples,
  pickAudioMime,
} from "@/lib/chat/media";
import { Mic } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";

export interface RecordedVoice {
  blob: Blob;
  url: string;
  duration: number;
  waveform: number[];
  mime: string;
}

interface VoiceRecorderProps {
  onSend: (voice: RecordedVoice) => Promise<void>;
  onError?: (message: string) => void;
  /** Push-to-talk: release sends immediately, skipping the preview. */
  ptt?: boolean;
  disabled?: boolean;
  /** Parent hides the text input while recording/previewing to avoid 360px overflow. */
  onActiveChange?: (active: boolean) => void;
  /** Render the idle mic as a transparent icon for pill-style chat bars. */
  transparentIdle?: boolean;
}

type Phase = "idle" | "acquiring" | "recording" | "preview" | "sending";

function Waveform({
  peaks,
  progress = 0,
  live = false,
}: {
  peaks: number[];
  progress?: number;
  live?: boolean;
}) {
  return (
    <div className="flex h-9 min-w-0 flex-1 items-center gap-[2px]" aria-hidden>
      {peaks.map((p, i) => {
        const played = !live && i / Math.max(1, peaks.length) < progress;
        return (
          <span
            key={i}
            className={`w-[3px] shrink-0 rounded-full ${
              played ? "bg-white" : live ? "bg-red-400" : "bg-white/40"
            }`}
            style={{ height: `${Math.max(12, p * 100)}%` }}
          />
        );
      })}
    </div>
  );
}

/**
 * WhatsApp-style voice notes (tap-friendly, 44px targets).
 * - TAP mic to start recording (no hold required) — works on iPhone
 *   Safari + Android Chrome with one thumb tap.
 * - HOLD also works: press-and-hold records, release drops to preview.
 * - Recording bar always shows Cancel + Stop; preview always shows
 *   Discard + Play + Speed + SEND, so there is always somewhere to tap.
 * - Slide left >80px still cancels (kept from previous behaviour).
 */
export function VoiceRecorder({ onSend, onError, ptt = false, disabled = false, onActiveChange, transparentIdle = false }: VoiceRecorderProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [cancelArmed, setCancelArmed] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewPeaks, setPreviewPeaks] = useState<number[]>([]);
  const [previewDuration, setPreviewDuration] = useState(0);
  const [previewMime, setPreviewMime] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<1 | 1.5 | 2>(1);
  const [progress, setProgress] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef(0);
  const peaksRef = useRef<number[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startXRef = useRef(0);
  const cancelRef = useRef(false);
  const pendingStopRef = useRef(false);
  const phaseRef = useRef<Phase>(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  // Tell the chat bar to hide the text input while we own the row.
  const active = phase === "recording" || phase === "acquiring" || phase === "preview" || phase === "sending";
  useEffect(() => {
    onActiveChange?.(active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  const livePeaksRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const startAtRef = useRef(0);
  const holdModeRef = useRef(false);
  /** Finger still down (for the hold-to-record timer). */
  const pressedRef = useRef(false);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Suppress the click that follows a hold-release. */
  const suppressClickRef = useRef(false);
  /** Guard against double-tap double-start (StrictMode / fast thumbs). */
  const startingRef = useRef(false);

  const fail = (message: string) => {
    onError?.(message);
    cleanup();
    setPhase("idle");
  };

  const cleanup = () => {
    cancelAnimationFrame(rafRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    try {
      recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    } catch {
      // ignore
    }
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    } catch {
      // ignore
    }
    recorderRef.current = null;
    streamRef.current = null;
    if (analyserRef.current) {
      try {
        analyserRef.current.disconnect();
      } catch {
        // ignore
      }
      analyserRef.current = null;
    }
    if (audioCtxRef.current) {
      const ctx = audioCtxRef.current;
      audioCtxRef.current = null;
      ctx.close().catch(() => {});
    }
  };

  useEffect(() => {
    return () => {
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
      pressedRef.current = false;
      cleanup();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tickWaveform = () => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const buf = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(buf);
    let max = 0;
    for (let i = 0; i < buf.length; i += 2) {
      const v = Math.abs(buf[i] - 128) / 128;
      if (v > max) max = v;
    }
    peaksRef.current.push(max);
    // Live bars via direct DOM (no re-render at 60fps).
    const host = livePeaksRef.current;
    if (host) {
      const bars = host.children;
      const idx = Math.min(bars.length - 1, Math.floor(peaksRef.current.length / 6));
      const bar = bars[idx] as HTMLElement | undefined;
      if (bar) {
        bar.style.height = `${Math.max(12, Math.min(1, max * 1.8) * 100)}%`;
        bar.className = "w-[3px] shrink-0 rounded-full bg-red-400";
      }
    }
    rafRef.current = requestAnimationFrame(tickWaveform);
  };

  const beginRecording = async () => {
    const current = phaseRef.current;
    if (current !== "idle" && current !== "preview") return;
    // Double-tap / StrictMode guard: one permission prompt at a time.
    if (startingRef.current) return;
    startingRef.current = true;
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      startingRef.current = false;
      fail("Voice recording isn't supported in this browser.");
      return;
    }
    setPhase("acquiring");
    cancelRef.current = false;
    pendingStopRef.current = false;
    setCancelArmed(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (pendingStopRef.current) {
        // Released while the permission prompt was up — discard silently.
        stream.getTracks().forEach((t) => t.stop());
        setPhase("idle");
        return;
      }
      streamRef.current = stream;
      const mime = pickAudioMime();
      const recorder = new MediaRecorder(
        stream,
        mime
          ? { mimeType: mime, audioBitsPerSecond: 24000 }
          : { audioBitsPerSecond: 24000 }
      );
      recorderRef.current = recorder;
      chunksRef.current = [];
      peaksRef.current = [];

      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (Ctx) {
        const ctx: AudioContext = new Ctx();
        audioCtxRef.current = ctx;
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        src.connect(analyser);
        analyserRef.current = analyser;
      }

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        void finishRecording();
      };
      recorder.start(200);
      // Wall-clock timestamps in event flows are correct usage;
      // the purity rule can't see this runs post-gesture, not in render.
      // eslint-disable-next-line react-hooks/purity
      startAtRef.current = Date.now();
      setSeconds(0);
      setPhase("recording");
      rafRef.current = requestAnimationFrame(tickWaveform);
      timerRef.current = setInterval(() => {
        const s = (Date.now() - startAtRef.current) / 1000;
        setSeconds(s);
        if (s >= VOICE_MAX_SECONDS) stopRecording(false);
      }, 250);
    } catch (err) {
      startingRef.current = false;
      if (
        err instanceof DOMException &&
        (err.name === "NotAllowedError" || err.name === "SecurityError")
      ) {
        fail("Microphone blocked — allow mic access in your browser settings.");
      } else {
        fail("Couldn't start recording. Try again.");
      }
      return;
    }
    startingRef.current = false;
  };

  const stopRecording = (cancelled: boolean) => {
    cancelRef.current = cancelled;
    const rec = recorderRef.current;
    if (!rec) {
      pendingStopRef.current = true;
      return;
    }
    if (rec.state === "recording" || rec.state === "paused") {
      try {
        rec.stop();
      } catch {
        void finishRecording();
      }
    }
  };

  const finishRecording = async () => {
    cancelAnimationFrame(rafRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    const cancelled = cancelRef.current;
    const mime = recorderRef.current?.mimeType || pickAudioMime();
    const blob = new Blob(chunksRef.current, {
      type: mime || "audio/webm",
    });
    const duration = (Date.now() - startAtRef.current) / 1000;
    cleanup();
    if (cancelled) {
      setPhase("idle");
      setSeconds(0);
      return;
    }
    if (duration < VOICE_MIN_SECONDS || blob.size === 0) {
      fail("Too short — tap mic, record at least a second, then tap Stop.");
      setSeconds(0);
      return;
    }
    const waveform = peaksFromSamples(peaksRef.current, 40);
    if (ptt) {
      // Push-to-talk: send immediately, no preview.
      setPhase("sending");
      try {
        const url = URL.createObjectURL(blob);
        await onSend({ blob, url, duration, waveform, mime: mime || "audio/webm" });
        URL.revokeObjectURL(url);
      } catch {
        // parent toasts the reason
      } finally {
        setPhase("idle");
        setSeconds(0);
      }
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const url = URL.createObjectURL(blob);
    setPreviewUrl(url);
    setPreviewPeaks(waveform.length > 0 ? waveform : new Array(40).fill(0.3));
    setPreviewDuration(duration);
    setPreviewMime(mime || "audio/webm");
    setIsPlaying(false);
    setSpeed(1);
    setProgress(0);
    setSeconds(0);
    setPhase("preview");
  };

  const togglePreview = () => {
    const audio = audioRef.current;
    if (!audio || !previewUrl) return;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.playbackRate = speed;
      audio.play().catch(() => {});
    }
  };

  const cycleSpeed = () => {
    setSpeed((s) => {
      const next = s === 1 ? 1.5 : s === 1.5 ? 2 : 1;
      if (audioRef.current) audioRef.current.playbackRate = next;
      return next;
    });
  };

  const sendPreview = async () => {
    if (!previewUrl || !previewMime) return;
    setPhase("sending");
    try {
      const res = await fetch(previewUrl);
      const blob = await res.blob();
      await onSend({
        blob,
        url: previewUrl,
        duration: previewDuration,
        waveform: previewPeaks,
        mime: previewMime,
      });
    } catch {
      // parent toasts the reason
    } finally {
      setPhase("idle");
    }
  };

  const discardPreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPhase("idle");
  };

  // Recording UI — fixed h-11 row, always shows Cancel + Stop/Send.
  // Parent hides the text input while active, so this never overflows 360px.
  if (phase === "recording" || phase === "acquiring") {
    return (
      <div className="flex h-11 min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-border bg-muted px-1.5 select-none" role="status" aria-label="Recording voice note">
        <button
          type="button"
          onClick={() => stopRecording(true)}
          aria-label="Cancel recording"
          title="Cancel"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-sm text-muted-foreground hover:text-foreground cursor-pointer"
        >
          ✕
        </button>
        <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-red-500 animate-pulse" aria-hidden />
        <span className="font-mono text-xs text-foreground tabular-nums shrink-0 w-10">
          {formatClock(seconds)}
        </span>
        <div ref={livePeaksRef} className="flex h-9 min-w-0 flex-1 items-center gap-[2px] overflow-hidden" aria-hidden>
          {Array.from({ length: 32 }).map((_, i) => (
            <span key={i} className="w-[3px] shrink-0 rounded-full bg-muted-foreground/30" style={{ height: "12%" }} />
          ))}
        </div>
        <span className={`hidden min-[380px]:inline text-[10px] shrink-0 ${cancelArmed ? "text-red-500 font-bold" : "text-muted-foreground"}`}>
          {cancelArmed ? "release to cancel" : "slide ◀ to cancel"}
        </span>
        {/* STOP is always visible — tap it, then tap SEND in preview. */}
        <button
          type="button"
          onClick={() => stopRecording(cancelArmed)}
          aria-label="Stop recording and review"
          title="Stop and review"
          className="flex h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-lg bg-primary px-2.5 text-xs font-medium text-primary-foreground cursor-pointer"
        >
          Stop
        </button>
      </div>
    );
  }

  // Preview UI — fixed h-11 row with Discard + Play + waveform + speed + SEND.
  if (phase === "preview" && previewUrl) {
    return (
      <div className="flex h-11 min-w-0 flex-1 items-center gap-1 rounded-lg border border-border bg-muted/40 px-1.5">
        <audio
          ref={audioRef}
          src={previewUrl}
          preload="metadata"
          onPlay={() => setIsPlaying(true)}
          onPause={() => {
            setIsPlaying(false);
          }}
          onEnded={() => {
            setIsPlaying(false);
            setProgress(0);
          }}
          onTimeUpdate={(e) => {
            const a = e.currentTarget;
            if (a.duration > 0) setProgress(a.currentTime / a.duration);
          }}
          className="hidden"
        />
        <button
          type="button"
          onClick={discardPreview}
          aria-label="Discard recording"
          title="Discard"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground cursor-pointer"
        >
          ✕
        </button>
        <button
          type="button"
          onClick={togglePreview}
          aria-label={isPlaying ? "Pause preview" : "Play preview"}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm text-primary-foreground cursor-pointer"
        >
          {isPlaying ? "⏸" : "▶"}
        </button>
        <Waveform peaks={previewPeaks} progress={progress} />
        <span className="font-mono text-[10px] text-muted-foreground tabular-nums shrink-0">
          {formatClock(previewDuration)}
        </span>
        <button
          type="button"
          onClick={cycleSpeed}
          aria-label="Playback speed"
          className="flex h-11 min-w-11 shrink-0 items-center justify-center rounded-lg border border-border px-1.5 font-mono text-[11px] font-bold text-foreground cursor-pointer"
        >
          {speed}x
        </button>
        <button
          type="button"
          onClick={sendPreview}
          aria-label="Send voice note"
          title="Send voice note"
          className="flex h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground cursor-pointer"
        >
          Send
        </button>
      </div>
    );
  }

  if (phase === "sending") {
    return (
      <div className="flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-muted/40 text-xs text-muted-foreground" role="status">
        <Spinner className="text-foreground" />
        Sending voice note…
      </div>
    );
  }

  // Idle: TAP starts locked recording, HOLD records until release.
  // Both work on web + mobile. A hold-release never retriggers via the
  // follow-up click (suppressed), so the mic can't flash-loop.
  const clearHoldTimer = () => {
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    holdTimerRef.current = null;
  };

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={ptt ? "Hold to talk, tap to record" : "Tap or hold to record voice note"}
      title={ptt ? "Hold to talk (or tap to record)" : "Tap or hold to record"}
      onPointerDown={(e) => {
        if (disabled) return;
        pressedRef.current = true;
        suppressClickRef.current = false;
        holdModeRef.current = false;
        startXRef.current = e.clientX;
        clearHoldTimer();
        // Sustained press => hold mode (release stops to preview,
        // or auto-sends in push-to-talk). Quick taps use onClick.
        holdTimerRef.current = setTimeout(() => {
          holdTimerRef.current = null;
          if (!pressedRef.current || disabled) return;
          if (phaseRef.current !== "idle") return;
          holdModeRef.current = true;
          void beginRecording();
        }, 280);
      }}
      onPointerMove={(e) => {
        if (phaseRef.current !== "recording") return;
        const dx = e.clientX - startXRef.current;
        const armed = dx < -80;
        cancelRef.current = armed;
        setCancelArmed(armed);
      }}
      onPointerUp={() => {
        pressedRef.current = false;
        clearHoldTimer();
        // Hold mode: release stops to preview (PTT skips preview on send).
        if (holdModeRef.current && phaseRef.current === "recording") {
          holdModeRef.current = false;
          suppressClickRef.current = true;
          stopRecording(cancelRef.current);
          return;
        }
        if (phaseRef.current === "acquiring") {
          pendingStopRef.current = true;
        }
        holdModeRef.current = false;
      }}
      onPointerCancel={() => {
        pressedRef.current = false;
        clearHoldTimer();
        if (phaseRef.current === "recording") stopRecording(true);
        else if (phaseRef.current === "acquiring") pendingStopRef.current = true;
        holdModeRef.current = false;
      }}
      onPointerLeave={() => {
        // Finger slid far off: keep recording (slide-left cancels),
        // but a release outside still ends the hold via pointerup.
        pressedRef.current = false;
      }}
      onClick={() => {
        // Tap-to-record (web + mobile): one tap locks into recording,
        // Stop/Send finish it. Ignored right after a hold-release.
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          return;
        }
        if (disabled || holdModeRef.current) return;
        if (phaseRef.current === "idle") void beginRecording();
      }}
      onContextMenu={(e) => e.preventDefault()}
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full cursor-pointer touch-manipulation select-none disabled:opacity-50 ${
        transparentIdle
          ? "text-muted-foreground hover:text-foreground active:text-foreground"
          : "border border-border bg-background text-xs font-medium active:bg-muted"
      }`}
    >
      {transparentIdle ? <Mic size={20} /> : "Mic"}
    </button>
  );
}

export function voiceFileName(mime: string): string {
  return `voice-note.${audioExtension(mime)}`;
}
