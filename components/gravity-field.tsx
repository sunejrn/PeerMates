"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface Dot {
  homeX: number;
  homeY: number;
  x: number;
  y: number;
  phase: number;
}

const SPACING = 36; // px between resting dots
const INFLUENCE = 150; // px radius the cursor affects
const MAX_PUSH = 9; // px, max displacement at the cursor's center
const EASE = 0.14; // how quickly dots chase their target each frame
const IDLE_AMPLITUDE = 0.5; // px, ambient drift when the cursor is idle

/**
 * Reads a color straight off the page's own Tailwind tokens (e.g. "text-ink",
 * "text-teal") via a throwaway probe element, so the field always matches the
 * live theme — including light/dark — without hardcoding a hex value.
 */
function readColor(className: string) {
  const fallback = { r: 148, g: 163, b: 184 };
  if (typeof document === "undefined") return fallback;
  const probe = document.createElement("span");
  probe.className = className;
  probe.style.position = "absolute";
  probe.style.opacity = "0";
  probe.style.pointerEvents = "none";
  document.body.appendChild(probe);
  const { color } = getComputedStyle(probe);
  document.body.removeChild(probe);
  const match = color.match(/\d+(\.\d+)?/g);
  if (!match) return fallback;
  const [r, g, b] = match.map(Number);
  return { r, g, b };
}

const lerp = (a: number, b: number, n: number) => a + (b - a) * n;

export function GravityField({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let base = readColor("text-ink");
    let accent = readColor("text-teal");
    const refreshColors = () => {
      base = readColor("text-ink");
      accent = readColor("text-teal");
    };

    let dots: Dot[] = [];
    let width = 0;
    let height = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pointer = { x: -9999, y: -9999, active: false };
    let raf = 0;
    let onScreen = true;
    let docVisible = true;
    let t = 0;

    const buildDots = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const cols = Math.max(1, Math.round(width / SPACING));
      const rows = Math.max(1, Math.round(height / SPACING));
      const offsetX = (width - cols * SPACING) / 2;
      const offsetY = (height - rows * SPACING) / 2;

      dots = [];
      for (let r = 0; r <= rows; r++) {
        for (let c = 0; c <= cols; c++) {
          const hx = offsetX + c * SPACING;
          const hy = offsetY + r * SPACING;
          dots.push({
            homeX: hx,
            homeY: hy,
            x: hx,
            y: hy,
            phase: Math.random() * Math.PI * 2,
          });
        }
      }
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      t += 0.012;

      for (const dot of dots) {
        const wobbleX = Math.sin(t + dot.phase) * IDLE_AMPLITUDE;
        const wobbleY = Math.cos(t * 0.8 + dot.phase) * IDLE_AMPLITUDE;

        let targetX = dot.homeX + wobbleX;
        let targetY = dot.homeY + wobbleY;
        let near = 0;

        if (pointer.active) {
          const dx = dot.homeX - pointer.x;
          const dy = dot.homeY - pointer.y;
          const dist = Math.hypot(dx, dy);
          if (dist < INFLUENCE) {
            near = 1 - dist / INFLUENCE;
            const push = MAX_PUSH * near * near;
            const nx = dist > 0.01 ? dx / dist : 0;
            const ny = dist > 0.01 ? dy / dist : 0;
            targetX += nx * push;
            targetY += ny * push;
          }
        }

        dot.x = lerp(dot.x, targetX, EASE);
        dot.y = lerp(dot.y, targetY, EASE);

        const alpha = 0.07 + near * 0.4;
        const radius = 0.9 + near * 0.7;
        const r = Math.round(lerp(base.r, accent.r, near));
        const g = Math.round(lerp(base.g, accent.g, near));
        const b = Math.round(lerp(base.b, accent.b, near));

        ctx.beginPath();
        ctx.arc(dot.x, dot.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        ctx.fill();
      }
    };

    const loop = () => {
      if (onScreen && docVisible) draw();
      raf = requestAnimationFrame(loop);
    };

    const handlePointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = e.clientX - rect.left;
      pointer.y = e.clientY - rect.top;
      pointer.active = true;
    };
    const handlePointerLeave = () => {
      pointer.active = false;
    };
    const handleResize = () => buildDots();
    const handleVisibility = () => {
      docVisible = document.visibilityState === "visible";
    };

    buildDots();

    const io = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry.isIntersecting;
      },
      { threshold: 0 },
    );
    io.observe(canvas);

    const themeObserver = new MutationObserver(refreshColors);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });

    window.addEventListener("resize", handleResize);
    document.addEventListener("visibilitychange", handleVisibility);

    if (reduceMotion) {
      draw(); // static field only — no loop, no pointer tracking
    } else {
      window.addEventListener("pointermove", handlePointerMove, {
        passive: true,
      });
      window.addEventListener("pointerleave", handlePointerLeave);
      raf = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      themeObserver.disconnect();
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerleave", handlePointerLeave);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn("pointer-events-none absolute inset-0", className)}
    />
  );
}