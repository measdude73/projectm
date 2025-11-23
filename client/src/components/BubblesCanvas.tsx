import React, { useEffect, useRef } from "react";

const PER_BUBBLE = 9; // x,y,vx,vy,radius,health,alive,id,imgIndex

type Props = {
  count?: number;
  tickMs?: number;
  style?: React.CSSProperties;
  initialState?: ArrayBuffer | null;
  initialCount?: number | null;
  arenaWidth?: number;
  arenaHeight?: number;
  getBitmapForIndex?: (idx: number) => ImageBitmap | undefined;
  getSrcForIndex?: (idx: number) => string | undefined;
};

export default function BubblesCanvas({ count = 800, tickMs = 30, style, initialState, initialCount, arenaWidth, arenaHeight, getBitmapForIndex, }: Props) {
  // we will read initialState via props in effects below
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const positionsRef = useRef<Float32Array | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // init worker
    try {
      // @ts-ignore - Vite style worker import
      const w = new Worker(new URL("../workers/physicsWorker.js", import.meta.url), { type: "module" });
      workerRef.current = w;
      w.onmessage = (e: MessageEvent) => {
        const { type, buffer } = e.data as any;
        if (type === "buffer" && buffer) {
          positionsRef.current = new Float32Array(buffer);
        }
      };
      const { width, height } = canvas.getBoundingClientRect();
      w.postMessage({ type: "init", payload: { count, width, height, tickMs, minRadius: 3, maxRadius: 12, startHealth: 100 } });
    } catch (err) {
      console.error("Failed to start physics worker:", err);
    }

    // If an initial state buffer was provided before worker was ready, send it once worker exists.
    const sendInitialIfAvailable = () => {
      const w = workerRef.current;
      if (!w) return;
      if (initialState && initialCount && initialCount > 0) {
        try {
          w.postMessage({ type: 'initBuffer', payload: { count: initialCount, width: arenaWidth || canvas.clientWidth, height: arenaHeight || canvas.clientHeight, tickMs } , buffer: initialState }, [initialState]);
        } catch (err) {
          // if transfer fails, try without transfer
          try {
            w.postMessage({ type: 'initBuffer', payload: { count: initialCount, width: arenaWidth || canvas.clientWidth, height: arenaHeight || canvas.clientHeight, tickMs }, buffer: initialState });
          } catch (e) {
            console.error('Failed to send initial state to worker', e);
          }
        }
      }
    };

    // Give a small timeout to allow worker to be fully ready
    setTimeout(sendInitialIfAvailable, 50);

    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const pos = positionsRef.current;
      if (!pos) return;
      const n = Math.floor(pos.length / PER_BUBBLE);
      for (let i = 0; i < n; i++) {
        const b = i * PER_BUBBLE;
        const alive = pos[b + 6];
        if (!alive) continue;
        const x = pos[b + 0];
        const y = pos[b + 1];
        const r = pos[b + 4] || 4;
        const hp = pos[b + 5] ?? 100;
        const imgIdx = Math.floor(pos[b + 8] ?? -1);

        let drawnImage = false;
        if (imgIdx >= 0 && typeof getBitmapForIndex === "function") {
          const bmp = getBitmapForIndex(imgIdx);
          if (bmp) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.clip();
            ctx.drawImage(bmp, x - r, y - r, r * 2, r * 2);
            ctx.restore();
            drawnImage = true;
          }
        }

        if (!drawnImage) {
          // fill circle
          ctx.beginPath();
          ctx.arc(x, y, Math.max(1, r), 0, Math.PI * 2);
          ctx.fillStyle = "#7fdbff";
          ctx.fill();
        }

        // outline health
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1, r + 1.5), -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (Math.max(0, Math.min(1, hp / 100))));
        ctx.strokeStyle = hp > 60 ? "#2ecc71" : hp > 30 ? "#f1c40f" : "#ff4d4d";
        ctx.lineWidth = Math.max(1, Math.round(r * 0.12));
        ctx.stroke();
      }
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      if (workerRef.current) {
        try {
          workerRef.current.postMessage({ type: "stop" });
        } catch (e) {}
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, [count, tickMs]);

    // If `initialState` arrives later (e.g. when the user clicks Play), forward it to the worker
    useEffect(() => {
      if (!initialState || !initialCount) return;
      const w = workerRef.current;
      const canvas = canvasRef.current;
      if (!w || !canvas) return;
      try {
        w.postMessage({ type: 'initBuffer', payload: { count: initialCount, width: arenaWidth || canvas.clientWidth, height: arenaHeight || canvas.clientHeight, tickMs }, buffer: initialState }, [initialState]);
      } catch (err) {
        try {
          w.postMessage({ type: 'initBuffer', payload: { count: initialCount, width: arenaWidth || canvas.clientWidth, height: arenaHeight || canvas.clientHeight, tickMs }, buffer: initialState });
        } catch (e) {
          console.error('Failed to forward initialState to worker', e);
        }
      }
    }, [initialState, initialCount, arenaWidth, arenaHeight, tickMs]);

  return <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block", ...style }} />;
}
