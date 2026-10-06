"use client";

import { useEffect, useRef } from "react";
import { ultraPerfOk } from "@/lib/video/clarity";

/**
 * Clarity Ultra canvas: redraws the native <video> element each frame
 * through a WebGL edge-aware sharpen + contrast/saturation shader.
 *
 * - The <video> stays the audio + sync source; this canvas is visual only,
 *   so sync, subtitles, markers, and controls are untouched.
 * - CORS-tainted frames throw on upload → silent fallback to Light.
 * - A 3s perf gate drops to Light below ~24fps.
 * - Releases everything on pause, tab-hide, PiP, and unmount.
 */

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAG = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_px;
uniform float u_sharpen;
uniform float u_contrast;
uniform float u_sat;
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
void main() {
  vec3 c = texture2D(u_tex, v_uv).rgb;
  vec3 tl = texture2D(u_tex, v_uv + u_px * vec2(-1.0, -1.0)).rgb;
  vec3 t  = texture2D(u_tex, v_uv + u_px * vec2( 0.0, -1.0)).rgb;
  vec3 tr = texture2D(u_tex, v_uv + u_px * vec2( 1.0, -1.0)).rgb;
  vec3 l  = texture2D(u_tex, v_uv + u_px * vec2(-1.0,  0.0)).rgb;
  vec3 r  = texture2D(u_tex, v_uv + u_px * vec2( 1.0,  0.0)).rgb;
  vec3 bl = texture2D(u_tex, v_uv + u_px * vec2(-1.0,  1.0)).rgb;
  vec3 b  = texture2D(u_tex, v_uv + u_px * vec2( 0.0,  1.0)).rgb;
  vec3 br = texture2D(u_tex, v_uv + u_px * vec2( 1.0,  1.0)).rgb;
  vec3 blur = (tl + t + tr + l + r + bl + b + br) * 0.125;
  float edge = abs(luma(c) - luma(blur));
  // Sharpen flats, protect real edges from haloing.
  float k = u_sharpen * (1.0 - clamp(edge * 6.0, 0.0, 0.85));
  vec3 outc = clamp(c + (c - blur) * k, 0.0, 1.0);
  // Contrast + saturation lift.
  outc = (outc - 0.5) * u_contrast + 0.5;
  float g = luma(outc);
  outc = clamp(mix(vec3(g), outc, u_sat), 0.0, 1.0);
  gl_FragColor = vec4(outc, 1.0);
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error("clarity shader failed");
  }
  return sh;
}

export function ClarityCanvas({
  video,
  onFallback,
  onStats,
}: {
  video: HTMLVideoElement | null;
  /** (message, silent) — silent CORS falls back without alarming. */
  onFallback: (message: string, silent?: boolean) => void;
  onStats?: (fps: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cbRef = useRef({ onFallback, onStats });
  cbRef.current = { onFallback, onStats };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !video) return;
    let gl: WebGLRenderingContext | null = null;
    try {
      gl =
        (canvas.getContext("webgl2", {
          alpha: false,
          antialias: false,
          depth: false,
          stencil: false,
          powerPreference: "low-power",
        }) as WebGLRenderingContext | null) ??
        (canvas.getContext("webgl", {
          alpha: false,
          antialias: false,
          depth: false,
          stencil: false,
          powerPreference: "low-power",
        }) as WebGLRenderingContext | null);
    } catch {
      gl = null;
    }
    if (!gl) {
      cbRef.current.onFallback("Ultra isn't supported on this device — using Light.");
      return;
    }

    let prog: WebGLProgram | null = null;
    let tex: WebGLTexture | null = null;
    try {
      prog = gl.createProgram()!;
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("link failed");
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
        gl.STATIC_DRAW
      );
      const loc = gl.getAttribLocation(prog, "a_pos");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.uniform1f(gl.getUniformLocation(prog, "u_sharpen"), 0.55);
      gl.uniform1f(gl.getUniformLocation(prog, "u_contrast"), 1.07);
      gl.uniform1f(gl.getUniformLocation(prog, "u_sat"), 1.12);
    } catch {
      cbRef.current.onFallback("Ultra isn't supported on this device — using Light.");
      return;
    }

    let raf = 0;
    let rvfc: number | null = null;
    let stopped = false;
    let frames = 0;
    let judged = false;
    const t0 = performance.now();
    let lastFpsReport = 0;
    let corsFailed = false;

    const sizeCanvas = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(2, Math.round(video.clientWidth * dpr));
      const h = Math.max(2, Math.round(video.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl!.viewport(0, 0, canvas.width, canvas.height);
    };

    const draw = () => {
      if (stopped || !gl) return;
      // PiP / hidden / paused: release the frame loop, keep video as-is.
      if (
        document.hidden ||
        document.pictureInPictureElement ||
        video.paused ||
        video.ended ||
        video.readyState < 2 ||
        video.videoWidth === 0
      ) {
        // Clear to transparent so the raw video shows through.
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        return;
      }
      sizeCanvas();
      try {
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
      } catch {
        // CORS-tainted video: fall back to Light without alarming.
        if (!corsFailed) {
          corsFailed = true;
          cbRef.current.onFallback("Ultra needs CORS access — using Light.", true);
        }
        return;
      }
      const px = gl.getUniformLocation(prog!, "u_px");
      gl.uniform2f(px, 1 / video.videoWidth, 1 / video.videoHeight);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      frames += 1;
      const elapsed = performance.now() - t0;
      if (!judged && elapsed >= 3000) {
        judged = true;
        const fps = (frames / elapsed) * 1000;
        cbRef.current.onStats?.(Math.round(fps));
        if (!ultraPerfOk(frames, elapsed)) {
          cbRef.current.onFallback(
            `Ultra managed ${Math.round(fps)}fps here — fell back to Light.`
          );
          return;
        }
      } else if (elapsed - lastFpsReport > 5000) {
        lastFpsReport = elapsed;
        cbRef.current.onStats?.(Math.round((frames / elapsed) * 1000));
      }
    };

    const loop = () => {
      if (stopped) return;
      draw();
      const v = video as HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: () => void) => number;
        cancelVideoFrameCallback?: (h: number) => void;
      };
      if (typeof v.requestVideoFrameCallback === "function") {
        rvfc = v.requestVideoFrameCallback(() => loop());
      } else {
        raf = requestAnimationFrame(loop);
      }
    };
    const onVis = () => {
      if (!document.hidden && !stopped) loop();
    };
    document.addEventListener("visibilitychange", onVis);
    loop();

    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVis);
      cancelAnimationFrame(raf);
      try {
        const v = video as HTMLVideoElement & {
          cancelVideoFrameCallback?: (h: number) => void;
        };
        if (rvfc !== null && typeof v.cancelVideoFrameCallback === "function") {
          v.cancelVideoFrameCallback(rvfc);
        }
      } catch {
        // ignore
      }
      try {
        if (tex) gl!.deleteTexture(tex);
        if (prog) gl!.deleteProgram(prog);
        gl!.getExtension("WEBGL_lose_context")?.loseContext();
      } catch {
        // ignore
      }
    };
  }, [video]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}
