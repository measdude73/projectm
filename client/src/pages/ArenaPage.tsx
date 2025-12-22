// src/pages/ArenaPage.tsx
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { getRandom } from "../utils/helpers";
import "../App.css";
import statsClient, { recordHit, recordKill } from "../utils/statsClient";

/**
 * Notes:
 *  - Normal arena: normal-normal collisions reduce health for both (with cooldown) and spikes damage normals.
 *  - Boss arena: normal-normal collisions only separate/bounce (no health loss). Normal-superbubble collisions
 *    do damage to normals and superbubble as before. Spikes do not damage superbubble.
 *  - Images start small (circular) and grow to target radius on spawn.
 */

/* ---------- Types ---------- */

export interface BubbleData {
  x: number;
  y: number;
  radius: number;
  health: number;
  imgSrc: string;
  vx: number;
  vy: number;
  id: number;
}

export interface Spike {
  side: string;
  x: number;
  y: number;
  size: number;
}

interface SuperPower {
  name: string;
  damage: number;
}

/* ---------- Constants ---------- */

const SUPER_BUBBLE_TYPES: { [k: string]: SuperPower } = {
  flame: { name: "Flame Shot", damage: 15 },
  arrow: { name: "Arrow Shot", damage: 10 },
  bullet: { name: "Bullet Shot", damage: 20 },
};

const ARENA_TYPES = {
  NORMAL: "normal",
  BOSS: "boss",
} as const;

const SUPER_BUBBLE_HEALTH = 100;

let nextBubbleId = 1;
let nextProjectileId = 1;

type Projectile = { id: number; x: number; y: number; vx: number; vy: number; type: keyof typeof SUPER_BUBBLE_TYPES };

/* ---------- Helpers ---------- */

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const dist2 = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};

const getRadiusForCount = (count: number) => {
  if (count <= 5) return 40;
  if (count <= 10) return 30;
  if (count <= 50) return 27;
  if (count <= 100) return 20;
  if (count <= 500) return 15;
  if (count <= 1000) return 13;
  if (count <= 2000) return 12;
  if (count <= 4000) return 11;
  if (count <= 5000) return 10;
  if (count <= 6000) return 9;
  if (count <= 7000) return 7;
  if (count <= 9000) return 6;
  if (count <= 10000) return 3;
  if (count <= 50000) return 2;
  if (count <= 100000) return 1.5;
  return 1;
};

const IMAGE_SHOW_RADIUS = 12;
const REVEAL_THRESHOLD = 7000;
const IMAGE_DECODE_CONCURRENCY = 2;

const BUCKET_SIZES = [8, 11, 13, 15, 20, 27, 30, 40, 64];
const REVEAL_BATCH_PER_TICK = 120;
const MASKED_CACHE_PIXEL_SOFT_LIMIT = 140 * 1024 * 1024;

const separatePair = (ax: number, ay: number, ar: number, bx: number, by: number, br: number) => {
  const dx = bx - ax;
  const dy = by - ay;
  const d = Math.sqrt(dx * dx + dy * dy) || 0.0001;
  const overlap = ar + br - d;
  if (overlap > 0) {
    const ux = dx / d;
    const uy = dy / d;
    return {
      ax: ax - ux * (overlap / 2),
      ay: ay - uy * (overlap / 2),
      bx: bx + ux * (overlap / 2),
      by: by + uy * (overlap / 2),
    };
  }
  return { ax, ay, bx, by };
};

const bouncePairVel = (avx: number, avy: number, bvx: number, bvy: number, ax: number, ay: number, bx: number, by: number) => {
  const vx = avx - bvx;
  const vy = avy - bvy;
  const dx = ax - bx;
  const dy = ay - by;
  const d2 = dx * dx + dy * dy;
  if (d2 === 0) return { avx, avy, bvx, bvy };
  const dot = vx * dx + vy * dy;
  if (dot > 0) return { avx, avy, bvx, bvy };
  const collisionScale = dot / d2;
  const cx = dx * collisionScale;
  const cy = dy * collisionScale;
  avx = avx - cx;
  avy = avy - cy;
  bvx = bvx + cx;
  bvy = bvy + cy;
  // do not apply additional damping here - keep collision energy consistent
  // small, explicit damping was removed because it caused noticeable slowdowns over time
  // (previously: multiply velocities by 0.98)
  return { avx, avy, bvx, bvy };
};

/* ---------- New growth animation constants ---------- */

const INITIAL_RADIUS = 3; // tiny circular placeholder
const GROW_DURATION_MS = 700; // time to grow from INITIAL_RADIUS to target

/* ---------- Superbubble collision cooldown ---------- */

const SB_COLLISION_COOLDOWN_MS = 120; // each normal only takes damage from superbubble at this interval

/* ---------- Component ---------- */

const ArenaPage: React.FC = () => {
  const speed = 3;

  const arenaRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const leaderboardRef = useRef<HTMLDivElement | null>(null);
  const imageListRef = useRef<string[]>([]);
  const bossImgRef = useRef<string>("");

  const [arenaType, setArenaType] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const [uiBubblesSnapshot, setUiBubblesSnapshot] = useState<BubbleData[]>([]);
  const [superBubbleSnapshot, setSuperBubbleSnapshot] = useState<BubbleData | null>(null);
  const [projectiles, setProjectiles] = useState<Projectile[]>([]);

  const [winner, setWinner] = useState<BubbleData | null>(null);
  const [winnersList, setWinnersList] = useState<BubbleData[] | null>(null);
  const [winnersImages, setWinnersImages] = useState<string[] | null>(null);

  const [spikeEnabled, setSpikeEnabled] = useState(false);
  const [spikeCount, setSpikeCount] = useState(1);
  const [spikeSize, setSpikeSize] = useState(30);
  const [spikePositions, setSpikePositions] = useState<Omit<Spike, "size">[]>([]);

  const [speedMultiplier, setSpeedMultiplier] = useState(2.5);
  const [controlsOpen, setControlsOpen] = useState(true);

  const [superpowerEnabled, setSuperpowerEnabled] = useState(false);
  const [selectedPowers, setSelectedPowers] = useState<{ [k in keyof typeof SUPER_BUBBLE_TYPES]?: boolean }>({
    flame: true,
    arrow: false,
    bullet: false,
  });
  const [firingMode, setFiringMode] = useState<"auto" | "manual">("manual");
  const autoFireRef = useRef<number | null>(null);
  const [projectileSpeedPerTick, setProjectileSpeedPerTick] = useState<number>(6);
  const [muzzleFlashes, setMuzzleFlashes] = useState<{ id: number; x: number; y: number; createdAt: number }[]>([]);
  const [hitEffects, setHitEffects] = useState<{ id: number; x: number; y: number; createdAt: number }[]>([]);

  // typed arrays & resources
  const MAX_CAPACITY = useRef<number>(1024 * 64);
  const countRef = useRef<number>(0);
  const idListRef = useRef<Int32Array | null>(null);
  const xRef = useRef<Float32Array | null>(null);
  const yRef = useRef<Float32Array | null>(null);
  const vxRef = useRef<Float32Array | null>(null);
  const vyRef = useRef<Float32Array | null>(null);
  const rRef = useRef<Float32Array | null>(null);
  const rTargetRef = useRef<Float32Array | null>(null); // per-bubble target radius
  const healthRef = useRef<Float32Array | null>(null);
  const imgIndexRef = useRef<Int32Array | null>(null);
  const imgSrcsRef = useRef<string[]>([]);
  const textureCache = useRef<Map<string, HTMLImageElement>>(new Map());
  const imageBitmapCache = useRef<Map<string, ImageBitmap>>(new Map());
  const imageDecodeWorkerRef = useRef<Worker | null>(null);
  const imageMaskWorkerRef = useRef<Worker | null>(null);
  const imagesToDecodeRef = useRef<Set<string>>(new Set());
  const imagesDecodingRef = useRef<Set<string>>(new Set());

  const maskedBitmapCacheRef = useRef<Map<string, ImageBitmap>>(new Map());
  const maskedLruRef = useRef<string[]>([]);
  const maskedPixelBytesRef = useRef<number>(0);
  const maskedCreateQueueRef = useRef<string[]>([]);
  const maskedCreatingSetRef = useRef<Set<string>>(new Set());
  const revealStartedRef = useRef<boolean>(false);

  const damageCooldownRef = useRef<Record<number, number>>({});
  const sbCollisionCooldownRef = useRef<Record<number, number>>({}); // per-normal cooldown for superbubble collisions
  const dyingRef = useRef<Record<number, number>>({});
  const deathQueueRef = useRef<number[]>([]);
  const deathQueueSetRef = useRef<Set<number>>(new Set());
  const lastDamagerRef = useRef<Record<number, string | null>>({});
  const indexOfIdRef = useRef<Record<number, number>>({});
  const lastUiSnapshotTimeRef = useRef<number>(0);
  const normalizePlayer = (p?: string | null) => {
    if (!p) return '';
    try {
      const raw = String(p || '');
      const stripped = raw.replace(/^https?:\/\/[^\/]+\//, '').replace(/^\/+/, '');
      const parts = stripped.split('/');
      return parts[parts.length - 1] || raw;
    } catch (e) {
      return String(p);
    }
  };
  const currentGameRef = useRef<string | null>(null);

  const superBubbleRef = useRef<{ x: number; y: number; vx: number; vy: number; radius: number; health: number; imgSrc: string; id: number } | null>(null);

  const getArenaDimensions = () => {
    const arena = arenaRef.current;
    if (arena) {
      const rect = arena.getBoundingClientRect();
      // subtract 1px to prevent rounding issues that let things touch other UI
      return { width: Math.max(2, rect.width - 1), height: Math.max(2, rect.height - 1) };
    }
    // fallback
    return { width: Math.round(window.innerWidth * 0.7), height: Math.round(window.innerHeight * 0.8) };
  };

  const ensureCapacity = (needed: number) => {
    let cap = MAX_CAPACITY.current;
    if (needed <= cap) return;
    while (cap < needed) cap = Math.max(cap * 2, cap + 1024);
    const idNew = new Int32Array(cap);
    const xNew = new Float32Array(cap);
    const yNew = new Float32Array(cap);
    const vxNew = new Float32Array(cap);
    const vyNew = new Float32Array(cap);
    const rNew = new Float32Array(cap);
    const rTargetNew = new Float32Array(cap);
    const healthNew = new Float32Array(cap);
    const imgIdxNew = new Int32Array(cap);

    const n = countRef.current;
    if (idListRef.current) idNew.set(idListRef.current.subarray(0, n));
    if (xRef.current) xNew.set(xRef.current.subarray(0, n));
    if (yRef.current) yNew.set(yRef.current.subarray(0, n));
    if (vxRef.current) vxNew.set(vxRef.current.subarray(0, n));
    if (vyRef.current) vyNew.set(vyRef.current.subarray(0, n));
    if (rRef.current) rNew.set(rRef.current.subarray(0, n));
    if (rTargetRef.current) rTargetNew.set(rTargetRef.current.subarray(0, n));
    if (healthRef.current) healthNew.set(healthRef.current.subarray(0, n));
    if (imgIndexRef.current) imgIdxNew.set(imgIndexRef.current.subarray(0, n));

    idListRef.current = idNew;
    xRef.current = xNew;
    yRef.current = yNew;
    vxRef.current = vxNew;
    vyRef.current = vyNew;
    rRef.current = rNew;
    rTargetRef.current = rTargetNew;
    healthRef.current = healthNew;
    imgIndexRef.current = imgIdxNew;
    MAX_CAPACITY.current = cap;
  };

  // ---------- Workers init & image pipeline (kept mostly) ----------

  const initImageDecodeWorker = () => {
    if (imageDecodeWorkerRef.current) return;
    try {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      imageDecodeWorkerRef.current = new Worker(new URL("../workers/imageDecoderWorker.js", import.meta.url), { type: "module" });
      imageDecodeWorkerRef.current.onmessage = (ev: MessageEvent) => {
        const { type, src, bitmap, success } = ev.data;
        if (type === "decoded" && success && bitmap) {
          imageBitmapCache.current.set(src, bitmap);
          imagesDecodingRef.current.delete(src);
          processMaskCreationQueue();
          processImageDecodeQueue();
        } else if (type === "decoded") {
          imagesDecodingRef.current.delete(src);
          imagesToDecodeRef.current.delete(src);
          processImageDecodeQueue();
        }
      };
    } catch (e) {
      console.warn("Image decode worker failed to initialize:", e);
    }
  };

  const initImageMaskWorker = () => {
    if (imageMaskWorkerRef.current) return;
    try {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      imageMaskWorkerRef.current = new Worker(new URL("../workers/imageMaskWorker.js", import.meta.url), { type: "module" });
      imageMaskWorkerRef.current.onmessage = (ev: MessageEvent) => {
        const { type, id, src, bitmap, success } = ev.data;
        if (type === "masked") {
          const key = id as string;
          maskedCreatingSetRef.current.delete(key);
          if (success && bitmap) {
            try {
              const old = maskedBitmapCacheRef.current.get(key);
              if (old && (old as any).close) {
                try {
                  (old as any).close();
                } catch (e) {}
              }
              maskedBitmapCacheRef.current.set(key, bitmap);
              maskedLruRef.current.push(key);
              const sizeMatch = key.match(/::r(\d+)$/);
              const bucket = sizeMatch ? parseInt(sizeMatch[1], 10) : 32;
              const px = Math.max(1, bucket * 2);
              maskedPixelBytesRef.current += px * px * 4;
              while (maskedPixelBytesRef.current > MASKED_CACHE_PIXEL_SOFT_LIMIT && maskedLruRef.current.length > 0) {
                const evictKey = maskedLruRef.current.shift()!;
                const evictBmp = maskedBitmapCacheRef.current.get(evictKey);
                if (evictBmp) {
                  maskedPixelBytesRef.current -= (Math.max(1, parseInt(evictKey.split("::r").pop() || "16") * 2) ** 2) * 4;
                  try {
                    (evictBmp as any).close && (evictBmp as any).close();
                  } catch (e) {}
                  maskedBitmapCacheRef.current.delete(evictKey);
                }
              }
            } catch (e) {}
          }
          processMaskCreationQueue(0);
        }
      };
    } catch (e) {
      console.warn("Image mask worker failed to initialize:", e);
    }
  };

  const queueImageDecode = (src: string) => {
    if (!src) return;
    if (imageBitmapCache.current.has(src)) return;
    if (imagesDecodingRef.current.has(src)) return;
    if (imagesToDecodeRef.current.has(src)) return;
    imagesToDecodeRef.current.add(src);
    processImageDecodeQueue();
  };

  const processImageDecodeQueue = () => {
    if (!imageDecodeWorkerRef.current) return;
    if (imagesDecodingRef.current.size >= IMAGE_DECODE_CONCURRENCY) return;
    const toProcess = imagesToDecodeRef.current;
    if (toProcess.size === 0) return;
    const nextSrc = toProcess.values().next().value;
    if (!nextSrc) return;
    toProcess.delete(nextSrc);
    imagesDecodingRef.current.add(nextSrc);
    try {
      imageDecodeWorkerRef.current.postMessage({ type: "decode", id: Math.random(), src: nextSrc });
    } catch (e) {
      imagesDecodingRef.current.delete(nextSrc);
    }
  };

  const preloadImage = (src: string) =>
    new Promise<void>((resolve, reject) => {
      if (!src) return reject("no-src");
      if (textureCache.current.has(src)) return resolve();
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        textureCache.current.set(src, img);
        // queue decode (worker)
        queueImageDecode(src);
        resolve();
      };
      img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
      img.src = src;
    });

  const getImgIndex = (src: string) => {
    if (!src) return -1;
    let idx = imgSrcsRef.current.indexOf(src);
    if (idx >= 0) return idx;
    idx = imgSrcsRef.current.length;
    imgSrcsRef.current.push(src);
    return idx;
  };

  const pickBucketForRadius = (r: number) => {
    for (let i = 0; i < BUCKET_SIZES.length; i++) {
      if (r <= BUCKET_SIZES[i]) return BUCKET_SIZES[i];
    }
    return BUCKET_SIZES[BUCKET_SIZES.length - 1];
  };

  const maskedKey = (src: string, bucket: number) => `${src}::r${bucket}`;

  const enqueueMaskedCreation = (src: string, bucket: number) => {
    const key = maskedKey(src, bucket);
    if (maskedBitmapCacheRef.current.has(key) || maskedCreatingSetRef.current.has(key)) return;
    if (maskedCreateQueueRef.current.indexOf(key) >= 0) return;
    maskedCreateQueueRef.current.push(key);
    processMaskCreationQueue();
  };

  const processMaskCreationQueue = (budget = REVEAL_BATCH_PER_TICK) => {
    if (!imageMaskWorkerRef.current) return;
    let sent = 0;
    const concurrency = Math.max(2, navigator.hardwareConcurrency || 2);
    while (
      maskedCreateQueueRef.current.length > 0 &&
      sent < budget &&
      maskedCreatingSetRef.current.size < concurrency
    ) {
      const key = maskedCreateQueueRef.current.shift()!;
      if (!key) break;
      if (maskedBitmapCacheRef.current.has(key)) continue;
      if (maskedCreatingSetRef.current.has(key)) continue;
      maskedCreatingSetRef.current.add(key);
      sent++;
      const parts = key.split("::r");
      const src = parts[0];
      const bucket = parseInt(parts[1], 10) || 32;
      const outSize = Math.max(2, bucket * 2);
      try {
        imageMaskWorkerRef.current.postMessage({ type: "mask", id: key, src, size: outSize });
      } catch (e) {
        maskedCreatingSetRef.current.delete(key);
      }
    }
  };

  const touchMaskedKey = (key: string) => {
    const idx = maskedLruRef.current.indexOf(key);
    if (idx >= 0) {
      maskedLruRef.current.splice(idx, 1);
      maskedLruRef.current.push(key);
    } else {
      maskedLruRef.current.push(key);
    }
  };

  // ---------- Spike placement & detection ----------

  const detectSpikeHit = (bx: number, by: number, br: number) => {
    const arena = getArenaDimensions();
    for (const s of spikePositions) {
      const size = spikeSize;
      if (s.side === "top") {
        if (bx + br >= s.x && bx - br <= s.x + size && by - br <= size) return { ...s, size };
      } else if (s.side === "bottom") {
        if (bx + br >= s.x && bx - br <= s.x + size && by + br >= arena.height - size) return { ...s, size };
      } else if (s.side === "left") {
        if (by + br >= s.y && by - br <= s.y + size && bx - br <= size) return { ...s, size };
      } else {
        if (by + br >= s.y && by - br <= s.y + size && bx + br >= arena.width - size) return { ...s, size };
      }
    }
    return null;
  };

  // ---------- Loading images & creating particles ----------

  useLayoutEffect(() => {
    if (!arenaType) return;
    if (isRunning) return;

    (async () => {
      const arena = getArenaDimensions();

      const addBubblesToArrays = async (bubblesToAdd: BubbleData[], preloadImages = false) => {
        const currentN = countRef.current;
        const needed = currentN + bubblesToAdd.length;
        ensureCapacity(needed);
        const idArr = idListRef.current!;
        const xArr = xRef.current!;
        const yArr = yRef.current!;
        const vxArr = vxRef.current!;
        const vyArr = vyRef.current!;
        const rArr = rRef.current!;
        const rTArr = rTargetRef.current!;
        const hArr = healthRef.current!;
        const imgIdxArr = imgIndexRef.current!;

        for (let i = 0; i < bubblesToAdd.length; i++) {
          const b = bubblesToAdd[i];
          const idx = currentN + i;
          idArr[idx] = b.id;
          indexOfIdRef.current[b.id] = idx;
          xArr[idx] = clamp(b.x, b.radius, arena.width - b.radius);
          yArr[idx] = clamp(b.y, b.radius, arena.height - b.radius);
          vxArr[idx] = b.vx;
          vyArr[idx] = b.vy;
          // start small and animate to the target
          rTArr[idx] = b.radius;
          rArr[idx] = INITIAL_RADIUS;
          hArr[idx] = b.health;
          if (b.imgSrc) {
            const imgSrc = b.imgSrc;
            const imgIndex = getImgIndex(imgSrc);
            imgIdxArr[idx] = imgIndex;
            if (preloadImages) {
              // only preload small number or when reveal is desired — avoid mass main-thread work
              preloadImage(imgSrc).catch(() => {});
            }
          } else {
            imgIdxArr[idx] = -1;
          }
        }
        countRef.current = needed;
        const snap: BubbleData[] = [];
        for (let k = 0; k < countRef.current; k++) {
          snap.push({
            x: xArr[k],
            y: yArr[k],
            radius: rArr[k],
            health: hArr[k],
            imgSrc: imgSrcsRef.current[imgIdxArr[k]] ?? "",
            vx: vxArr[k],
            vy: vyArr[k],
            id: idArr[k],
          });
        }
        setUiBubblesSnapshot(snap);
        setActiveCount(snap.length);
        startRevealPipelineIfNeeded();
      };

      if (arenaType === ARENA_TYPES.NORMAL) {
        try {
          const res = await fetch("http://localhost:5000/api/images");
          const images: string[] = await res.json();
          imageListRef.current = images;
          const targetRadius = getRadiusForCount(images.length);
          const newBubbles: BubbleData[] = [];
          for (const img of images) {
            const x = getRandom(targetRadius, arena.width - targetRadius);
            const y = getRandom(targetRadius, arena.height - targetRadius);
            newBubbles.push({
              x,
              y,
              radius: targetRadius,
              health: 100,
              imgSrc: "http://localhost:5000" + img,
              vx: Math.cos(Math.random() * Math.PI * 2) * speed * 0.6,
              vy: Math.sin(Math.random() * Math.PI * 2) * speed * 0.6,
              id: nextBubbleId++,
            });
          }
          await addBubblesToArrays(newBubbles, false);
        } catch (e) {
          console.error("Error fetching normal images", e);
        }
      } else {
        // boss
        try {
          const res = await fetch("http://localhost:5000/api/bossimgs");
          const images: string[] = await res.json();
          imageListRef.current = images;
          const targetRadius = getRadiusForCount(images.length);
          const newBubbles: BubbleData[] = [];
          for (const img of images) {
            let tries = 0;
            let x = 0;
            let y = 0;
            let valid = false;
            while (!valid && tries < 200) {
              tries++;
              x = getRandom(targetRadius, arena.width - targetRadius);
              y = getRandom(targetRadius, arena.height - targetRadius);
              valid = true;
              for (const nb of newBubbles) {
                const dx = x - nb.x;
                const dy = y - nb.y;
                if (Math.sqrt(dx * dx + dy * dy) < targetRadius * 2) {
                  valid = false;
                  break;
                }
              }
            }
            newBubbles.push({
              x,
              y,
              radius: targetRadius,
              health: 100,
              imgSrc: `http://localhost:5000/bossimgs/${img}`,
              vx: Math.cos(Math.random() * Math.PI * 2) * speed * 0.4, // give boss normals some motion
              vy: Math.sin(Math.random() * Math.PI * 2) * speed * 0.4,
              id: nextBubbleId++,
            });
          }
          countRef.current = 0;
          imgSrcsRef.current = [];
          textureCache.current.clear();
          ensureCapacity(newBubbles.length + 8);
          await addBubblesToArrays(newBubbles, true);
        } catch (e) {
          console.error("Error fetching boss images", e);
        }

        // superbubble image & init
        try {
          const res2 = await fetch("http://localhost:5000/api/superbubbleimg");
          const imgs: string[] = await res2.json();
          let src = "";
          if (imgs.length > 0) src = `http://localhost:5000/superbubbleimg/${imgs[0]}`;
          bossImgRef.current = src;
          const dim = getArenaDimensions();
          superBubbleRef.current = {
            x: dim.width / 2,
            y: dim.height / 2,
            radius: 60,
            health: SUPER_BUBBLE_HEALTH,
            imgSrc: src,
            vx: Math.cos(Math.random() * Math.PI * 2) * speed * 0.8, // closer magnitude to normals
            vy: Math.sin(Math.random() * Math.PI * 2) * speed * 0.8,
            id: nextBubbleId++,
          };
          setSuperBubbleSnapshot(
            superBubbleRef.current
              ? {
                  x: superBubbleRef.current.x,
                  y: superBubbleRef.current.y,
                  radius: superBubbleRef.current.radius,
                  health: superBubbleRef.current.health,
                  imgSrc: superBubbleRef.current.imgSrc,
                  vx: superBubbleRef.current.vx,
                  vy: superBubbleRef.current.vy,
                  id: superBubbleRef.current.id,
                }
              : null
          );
          if (src) preloadImage(src).catch(() => {});
        } catch (e) {
          console.error("Error fetching superbubble image", e);
        }
      }
    })();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arenaType]);

  // Start reveal pipeline
  const startRevealPipelineIfNeeded = () => {
    if (arenaType !== ARENA_TYPES.NORMAL) return;
    if (revealStartedRef.current) return;
    const n = countRef.current;
    revealStartedRef.current = true;
    try {
      const imgIdxArr = imgIndexRef.current!;
      const rArr = rRef.current!;
      const unique = new Set<string>();
      if (n > 0 && n <= REVEAL_THRESHOLD) {
        for (let i = 0; i < n; i++) {
          const idx = imgIdxArr[i];
          if (idx == null || idx < 0) continue;
          const src = imgSrcsRef.current[idx];
          if (!src || unique.has(src)) continue;
          unique.add(src);
          queueImageDecode(src);
          // Only do HTMLImage preloads for small sets
          try {
            preloadImage(src).catch(() => {});
          } catch {}
          const bucket = pickBucketForRadius(rArr[i] ?? getRadiusForCount(n));
          enqueueMaskedCreation(src, bucket);
        }
        return;
      }

      if ((n === 0 || n > REVEAL_THRESHOLD) && uiBubblesSnapshot.length > 0) {
        const sample = [...uiBubblesSnapshot].sort((a, b) => b.radius - a.radius);
        for (const s of sample) {
          if (!s.imgSrc || unique.has(s.imgSrc)) continue;
          unique.add(s.imgSrc);
          queueImageDecode(s.imgSrc);
          try {
            preloadImage(s.imgSrc).catch(() => {});
          } catch {}
          const b = pickBucketForRadius(s.radius ?? getRadiusForCount(sample.length || 1));
          enqueueMaskedCreation(s.imgSrc, b);
          if (unique.size >= Math.max(200, REVEAL_BATCH_PER_TICK)) break;
        }
      }

      if (n > 0 && n <= REVEAL_THRESHOLD * 2 && n > REVEAL_THRESHOLD) {
        const unique2 = new Set<string>();
        const sampleIndices: number[] = Array.from({ length: n }, (_, i) => i)
          .map((i) => ({ i, r: rArr[i] }))
          .sort((a, b) => b.r - a.r)
          .slice(0, Math.min(n, 1000))
          .map((s) => s.i);
        for (const idx of sampleIndices) {
          const ii = imgIdxArr[idx];
          if (ii == null || ii < 0) continue;
          const src = imgSrcsRef.current[ii];
          if (!src || unique2.has(src)) continue;
          unique2.add(src);
          queueImageDecode(src);
          try {
            preloadImage(src).catch(() => {});
          } catch {}
          enqueueMaskedCreation(src, pickBucketForRadius(rArr[idx]));
        }
      }
    } catch (e) {
      console.warn("startRevealPipelineIfNeeded error:", e);
    }
  };

  // ---------- Initialize workers and cleanup ----------

  useEffect(() => {
    initImageDecodeWorker();
    initImageMaskWorker();

    return () => {
      if (imageDecodeWorkerRef.current) {
        imageDecodeWorkerRef.current.terminate();
        imageDecodeWorkerRef.current = null;
      }
      if (imageMaskWorkerRef.current) {
        imageMaskWorkerRef.current.terminate();
        imageMaskWorkerRef.current = null;
      }
      imageBitmapCache.current.forEach((bmp) => {
        try {
          (bmp as any).close && (bmp as any).close();
        } catch (e) {}
      });
      maskedBitmapCacheRef.current.forEach((bmp) => {
        try {
          (bmp as any).close && (bmp as any).close();
        } catch (e) {}
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Spike placement effect (respect arena dims)
  useEffect(() => {
    if (!spikeEnabled) {
      setSpikePositions([]);
      return;
    }
    const arena = getArenaDimensions();
    const newPositions: Omit<Spike, "size">[] = [];
    const minDist = 30;
    const maxAttempts = 200;
    // ensure desired count exactly
    let attemptsTotal = 0;
    while (newPositions.length < spikeCount && attemptsTotal < spikeCount * maxAttempts) {
      attemptsTotal++;
      const sides = ["top", "bottom", "left", "right"];
      const side = sides[Math.floor(Math.random() * sides.length)];
      let x = 0;
      let y = 0;
      if (side === "top") {
        x = Math.random() * Math.max(2, arena.width - minDist);
        y = 0;
        const ok = newPositions.filter((p) => p.side === "top").every((p) => Math.abs(x - p.x) > minDist);
        if (ok) newPositions.push({ side, x, y });
      } else if (side === "bottom") {
        x = Math.random() * Math.max(2, arena.width - minDist);
        y = arena.height;
        const ok = newPositions.filter((p) => p.side === "bottom").every((p) => Math.abs(x - p.x) > minDist);
        if (ok) newPositions.push({ side, x, y });
      } else if (side === "left") {
        x = 0;
        y = Math.random() * Math.max(2, arena.height - minDist);
        const ok = newPositions.filter((p) => p.side === "left").every((p) => Math.abs(y - p.y) > minDist);
        if (ok) newPositions.push({ side, x, y });
      } else {
        x = arena.width;
        y = Math.random() * Math.max(2, arena.height - minDist);
        const ok = newPositions.filter((p) => p.side === "right").every((p) => Math.abs(y - p.y) > minDist);
        if (ok) newPositions.push({ side, x, y });
      }
    }
    setSpikePositions(newPositions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spikeEnabled, spikeCount, arenaRef.current?.clientWidth, arenaRef.current?.clientHeight, spikeSize]);

  // ---------- UI snapshot update ----------

  const updateUiSnapshotFromArrays = (force: boolean = false) => {
    const now = Date.now();
    if (!force && now - lastUiSnapshotTimeRef.current < 150) return;
    lastUiSnapshotTimeRef.current = now;

    const n = countRef.current;
    const idArr = idListRef.current!;
    const xArr = xRef.current!;
    const yArr = yRef.current!;
    const vxArr = vxRef.current!;
    const vyArr = vyRef.current!;
    const rArr = rRef.current!;
    const hArr = healthRef.current!;
    const imgIdxArr = imgIndexRef.current!;
    const snap: BubbleData[] = [];
    for (let i = 0; i < n; i++) {
      snap.push({
        x: xArr[i],
        y: yArr[i],
        radius: rArr[i],
        health: hArr[i],
        imgSrc: imgSrcsRef.current[imgIdxArr[i]] ?? "",
        vx: vxArr[i],
        vy: vyArr[i],
        id: idArr[i],
      });
    }
    setUiBubblesSnapshot(snap);
    if (superBubbleRef.current) {
      setSuperBubbleSnapshot({
        x: superBubbleRef.current.x,
        y: superBubbleRef.current.y,
        radius: superBubbleRef.current.radius,
        health: superBubbleRef.current.health,
        imgSrc: superBubbleRef.current.imgSrc,
        vx: superBubbleRef.current.vx,
        vy: superBubbleRef.current.vy,
        id: superBubbleRef.current.id,
      });
    } else {
      setSuperBubbleSnapshot(null);
    }
    setActiveCount(n);
  };

  const [activeCount, setActiveCount] = useState<number>(0);

  // ---------- Preview renderer (not running) ----------
  // Keep a preview renderer for when arenaType is set but sim not running.
  useEffect(() => {
    if (!arenaType || isRunning) return;
    const canvas = canvasRef.current;
    const arena = arenaRef.current;
    if (!canvas || !arena) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resizeCanvas = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = arena.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resizeCanvas();
    const ro = new ResizeObserver(resizeCanvas);
    ro.observe(arena);

    let rafId = 0;
    let last = performance.now();

    const loop = (now: number) => {
      rafId = requestAnimationFrame(loop);
      const dt = now - last;
      last = now;

      processImageDecodeQueue();
      processMaskCreationQueue(6);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // animate radius growth here as well for preview
      const TICK_MS = Math.max(1, dt);
      const nPreview = countRef.current;
      if (rRef.current && rTargetRef.current && nPreview > 0) {
        const lerpAlpha = Math.min(1, TICK_MS / GROW_DURATION_MS);
        for (let i = 0; i < nPreview; i++) {
          const cur = rRef.current[i];
          const tgt = rTargetRef.current[i] || getRadiusForCount(nPreview);
          if (cur < tgt) {
            const nextR = cur + (tgt - cur) * lerpAlpha;
            rRef.current[i] = nextR;
            if (nextR >= IMAGE_SHOW_RADIUS) {
              const imgIdx = imgIndexRef.current![i];
              if (imgIdx != null && imgIdx >= 0) {
                const src = imgSrcsRef.current[imgIdx];
                if (src) {
                  queueImageDecode(src);
                  enqueueMaskedCreation(src, pickBucketForRadius(Math.round(nextR)));
                }
              }
            }
          } else if (cur > tgt) {
            rRef.current[i] = tgt;
          }
        }
      }

      // no canvas spikes to avoid duplication (we render spikes as DOM SVGs)
      const nRender = countRef.current;
      const rArrRender = rRef.current!;
      const xArrRender = xRef.current!;
      const yArrRender = yRef.current!;
      const hArrRender = healthRef.current!;
      const imgIdxArrRender = imgIndexRef.current!;

      for (let i = 0; i < nRender; i++) {
        const radius = rArrRender[i];
        const x = xArrRender[i];
        const y = yArrRender[i];
        const hp = hArrRender[i];
        const imgIdx = imgIdxArrRender[i];
        let strokeColor = "#ff4d4d";
        if (hp > 60) strokeColor = "#2ecc71";
        else if (hp > 30) strokeColor = "#f1c40f";

        let drawnImage = false;
        if (radius >= IMAGE_SHOW_RADIUS && imgIdx >= 0) {
          const src = imgSrcsRef.current[imgIdx];
          const bucket = pickBucketForRadius(radius);
          const key = maskedKey(src, bucket);
          const maskedBmp = maskedBitmapCacheRef.current.get(key);
          if (maskedBmp) {
            touchMaskedKey(key);
            ctx.drawImage(maskedBmp, x - radius, y - radius, radius * 2, radius * 2);
            drawnImage = true;
          } else {
            // prefer clipping to avoid square flash
            const bmp = imageBitmapCache.current.get(src);
            const img = textureCache.current.get(src);
            if (bmp || (img && img.complete)) {
              enqueueMaskedCreation(src, bucket);
              // draw clipped circular image to avoid square flash
              try {
                ctx.save();
                ctx.beginPath();
                ctx.arc(x, y, radius, 0, Math.PI * 2);
                ctx.clip();
                if (bmp) ctx.drawImage(bmp, x - radius, y - radius, radius * 2, radius * 2);
                else if (img) ctx.drawImage(img, x - radius, y - radius, radius * 2, radius * 2);
                ctx.restore();
                drawnImage = true;
              } catch (e) {
                try {
                  ctx.restore();
                } catch {}
              }
            } else {
              const shouldDecodeNow = revealStartedRef.current || countRef.current <= REVEAL_THRESHOLD;
              if (src && shouldDecodeNow) {
                queueImageDecode(src);
                preloadImage(src).catch(() => {});
              }
            }
          }
        }

        if (drawnImage) {
          if (radius >= 8) {
            ctx.beginPath();
            ctx.arc(x, y, radius + 2, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * (hp / 100)));
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = 4;
            ctx.stroke();
          }
          continue;
        }

        // fallback circle
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1, radius), 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
        ctx.globalAlpha = 0.95;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1, radius) + 2, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * (hp / 100)));
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    };

    rafId = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arenaType, !isRunning, spikeEnabled, spikeCount, spikeSize, revealStartedRef.current]);

  // ---------- Main simulation & render loop ----------

  useEffect(() => {
    if (!arenaType || !isRunning) return;
    const canvas = canvasRef.current;
    const arena = arenaRef.current;
    if (!canvas || !arena) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    initImageDecodeWorker();
    initImageMaskWorker();

    const resizeCanvas = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = arena.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resizeCanvas();
    const ro = new ResizeObserver(resizeCanvas);
    ro.observe(arena);

    const TICK_MS = 30;
    let rafId = 0;
    let last = performance.now();
    let acc = 0;
    let startGrace = true;
    const graceTimeout = window.setTimeout(() => (startGrace = false), 10);

    const pickRandomIndex = (excludeIndex: number, max: number) => {
      if (max <= 1) return -1;
      let idx = Math.floor(Math.random() * max);
      if (idx === excludeIndex) idx = (idx + 1) % max;
      return idx;
    };

    const loop = (now: number) => {
      rafId = requestAnimationFrame(loop);
      const dt = now - last;
      last = now;
      acc += dt;

      // logic ticks
      while (acc >= TICK_MS) {
        acc -= TICK_MS;
        const nowMs = Date.now();

        const bubbleCount = countRef.current;
        let baseDamage = 100;
        let DEATH_DELAY_MS = 30;
        let MAX_DEATHS_PER_TICK = 60;
        let localSpeedMult = speedMultiplier;

        if (bubbleCount > 5000) {
          baseDamage = 200;
          DEATH_DELAY_MS = 3;
          MAX_DEATHS_PER_TICK = 300;
          localSpeedMult = speedMultiplier * 1.3;
        } else if (bubbleCount > 1000) {
          baseDamage = 30;
          DEATH_DELAY_MS = 30;
          MAX_DEATHS_PER_TICK = 60;
          localSpeedMult = speedMultiplier * 0.9;
        } else {
          baseDamage = 10;
          DEATH_DELAY_MS = 60;
          MAX_DEATHS_PER_TICK = 20;
          localSpeedMult = speedMultiplier * 0.8;
        }

        const DAMAGE_COOLDOWN_MS = 40;
        const SAMPLES_PER_BUBBLE = 3;
        const MAX_MOVE_STEP = localSpeedMult;

        const n = countRef.current;
        const idArr = idListRef.current!;
        const xArr = xRef.current!;
        const yArr = yRef.current!;
        const vxArr = vxRef.current!;
        const vyArr = vyRef.current!;
        const rArr = rRef.current!;
        const rTArr = rTargetRef.current!;
        const hArr = healthRef.current!;
        const imgIdxArr = imgIndexRef.current!;

        // animate radius growth per tick
        if (rRef.current && rTargetRef.current) {
          const lerpAlpha = Math.min(1, TICK_MS / GROW_DURATION_MS);
          for (let i = 0; i < n; i++) {
            const curR = rArr[i];
            const tgt = rTArr[i] || getRadiusForCount(n);
            if (curR < tgt) {
              const nextR = curR + (tgt - curR) * lerpAlpha;
              rArr[i] = nextR;
              // when crossing the visible threshold, trigger decode/mask
              if (nextR >= IMAGE_SHOW_RADIUS) {
                const imgIdx = imgIdxArr[i];
                if (imgIdx != null && imgIdx >= 0) {
                  const src = imgSrcsRef.current[imgIdx];
                  if (src) {
                    queueImageDecode(src);
                    enqueueMaskedCreation(src, pickBucketForRadius(Math.round(nextR)));
                  }
                }
              }
            } else if (curR > tgt) {
              rArr[i] = tgt;
            }
          }
        }

        // move normals
        const dims = getArenaDimensions();
        for (let i = 0; i < n; i++) {
          let nx = xArr[i] + vxArr[i] * MAX_MOVE_STEP;
          let ny = yArr[i] + vyArr[i] * MAX_MOVE_STEP;
          let nvx = vxArr[i];
          let nvy = vyArr[i];

          if (nx - rArr[i] <= 0) {
            nx = rArr[i];
            nvx = Math.abs(nvx);
          } else if (nx + rArr[i] >= dims.width) {
            nx = dims.width - rArr[i];
            nvx = -Math.abs(nvx);
          }
          if (ny - rArr[i] <= 0) {
            ny = rArr[i];
            nvy = Math.abs(nvy);
          } else if (ny + rArr[i] >= dims.height) {
            ny = dims.height - rArr[i];
            nvy = -Math.abs(nvy);
          }

          xArr[i] = clamp(nx, rArr[i], dims.width - rArr[i]);
          yArr[i] = clamp(ny, rArr[i], dims.height - rArr[i]);
          vxArr[i] = nvx;
          vyArr[i] = nvy;
        }

        // sampled collisions - normal-normal collisions
        // In normal arena: deal damage and record hits
        // In boss arena: bounce only (no damage), but still record hits for all normals
        if (!startGrace && n > 1) {
          for (let i = 0; i < n; i++) {
            if (hArr[i] <= 0) continue;
            for (let s = 0; s < SAMPLES_PER_BUBBLE; s++) {
              const j = pickRandomIndex(i, n);
              if (j < 0 || j >= n) continue;
              if (hArr[j] <= 0) continue;
              const dx = xArr[i] - xArr[j];
              const dy = yArr[i] - yArr[j];
              const minD2 = (rArr[i] + rArr[j]) * (rArr[i] + rArr[j]);
              if (dx * dx + dy * dy < minD2) {
                const lastA = damageCooldownRef.current[idArr[i]] ?? 0;
                const lastB = damageCooldownRef.current[idArr[j]] ?? 0;
                // separate and bounce
                const separated = separatePair(xArr[i], yArr[i], rArr[i], xArr[j], yArr[j], rArr[j]);
                xArr[i] = separated.ax;
                yArr[i] = separated.ay;
                xArr[j] = separated.bx;
                yArr[j] = separated.by;
                const bounced = bouncePairVel(vxArr[i], vyArr[i], vxArr[j], vyArr[j], xArr[i], yArr[i], xArr[j], yArr[j]);
                vxArr[i] = bounced.avx;
                vyArr[i] = bounced.avy;
                vxArr[j] = bounced.bvx;
                vyArr[j] = bounced.bvy;

                // In normal arena: apply damage to both
                // In boss arena: just record hits (no damage)
                if (arenaType === ARENA_TYPES.NORMAL) {
                  const bonus = Math.round(Math.min(2, (rArr[i] + rArr[j]) / 60));
                  const damage = baseDamage + bonus;

                  if (nowMs - lastA > DAMAGE_COOLDOWN_MS) {
                    hArr[i] = Math.max(0, hArr[i] - damage);
                    damageCooldownRef.current[idArr[i]] = nowMs;
                    try {
                      const rawAttacker = imgSrcsRef.current[imgIdxArr[j]] ?? `player-${idArr[j]}`;
                      const attacker = normalizePlayer(rawAttacker);
                      lastDamagerRef.current[idArr[i]] = attacker;
                      try { recordHit(attacker); } catch (e) {}
                    } catch (e) {}
                  }
                  if (nowMs - lastB > DAMAGE_COOLDOWN_MS) {
                    hArr[j] = Math.max(0, hArr[j] - damage);
                    damageCooldownRef.current[idArr[j]] = nowMs;
                    try {
                      const rawAttacker = imgSrcsRef.current[imgIdxArr[i]] ?? `player-${idArr[i]}`;
                      const attacker = normalizePlayer(rawAttacker);
                      lastDamagerRef.current[idArr[j]] = attacker;
                      try { recordHit(attacker); } catch (e) {}
                    } catch (e) {}
                  }
                } else {
                  // boss arena: record hits for both without damage
                  if (nowMs - lastA > DAMAGE_COOLDOWN_MS) {
                    try {
                      const rawAttacker = imgSrcsRef.current[imgIdxArr[j]] ?? `player-${idArr[j]}`;
                      const attacker = normalizePlayer(rawAttacker);
                      try { recordHit(attacker); } catch (e) {}
                    } catch (e) {}
                    damageCooldownRef.current[idArr[i]] = nowMs;
                  }
                  if (nowMs - lastB > DAMAGE_COOLDOWN_MS) {
                    try {
                      const rawAttacker = imgSrcsRef.current[imgIdxArr[i]] ?? `player-${idArr[i]}`;
                      const attacker = normalizePlayer(rawAttacker);
                      try { recordHit(attacker); } catch (e) {}
                    } catch (e) {}
                    damageCooldownRef.current[idArr[j]] = nowMs;
                  }
                }

                // small outward push to reduce sticking
                const d = Math.sqrt(Math.max(0.0001, dx * dx + dy * dy));
                const nxPush = (dx / d) * 2;
                const nyPush = (dy / d) * 2;
                xArr[i] += nxPush;
                yArr[i] += nyPush;
                xArr[j] -= nxPush;
                yArr[j] -= nyPush;
              }
            }
          }
        }

        // spikes (damage & reposition) - spikes damage normals only
        if (spikeEnabled && spikePositions.length > 0) {
          for (let i = 0; i < n; i++) {
            const s = detectSpikeHit(xArr[i], yArr[i], rArr[i]);
            if (s) {
              hArr[i] = Math.max(hArr[i] - 18, 0);
              if (s.side === "top") {
                yArr[i] = Math.max(yArr[i], s.size + rArr[i] + 2);
                vyArr[i] = Math.abs(vyArr[i]) || 2;
              } else if (s.side === "bottom") {
                yArr[i] = Math.min(yArr[i], dims.height - s.size - rArr[i] - 2);
                vyArr[i] = -Math.abs(vyArr[i]) || -2;
              } else if (s.side === "left") {
                xArr[i] = Math.max(xArr[i], s.size + rArr[i] + 2);
                vxArr[i] = Math.abs(vxArr[i]) || 2;
              } else {
                xArr[i] = Math.min(dims.width - s.size - rArr[i] - 2, xArr[i]);
                vxArr[i] = -Math.abs(vxArr[i]) || -2;
              }
            }
          }
        }

        // dying handling
        for (let i = 0; i < n; i++) {
          if (hArr[i] <= 0 && !(idArr[i] in dyingRef.current)) {
            dyingRef.current[idArr[i]] = nowMs;
          }
        }

        // queue removals
        const toQueueIds: number[] = [];
        for (let i = 0; i < n; i++) {
          if (hArr[i] <= 0) {
            const dyingAt = dyingRef.current[idArr[i]] ?? nowMs;
            if (nowMs - dyingAt >= DEATH_DELAY_MS) {
              toQueueIds.push(idArr[i]);
            }
          }
        }
        for (const idToQ of toQueueIds) {
          if (!deathQueueSetRef.current.has(idToQ)) {
            deathQueueRef.current.push(idToQ);
            deathQueueSetRef.current.add(idToQ);
          }
        }

        let deathsProcessed = 0;
        let targetDeathsPerTick = MAX_DEATHS_PER_TICK;
        if (countRef.current > 5000) {
          targetDeathsPerTick = Math.min(1000, deathQueueRef.current.length);
        }

        while (deathQueueRef.current.length > 0 && deathsProcessed < targetDeathsPerTick) {
          const idToRemove = deathQueueRef.current.shift()!;
          deathQueueSetRef.current.delete(idToRemove);

          let foundIndex = indexOfIdRef.current[idToRemove];
          if (foundIndex === undefined) {
            delete damageCooldownRef.current[idToRemove];
            delete dyingRef.current[idToRemove];
            // ensure we clear any lastDamager leftover
            delete lastDamagerRef.current[idToRemove];
            continue;
          }

          // attribute kill to last damager if present
          try {
            const killer = lastDamagerRef.current[idToRemove];
            if (killer) {
              try { recordKill(killer); } catch (e) {}
            }
          } catch (e) {}
          // clear attribution for removed id
          delete lastDamagerRef.current[idToRemove];

          const currN = countRef.current;
          const idArrLocal = idListRef.current!;
          const lastIdx = currN - 1;
          const xA = xRef.current!;
          const yA = yRef.current!;
          const vxA = vxRef.current!;
          const vyA = vyRef.current!;
          const rA = rRef.current!;
          const rTA = rTargetRef.current!;
          const hA = healthRef.current!;
          const imgA = imgIndexRef.current!;

          if (foundIndex !== lastIdx) {
            const movedId = idArrLocal[lastIdx];
            idArrLocal[foundIndex] = movedId;
            xA[foundIndex] = xA[lastIdx];
            yA[foundIndex] = yA[lastIdx];
            vxA[foundIndex] = vxA[lastIdx];
            vyA[foundIndex] = vyA[lastIdx];
            rA[foundIndex] = rA[lastIdx];
            rTA[foundIndex] = rTA[lastIdx];
            hA[foundIndex] = hA[lastIdx];
            imgA[foundIndex] = imgA[lastIdx];
            indexOfIdRef.current[movedId] = foundIndex;
          }

          delete indexOfIdRef.current[idToRemove];
          countRef.current = lastIdx;

          delete damageCooldownRef.current[idToRemove];
          delete dyingRef.current[idToRemove];
          deathsProcessed++;
        }

        // update radius targets for survivors (animate to new radius)
        const newRadius = getRadiusForCount(countRef.current);
        for (let i = 0; i < countRef.current; i++) {
          rTargetRef.current![i] = newRadius;
        }

        // winners check for normal
        if (arenaType === ARENA_TYPES.NORMAL) {
          if (countRef.current <= 1) {
            setIsRunning(false);
            if (countRef.current === 1) {
              const i = 0;
              const winnerBubbleData: BubbleData = {
                x: xRef.current![i],
                y: yRef.current![i],
                radius: rRef.current![i],
                health: healthRef.current![i],
                imgSrc: imgSrcsRef.current[imgIndexRef.current![i]] ?? "",
                vx: vxRef.current![i],
                vy: vyRef.current![i],
                id: idListRef.current![i],
              };
              setWinner(winnerBubbleData);
            }
          }
        }

        // boss logic
        if (arenaType === ARENA_TYPES.BOSS) {
          // normal-normal collisions: separate & bounce, but DO NOT damage normals
          for (let i = 0; i < countRef.current; i++) {
            for (let j = i + 1; j < countRef.current; j++) {
              const A = { x: xArr[i], y: yArr[i], r: rArr[i] };
              const B = { x: xArr[j], y: yArr[j], r: rArr[j] };
              const minD2 = (A.r + B.r) * (A.r + B.r);
              if (dist2(A, B) < minD2) {
                const sep = separatePair(A.x, A.y, A.r, B.x, B.y, B.r);
                xArr[i] = sep.ax;
                yArr[i] = sep.ay;
                xArr[j] = sep.bx;
                yArr[j] = sep.by;
                const bounced = bouncePairVel(vxArr[i], vyArr[i], vxArr[j], vyArr[j], xArr[i], yArr[i], xArr[j], yArr[j]);
                vxArr[i] = bounced.avx;
                vyArr[i] = bounced.avy;
                vxArr[j] = bounced.bvx;
                vyArr[j] = bounced.bvy;
                // no health change here for normal-normal in boss mode
              }
            }
          }

          // superbubble movement + collisions
          if (superBubbleRef.current) {
            // move superbubble using the same max step multiplier so speed is consistent
            let sb = superBubbleRef.current;
            sb.x += sb.vx * MAX_MOVE_STEP;
            sb.y += sb.vy * MAX_MOVE_STEP;
            // bounce superbubble on walls
            if (sb.x - sb.radius <= 0) {
              sb.x = sb.radius;
              sb.vx = Math.abs(sb.vx);
            } else if (sb.x + sb.radius >= dims.width) {
              sb.x = dims.width - sb.radius;
              sb.vx = -Math.abs(sb.vx);
            }
            if (sb.y - sb.radius <= 0) {
              sb.y = sb.radius;
              sb.vy = Math.abs(sb.vy);
            } else if (sb.y + sb.radius >= dims.height) {
              sb.y = dims.height - sb.radius;
              sb.vy = -Math.abs(sb.vy);
            }

            let hits = 0;
            for (let i = 0; i < countRef.current; i++) {
              const n = { x: xArr[i], y: yArr[i], r: rArr[i] };
              const minD2 = (n.r + sb.radius) * (n.r + sb.radius);
              if (dist2(n, sb) < minD2) {
                // symmetric separation (move both bodies out of overlap)
                const sep = separatePair(n.x, n.y, n.r, sb.x, sb.y, sb.radius);
                // apply both sides
                xArr[i] = sep.ax;
                yArr[i] = sep.ay;
                sb.x = sep.bx;
                sb.y = sep.by;

                // bounce velocities for both using helper
                const bounced = bouncePairVel(vxArr[i], vyArr[i], sb.vx, sb.vy, xArr[i], yArr[i], sb.x, sb.y);
                vxArr[i] = bounced.avx;
                vyArr[i] = bounced.avy;
                sb.vx = bounced.bvx;
                sb.vy = bounced.bvy;

                // small outward push for visual separation (applies to normal)
                const dx = n.x - sb.x;
                const dy = n.y - sb.y;
                const d = Math.sqrt(dx * dx + dy * dy) || 0.0001;
                xArr[i] += (dx / d) * 2;
                yArr[i] += (dy / d) * 2;

                // per-normal cooldown to avoid multi-tick rapid damage
                const lastHit = sbCollisionCooldownRef.current[idArr[i]] ?? 0;
                if (nowMs - lastHit > SB_COLLISION_COOLDOWN_MS) {
                  // normal takes damage from superbubble contact
                  hArr[i] = Math.max(0, hArr[i] - Math.max(10, Math.round(hArr[i] * 0.06)));
                  sbCollisionCooldownRef.current[idArr[i]] = nowMs;
                  try {
                    const rawAttacker = superBubbleRef.current?.imgSrc ?? "superbubble";
                    // prefix superbubble key with "superbubble-" to make it recognizable on server
                    const attacker = "superbubble-" + normalizePlayer(rawAttacker);
                    lastDamagerRef.current[idArr[i]] = attacker;
                    try { recordHit(attacker); } catch (e) {}
                  } catch (e) {}
                  hits++;
                }
              }
            }
            if (hits > 0) {
              let newH = sb.health;
              for (let k = 0; k < hits; k++) {
                newH = Math.max(0, Math.floor(newH - newH * 0.12));
              }
              superBubbleRef.current.health = newH;
            }
          }

          // spikes damage normals only (handled above for normals)
          // projectiles movement + hit handled by projectiles effect below
          const aliveNormals = [];
          for (let i = 0; i < countRef.current; i++) {
            if (hArr[i] > 0) aliveNormals.push(i);
          }
          if (superBubbleRef.current && superBubbleRef.current.health <= 0) {
            setIsRunning(false);
            const snapNormals: BubbleData[] = [];
            for (const idx of aliveNormals) {
              snapNormals.push({
                x: xArr[idx],
                y: yArr[idx],
                radius: rArr[idx],
                health: hArr[idx],
                imgSrc: imgSrcsRef.current[imgIdxArr[idx]] ?? "",
                vx: vxArr[idx],
                vy: vyArr[idx],
                id: idArr[idx],
              });
            }
            setUiBubblesSnapshot(snapNormals);
            setProjectiles((p) => p);
            // Team wins - record "team" as winner
            setWinner({
              x: 0,
              y: 0,
              radius: 0,
              health: 100,
              imgSrc: "team",
              vx: 0,
              vy: 0,
              id: -1,
            });
            setWinnersList(snapNormals);
            const allBossImgs = (imageListRef.current || []).map((imgName) => `http://localhost:5000/bossimgs/${imgName}`);
            setWinnersImages(allBossImgs.length > 0 ? allBossImgs : null);
            superBubbleRef.current = null;
            return;
          }
          if (aliveNormals.length === 0 && superBubbleRef.current) {
            setIsRunning(false);
            setBubblesFromArraysToUi([]);
            setProjectiles([]);
            setSuperBubbleSnapshot({
              x: superBubbleRef.current.x,
              y: superBubbleRef.current.y,
              radius: superBubbleRef.current.radius,
              health: Math.round(superBubbleRef.current.health),
              imgSrc: superBubbleRef.current.imgSrc,
              vx: superBubbleRef.current.vx,
              vy: superBubbleRef.current.vy,
              id: superBubbleRef.current.id,
            });
            // Superbubble wins - record "superbubble" as winner
            setWinner({
              x: superBubbleRef.current.x,
              y: superBubbleRef.current.y,
              radius: superBubbleRef.current.radius,
              health: Math.round(superBubbleRef.current.health),
              imgSrc: "superbubble",
              vx: superBubbleRef.current.vx,
              vy: superBubbleRef.current.vy,
              id: superBubbleRef.current.id,
            });
            setWinnersList(null);
            setWinnersImages(null);
            return;
          }
        } // end boss logic

        updateUiSnapshotFromArrays();
      } // end logic ticks

      // render pass
      processImageDecodeQueue();
      processMaskCreationQueue(8);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // NO canvas spikes to avoid duplication (SVG DOM renders them)

      // draw bubbles
      const nRender = countRef.current;
      const rArrRender = rRef.current!;
      const xArrRender = xRef.current!;
      const yArrRender = yRef.current!;
      const hArrRender = healthRef.current!;
      const imgIdxArrRender = imgIndexRef.current!;

      for (let i = 0; i < nRender; i++) {
        const radius = rArrRender[i];
        let x = xArrRender[i];
        let y = yArrRender[i];
        const hp = hArrRender[i];
        const imgIdx = imgIdxArrRender[i];
        let strokeColor = "#ff4d4d";
        if (hp > 60) strokeColor = "#2ecc71";
        else if (hp > 30) strokeColor = "#f1c40f";

        // clamp again to ensure no overflow drawing
        const dims = getArenaDimensions();
        x = clamp(x, radius, dims.width - radius);
        y = clamp(y, radius, dims.height - radius);

        let drawnImage = false;
        if (radius >= IMAGE_SHOW_RADIUS && imgIdx >= 0) {
          const src = imgSrcsRef.current[imgIdx];
          const bucket = pickBucketForRadius(radius);
          const key = maskedKey(src, bucket);
          const maskedBmp = maskedBitmapCacheRef.current.get(key);
          if (maskedBmp) {
            touchMaskedKey(key);
            ctx.drawImage(maskedBmp, x - radius, y - radius, radius * 2, radius * 2);
            drawnImage = true;
          } else {
            const bitmap = imageBitmapCache.current.get(src);
            const img = textureCache.current.get(src);
            if (bitmap || (img && img.complete)) {
              enqueueMaskedCreation(src, bucket);
              // clipped draw to avoid square flash
              try {
                ctx.save();
                ctx.beginPath();
                ctx.arc(x, y, radius, 0, Math.PI * 2);
                ctx.clip();
                if (bitmap) ctx.drawImage(bitmap, x - radius, y - radius, radius * 2, radius * 2);
                else if (img) ctx.drawImage(img, x - radius, y - radius, radius * 2, radius * 2);
                ctx.restore();
                drawnImage = true;
              } catch (e) {
                try {
                  ctx.restore();
                } catch {}
              }
            } else {
              const shouldDecodeNow = radius >= IMAGE_SHOW_RADIUS || revealStartedRef.current === true;
              if (src && shouldDecodeNow) {
                queueImageDecode(src);
                preloadImage(src).catch(() => {});
              }
            }
          }
        }

        if (drawnImage) {
          if (radius >= 8) {
            ctx.beginPath();
            ctx.arc(x, y, radius + 2, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * (hp / 100)));
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = 4;
            ctx.stroke();
          }
          continue;
        }

        // fallback circle
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1, radius), 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
        ctx.globalAlpha = 0.95;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1, radius) + 2, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * (hp / 100)));
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // superbubble draw (if present)
      if (superBubbleRef.current) {
        const sb = superBubbleRef.current;
        let drawn = false;
        if (sb.radius >= IMAGE_SHOW_RADIUS && sb.imgSrc) {
          const src = sb.imgSrc;
          const bucket = pickBucketForRadius(sb.radius);
          const key = maskedKey(src, bucket);
          const maskedBmp = maskedBitmapCacheRef.current.get(key);
          if (maskedBmp) {
            ctx.drawImage(maskedBmp, sb.x - sb.radius, sb.y - sb.radius, sb.radius * 2, sb.radius * 2);
            drawn = true;
          } else {
            const bitmap = imageBitmapCache.current.get(src);
            const img = textureCache.current.get(src);
            if (bitmap || (img && img.complete)) {
              enqueueMaskedCreation(src, bucket);
              try {
                ctx.save();
                ctx.beginPath();
                ctx.arc(sb.x, sb.y, sb.radius, 0, Math.PI * 2);
                ctx.clip();
                if (bitmap) ctx.drawImage(bitmap, sb.x - sb.radius, sb.y - sb.radius, sb.radius * 2, sb.radius * 2);
                else if (img) ctx.drawImage(img, sb.x - sb.radius, sb.y - sb.radius, sb.radius * 2, sb.radius * 2);
                ctx.restore();
                drawn = true;
              } catch (e) {
                try {
                  ctx.restore();
                } catch {}
              }
            } else {
              if (sb.imgSrc) preloadImage(sb.imgSrc).catch(() => {});
            }
          }
        }

        if (!drawn) {
          ctx.beginPath();
          ctx.arc(sb.x, sb.y, sb.radius, 0, Math.PI * 2);
          ctx.fillStyle = "#fff";
          ctx.fill();
        }

        // superbubble health bar above
        ctx.fillStyle = "#444";
        ctx.fillRect(sb.x - sb.radius, sb.y - sb.radius - 18, sb.radius * 2, 8);
        ctx.fillStyle = "#e74c3c";
        const pct = Math.max(0, Math.min(1, sb.health / SUPER_BUBBLE_HEALTH));
        ctx.fillRect(sb.x - sb.radius, sb.y - sb.radius - 18, sb.radius * 2 * pct, 8);
      }
    }; // end loop

    rafId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(graceTimeout);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arenaType, isRunning, spikeEnabled, spikeCount, spikeSize, speedMultiplier]);

  // ---------- projectiles handling ----------

  useEffect(() => {
    if (!isRunning || arenaType !== ARENA_TYPES.BOSS) return;
    const interval = window.setInterval(() => {
      const arena = getArenaDimensions();
      const nextProjectiles: Projectile[] = [];
      const projSnapshot = projectiles.slice();
      const n = countRef.current;
      const idArr = idListRef.current!;
      const xArr = xRef.current!;
      const yArr = yRef.current!;
      const rArr = rRef.current!;
      const hArr = healthRef.current!;
      for (const p of projSnapshot) {
        const nx = p.x + p.vx;
        const ny = p.y + p.vy;
        if (nx < 0 || ny < 0 || nx > arena.width || ny > arena.height) continue;
        let hit = false;
        for (let i = 0; i < n; i++) {
          const dx = xArr[i] - nx;
          const dy = yArr[i] - ny;
          if (dx * dx + dy * dy < rArr[i] * rArr[i]) {
            const power = SUPER_BUBBLE_TYPES[p.type];
            hArr[i] = Math.max(0, hArr[i] - power.damage);
            try {
              const rawAttacker = superBubbleRef.current?.imgSrc ?? "superbubble";
              const attacker = normalizePlayer(rawAttacker);
              lastDamagerRef.current[idArr[i]] = attacker;
              try { recordHit(attacker); } catch (e) {}
            } catch (e) {}
            hit = true;
            const hitId = Date.now() + Math.floor(Math.random() * 10000);
            setHitEffects((h) => [...h, { id: hitId, x: xArr[i], y: yArr[i], createdAt: Date.now() }]);
            setTimeout(() => {
              setHitEffects((h) => h.filter((he) => he.id !== hitId));
            }, 300);
            break;
          }
        }
        if (!hit) {
          nextProjectiles.push({ ...p, x: nx, y: ny });
        }
      }
      setProjectiles(nextProjectiles);
      updateUiSnapshotFromArrays();
    }, 50);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning, arenaType, projectiles]);

  // Flush buffered stats shortly after a match ends so server receives final tallies
  useEffect(() => {
    if (isRunning) return;
    const t = window.setTimeout(() => {
      try {
        if (statsClient && typeof (statsClient as any).flush === "function") {
          void (statsClient as any).flush();
        }
      } catch (e) {}
    }, 250);
    return () => clearTimeout(t);
  }, [isRunning]);
  // also clear current game when match ends (in case there was no winner effect)
  useEffect(() => {
    if (isRunning) return;
    // if there is a winner pending, don't clear here — winner effect will flush and clear
    if (winner) return;
    (async () => {
      try {
        // Flush any remaining stats with game/arena context before clearing
        if (statsClient && typeof (statsClient as any).flush === 'function') {
          try { await (statsClient as any).flush(); } catch (e) {}
        }
        // Give flush time to complete before clearing context
        await new Promise(r => setTimeout(r, 100));
      } catch (e) {}
      try {
        if (statsClient && typeof (statsClient as any).setGame === "function") {
          (statsClient as any).setGame(null, null);
        }
      } catch (e) {}
      currentGameRef.current = null;
    })();
  }, [isRunning, winner]);

  // When a winner is set, post the winner for the current game and clear the game id
  useEffect(() => {
    if (!winner) return;
    const gid = currentGameRef.current;
    if (!gid) return;
    (async () => {
      try {
        // Flush all pending stats with game/arena context FIRST
        try { if (statsClient && typeof (statsClient as any).flush === 'function') await (statsClient as any).flush(); } catch (e) {}
        // Wait a bit for flush to complete
        await new Promise(r => setTimeout(r, 100));
        
        // Use imgSrc directly for team/superbubble, or normalize player name
        let player = winner.imgSrc;
        if (player !== "team" && player !== "superbubble") {
          player = normalizePlayer(player) || `player-${winner.id}`;
        }
        await fetch('http://localhost:5000/api/stats/winner', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ game: gid, player, arena: arenaType || ARENA_TYPES.NORMAL }),
        });
      } catch (e) {
        console.warn('Failed to post winner', e);
      } finally {
        // NOW clear the game context after all stats have been sent
        try { statsClient && typeof (statsClient as any).setGame === 'function' && (statsClient as any).setGame(null, null); } catch (e) {}
        currentGameRef.current = null;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [winner]);

  // ---------- setters utilities ----------

  const setBubblesFromArraysToUi = (arr: BubbleData[]) => {
    imgSrcsRef.current = [];
    textureCache.current.clear();
    countRef.current = 0;
    ensureCapacity(arr.length + 8);
    const idArr = idListRef.current!;
    const xArr = xRef.current!;
    const yArr = yRef.current!;
    const vxArr = vxRef.current!;
    const vyArr = vyRef.current!;
    const rArr = rRef.current!;
    const rTArr = rTargetRef.current!;
    const hArr = healthRef.current!;
    const imgIdxArr = imgIndexRef.current!;
    for (let i = 0; i < arr.length; i++) {
      const b = arr[i];
      idArr[i] = b.id;
      indexOfIdRef.current[b.id] = i;
      xArr[i] = b.x;
      yArr[i] = b.y;
      vxArr[i] = b.vx;
      vyArr[i] = b.vy;
      // start small; animate to target
      rTArr[i] = b.radius;
      rArr[i] = INITIAL_RADIUS;
      hArr[i] = b.health;
      imgIdxArr[i] = b.imgSrc ? getImgIndex(b.imgSrc) : -1;
      if (b.imgSrc) preloadImage(b.imgSrc).catch(() => {});
    }
    countRef.current = arr.length;
    updateUiSnapshotFromArrays(true);
    startRevealPipelineIfNeeded();
  };

  // ---------- UI original behaviours ----------

  const resetArenaKeepType = () => {
    setIsRunning(false);
    setWinner(null);
    setWinnersList(null);
    setWinnersImages(null);
    countRef.current = 0;
    idListRef.current = null;
    xRef.current = null;
    yRef.current = null;
    vxRef.current = null;
    vyRef.current = null;
    rRef.current = null;
    rTargetRef.current = null;
    healthRef.current = null;
    imgIndexRef.current = null;
    imgSrcsRef.current = [];
    textureCache.current.clear();
    imageBitmapCache.current.clear();
    imagesToDecodeRef.current.clear();
    imagesDecodingRef.current.clear();
    damageCooldownRef.current = {};
    sbCollisionCooldownRef.current = {}; // clear sb cooldowns
    dyingRef.current = {};
    deathQueueRef.current = [];
    deathQueueSetRef.current.clear();
    indexOfIdRef.current = {};
    setUiBubblesSnapshot([]);
    setSuperBubbleSnapshot(null);
    superBubbleRef.current = null;
    setProjectiles([]);
    setMuzzleFlashes([]);
    setHitEffects([]);
    setActiveCount(0);

    maskedBitmapCacheRef.current.forEach((bmp) => {
      try {
        (bmp as any).close && (bmp as any).close();
      } catch (e) {}
    });
    maskedBitmapCacheRef.current.clear();
    maskedLruRef.current = [];
    maskedPixelBytesRef.current = 0;
    maskedCreateQueueRef.current = [];
    maskedCreatingSetRef.current.clear();
    revealStartedRef.current = false;

    // re-initialize typed arrays immediately so UI code doesn't crash
    const cap = MAX_CAPACITY.current;
    idListRef.current = new Int32Array(cap);
    xRef.current = new Float32Array(cap);
    yRef.current = new Float32Array(cap);
    vxRef.current = new Float32Array(cap);
    vyRef.current = new Float32Array(cap);
    rRef.current = new Float32Array(cap);
    rTargetRef.current = new Float32Array(cap);
    healthRef.current = new Float32Array(cap);
    imgIndexRef.current = new Int32Array(cap);
    for (let i = 0; i < cap; i++) {
      imgIndexRef.current[i] = -1;
      rRef.current[i] = INITIAL_RADIUS;
      rTargetRef.current[i] = INITIAL_RADIUS;
    }
  };

  const resetArenaKeepTypePublic = () => {
    resetArenaKeepType();
    setTimeout(() => {
      setWinner(null);
      setIsRunning(false);
      setWinnersList(null);
      setWinnersImages(null);
    }, 0);
  };

  const handleBack = () => {
    resetArenaKeepType();
    setArenaType(null);
  };

  // ---------- Superpower helpers ----------

  const pickRandomSelectedPower = (): keyof typeof SUPER_BUBBLE_TYPES => {
    const keys = Object.keys(SUPER_BUBBLE_TYPES) as (keyof typeof SUPER_BUBBLE_TYPES)[];
    const available = keys.filter((k) => selectedPowers[k]);
    if (available.length === 0) return "flame";
    return available[Math.floor(Math.random() * available.length)];
  };

  const COMPASS = [
    { name: "E", vx: 1, vy: 0 },
    { name: "W", vx: -1, vy: 0 },
    { name: "N", vx: 0, vy: -1 },
    { name: "S", vx: 0, vy: 1 },
    { name: "NE", vx: 0.70710678, vy: -0.70710678 },
    { name: "NW", vx: -0.70710678, vy: -0.70710678 },
    { name: "SE", vx: 0.70710678, vy: 0.70710678 },
    { name: "SW", vx: -0.70710678, vy: 0.70710678 },
  ];

  const pickRandomDirection = () => COMPASS[Math.floor(Math.random() * COMPASS.length)];

  const handleShoot = (forcedDirection?: { vx: number; vy: number }) => {
    if (!superBubbleRef.current || arenaType !== ARENA_TYPES.BOSS || !isRunning || !superpowerEnabled) return;
    const sb = superBubbleRef.current;
    const dir = forcedDirection ?? pickRandomDirection();
    const powerKey = pickRandomSelectedPower();
    const vx = dir.vx * projectileSpeedPerTick;
    const vy = dir.vy * projectileSpeedPerTick;
    nextProjectileId++;
    const id = nextProjectileId;
    setProjectiles((p) => [...p, { id, x: sb.x, y: sb.y, vx, vy, type: powerKey }]);
    const mfId = Date.now() + Math.floor(Math.random() * 10000);
    setMuzzleFlashes((m) => [...m, { id: mfId, x: sb.x, y: sb.y, createdAt: Date.now() }]);
    setTimeout(() => {
      setMuzzleFlashes((m) => m.filter((mm) => mm.id !== mfId));
    }, 220);
  };

  useEffect(() => {
    return () => {
      if (autoFireRef.current) {
        window.clearInterval(autoFireRef.current);
        autoFireRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (autoFireRef.current) {
      window.clearInterval(autoFireRef.current);
      autoFireRef.current = null;
    }
    if (arenaType === ARENA_TYPES.BOSS && isRunning && superpowerEnabled && firingMode === "auto") {
      const id = window.setInterval(() => {
        const dir = pickRandomDirection();
        handleShoot(dir);
      }, 3000);
      autoFireRef.current = id as unknown as number;
      return () => {
        if (autoFireRef.current) {
          window.clearInterval(autoFireRef.current);
          autoFireRef.current = null;
        }
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arenaType, isRunning, superpowerEnabled, firingMode, selectedPowers, projectileSpeedPerTick]);

  // ---------- Projectiles DOM rendering & muzzle/hit (unchanged) ----------

  const renderProjectileVisual = (p: Projectile) => {
    const angleDeg = Math.atan2(p.vy, p.vx) * (180 / Math.PI);
    const baseStyle: React.CSSProperties = {
      position: "absolute",
      left: p.x,
      top: p.y,
      transform: `translate(-50%,-50%) rotate(${angleDeg}deg)`,
      zIndex: 1200,
      pointerEvents: "none",
    };
    if (p.type === "flame") {
      return (
        <svg key={p.id} width={36} height={48} style={baseStyle} viewBox="0 0 36 48" preserveAspectRatio="xMidYMid meet">
          <defs>
            <radialGradient id={`fg${p.id}`} cx="50%" cy="30%" r="60%">
              <stop offset="0%" stopColor="#fff59d" />
              <stop offset="30%" stopColor="#ffb74d" />
              <stop offset="70%" stopColor="#ff7043" />
              <stop offset="100%" stopColor="#b71c1c" />
            </radialGradient>
            <filter id={`fblur${p.id}`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="0.6" />
            </filter>
          </defs>

          <path d="M18 46 C20 36, 30 30, 30 22 C30 14, 22 12, 18 6 C14 12, 6 14, 6 22 C6 30, 14 36, 18 46 Z" fill={`url(#fg${p.id})`} opacity={0.18} transform="translate(0,-2)" style={{ filter: `url(#fblur${p.id})` }} />
          <path d="M18 40 C20 32, 26 28, 26 22 C26 16, 20 14, 18 10 C16 14, 10 16, 10 22 C10 28, 16 32, 18 40 Z" fill={`url(#fg${p.id})`} stroke="rgba(0,0,0,0.08)" strokeWidth={0.4} />
          <path d="M18 30 C19 26, 22 24, 22 20 C22 16, 19 15, 18 12 C17 15, 14 16, 14 20 C14 24, 17 26, 18 30 Z" fill="#fff8e0" opacity={0.9} />
        </svg>
      );
    } else if (p.type === "arrow") {
      const arrowStyle: React.CSSProperties = { ...baseStyle, transition: "transform 120ms linear" };
      return (
        <svg key={p.id} width={52} height={12} style={arrowStyle} viewBox="0 0 52 12" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id={`arrowGrad${p.id}`} x1="0" x2="1">
              <stop offset="0%" stopColor="#6b4f3b" />
              <stop offset="100%" stopColor="#3b2b1f" />
            </linearGradient>
          </defs>
          <rect x="0" y="5" width="36" height="2" rx="1" fill={`url(#arrowGrad${p.id})`} />
          <polygon points="36,0 52,6 36,12" fill="#222" stroke="#111" strokeWidth="0.5" />
          <g transform="translate(8,0)">
            <polygon points="0,2 4,6 0,10" fill="#8b6a4a" opacity={0.95} />
            <polygon points="-4,2 0,6 -4,10" fill="#6b4f3b" opacity={0.9} />
          </g>
        </svg>
      );
    } else {
      const bulletStyle: React.CSSProperties = { ...baseStyle, transition: "transform 80ms linear" };
      return (
        <svg key={p.id} width={36} height={12} style={bulletStyle} viewBox="0 0 36 12" preserveAspectRatio="xMidYMid meet">
          <rect x="0" y="2" width="22" height="8" rx="4" fill="#ffd54f" stroke="#e0a800" strokeWidth={0.6} />
          <polygon points="22,0 36,6 22,12" fill="#ddd" stroke="#c6c6c6" strokeWidth={0.4} />
          <rect x="3" y="3" width="10" height="2" rx="1" fill="rgba(255,255,255,0.6)" />
        </svg>
      );
    }
  };

  const renderAllProjectiles = () => projectiles.map((p) => renderProjectileVisual(p));

  const renderMuzzleFlashes = () =>
    muzzleFlashes.map((m) => (
      <div
        key={`muzzle-${m.id}`}
        style={{
          position: "absolute",
          left: m.x,
          top: m.y,
          transform: "translate(-50%,-50%)",
          width: 56,
          height: 56,
          borderRadius: "50%",
          pointerEvents: "none",
          zIndex: 1400,
          background: "radial-gradient(circle at 40% 30%, rgba(255,240,180,0.9) 0%, rgba(255,140,60,0.6) 30%, rgba(255,80,0,0.25) 60%, rgba(0,0,0,0) 100%)",
          boxShadow: "0 0 10px rgba(255,160,50,0.6)",
          animation: "muzzleFlashPulse 220ms ease-out forwards",
        }}
      />
    ));

  const renderHitEffects = () =>
    hitEffects.map((h) => (
      <div
        key={`hit-${h.id}`}
        style={{
          position: "absolute",
          left: h.x,
          top: h.y,
          transform: "translate(-50%,-50%)",
          width: 34,
          height: 34,
          borderRadius: 8,
          pointerEvents: "none",
          zIndex: 1400,
          background: "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.9) 0%, rgba(255,200,60,0.9) 30%, rgba(255,80,0,0.6) 60%, rgba(0,0,0,0) 100%)",
          mixBlendMode: "screen",
          animation: "hitPop 280ms ease-out forwards",
        }}
      />
    ));

  // ---------- Leaderboard rendering (no images, no numbering) ----------

  const MAX_LEADER_ENTRIES = 6; // reduced to avoid scrollbar and overflow

  const renderLeaderboardNormal = () => {
    const top = [...uiBubblesSnapshot].sort((a, b) => b.health - a.health).slice(0, MAX_LEADER_ENTRIES);
    const aliveCount = activeCount ?? uiBubblesSnapshot.length;
    return (
      <div style={{ width: "100%", padding: 8, boxSizing: "border-box" }} ref={leaderboardRef}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <div style={{ fontSize: 16 }}>🏆</div>
          <h3 style={{ margin: 0, color: "#ddd", fontSize: 15 }}>Leaderboard</h3>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {top.map((entry) => {
            const fullName = entry.imgSrc.split("/").pop() ?? `#${entry.id}`;
            return (
              <div key={entry.id} style={{ display: "flex", gap: 10, alignItems: "center", boxSizing: "border-box", paddingRight: 6 }}>
                <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <div title={fullName} style={{ color: "#fff", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 120 }}>
                    {fullName}
                  </div>
                  <div style={{ color: entry.health > 60 ? "green" : entry.health > 30 ? "yellow" : "red", fontSize: 11 }}>{Math.round(entry.health)} hp</div>
                </div>
              </div>
            );
          })}
          {Array.from({ length: Math.max(0, MAX_LEADER_ENTRIES - top.length) }).map((_, idx) => (
            <div key={`empty-${idx}`} style={{ display: "flex", gap: 8, alignItems: "center", opacity: 0.35 }}>
              <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <div style={{ color: "#777", fontSize: 12 }}>—</div>
                <div style={{ color: "#666", fontSize: 11 }}>—</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 8, paddingTop: 6, borderTop: "1px solid rgba(255,255,255,0.04)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ color: "#bbb", fontSize: 13 }}>Active bubbles</div>
          <div style={{ fontWeight: 700, color: "#fff", fontSize: 14 }}>{aliveCount}</div>
        </div>
      </div>
    );
  };

  const renderBossVersusCard = () => {
    const leftNormals = uiBubblesSnapshot.slice(0, 6);
    const sbPct = superBubbleSnapshot ? Math.max(0, Math.round((superBubbleSnapshot.health / SUPER_BUBBLE_HEALTH) * 100)) : 0;
    const aliveCount = (activeCount ?? uiBubblesSnapshot.length) + (superBubbleSnapshot ? 1 : 0);
    return (
      <div style={{ width: "100%", padding: 8 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {leftNormals.map((n) => (
            <div key={n.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ color: "#fff", fontSize: 13 }}>{n.imgSrc.split("/").pop()}</div>
                <div style={{ color: n.health > 60 ? "green" : n.health > 30 ? "yellow" : "red", fontSize: 12 }}>{Math.round(n.health)} hp</div>
              </div>
            </div>
          ))}
          <div style={{ width: "100%", textAlign: "center", marginTop: 6, marginBottom: 6 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#fff" }}>VS</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ color: "#fff", fontSize: 13 }}>Super Bubble</div>
              <div style={{ color: sbPct > 60 ? "green" : sbPct > 30 ? "yellow" : "red", fontSize: 12 }}>{sbPct}hp</div>
            </div>
          </div>
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.04)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ color: "#bbb", fontSize: 13 }}>Active entities</div>
            <div style={{ fontWeight: 700, color: "#fff", fontSize: 14 }}>{aliveCount}</div>
          </div>
        </div>
      </div>
    );
  };

  const WinnerOverlay: React.FC<{ winnerBubble?: BubbleData; winners?: BubbleData[]; winnersImgs?: string[] }> = ({ winnerBubble, winners, winnersImgs }) => {
    if (winnersImgs && winnersImgs.length > 0) {
      return (
        <div className="winner-modal" style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, pointerEvents: "auto" }}>
          <div
            onClick={() => {
              resetArenaKeepType();
              setArenaType(null);
              setWinner(null);
              setWinnersList(null);
              setWinnersImages(null);
            }}
            style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)" }}
          />
          <div style={{ position: "relative", zIndex: 10000, display: "flex", flexDirection: "column", alignItems: "center", gap: 12, animation: "winnerPop 700ms ease both", color: "#fff" }}>
            <h2 style={{ margin: 0 }}>Normals Win!</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(80px, 1fr))", gap: 12, width: "80vw", maxWidth: 600 }}>
              {winnersImgs.map((src, idx) => (
                <div key={`winimg-${idx}`} style={{ display: "flex", flexDirection: "column", alignItems: "center", background: "rgba(255,255,255,0.03)", padding: 8, borderRadius: 8 }}>
                  <img src={src} alt={`win-${idx}`} style={{ width: 64, height: 64, borderRadius: 8, objectFit: "cover" }} />
                </div>
              ))}
            </div>
            <div style={{ color: "#aaa", fontSize: 13 }}>Click anywhere to continue</div>
          </div>
        </div>
      );
    }
    if (winners && winners.length > 0) {
      return (
        <div className="winner-modal" style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, pointerEvents: "auto" }}>
          <div
            onClick={() => {
              resetArenaKeepType();
              setArenaType(null);
              setWinner(null);
              setWinnersList(null);
              setWinnersImages(null);
            }}
            style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)" }}
          />
          <div style={{ position: "relative", zIndex: 10000, display: "flex", flexDirection: "column", alignItems: "center", gap: 12, animation: "winnerPop 700ms ease both", color: "#fff" }}>
            <h2 style={{ margin: 0 }}>Normals Win!</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(80px, 1fr))", gap: 12, width: "80vw", maxWidth: 600 }}>
              {winners.map((w) => (
                <div key={w.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", background: "rgba(255,255,255,0.03)", padding: 8, borderRadius: 8 }}>
                  <div style={{ width: 64, height: 64, borderRadius: 8, background: "rgba(255,255,255,0.03)" }} />
                  <div style={{ marginTop: 6, color: w.health > 60 ? "green" : w.health > 30 ? "yellow" : "red" }}>{Math.round(w.health)} hp</div>
                </div>
              ))}
            </div>
            <div style={{ color: "#aaa", fontSize: 13 }}>Click anywhere to continue</div>
          </div>
        </div>
      );
    }
    if (!winnerBubble) return null;
    const displayHealth = winnerBubble === superBubbleSnapshot ? Math.round((winnerBubble.health / SUPER_BUBBLE_HEALTH) * 100) : Math.round(winnerBubble.health);
    return (
      <div className="winner-modal" style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, pointerEvents: "auto" }}>
        <div
          onClick={() => {
            resetArenaKeepType();
            setArenaType(null);
            setWinner(null);
            setWinnersList(null);
            setWinnersImages(null);
          }}
          style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)" }}
        />
        <div style={{ position: "relative", zIndex: 10000, display: "flex", flexDirection: "column", alignItems: "center", gap: 12, animation: "winnerPop 700ms ease both" }}>
          <h2 style={{ color: "#fff", margin: 0, transform: "translateY(-20px)" }}>{winnerBubble === superBubbleSnapshot ? "Super Bubble Wins!" : "Winner!"}</h2>
          <div style={{ width: winnerBubble.radius * 4, height: winnerBubble.radius * 4, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", transformOrigin: "center", animation: "bubbleZoom 700ms ease both", boxShadow: "0 8px 40px rgba(0,0,0,0.6)", background: "rgba(0,0,0,0.2)" }}>
            <img src={winnerBubble.imgSrc} alt="winner" style={{ width: "86%", height: "86%", borderRadius: "50%", objectFit: "cover" }} />
          </div>
          <div style={{ color: "#fff" }}>{displayHealth} hp</div>
          <div style={{ color: "#aaa", fontSize: 13 }}>Click anywhere to continue</div>
        </div>
        <style>{`@keyframes bubbleZoom { 0% { transform: scale(0.4) translateY(40px); opacity: 0; } 60% { transform: scale(1.08) translateY(-6px); opacity: 1; } 100% { transform: scale(1) translateY(0); opacity: 1; } } @keyframes winnerPop { 0% { opacity: 0; transform: translateY(20px); } 100% { opacity: 1; transform: translateY(0); } @keyframes muzzleFlashPulse { 0% { transform: translate(-50%,-50%) scale(0.6); opacity: 1; } 80% { transform: translate(-50%,-50%) scale(1.05); opacity: 0.65; } 100% { transform: translate(-50%,-50%) scale(1.2); opacity: 0; } } @keyframes hitPop { 0% { transform: translate(-50%,-50%) scale(0.6); opacity: 1; } 100% { transform: translate(-50%,-50%) scale(1.5); opacity: 0; } }`}</style>
      </div>
    );
  };

  // ---------- Initial typed arrays ----------

  useEffect(() => {
    const cap = MAX_CAPACITY.current;
    idListRef.current = new Int32Array(cap);
    xRef.current = new Float32Array(cap);
    yRef.current = new Float32Array(cap);
    vxRef.current = new Float32Array(cap);
    vyRef.current = new Float32Array(cap);
    rRef.current = new Float32Array(cap);
    rTargetRef.current = new Float32Array(cap);
    healthRef.current = new Float32Array(cap);
    imgIndexRef.current = new Int32Array(cap);
    for (let i = 0; i < cap; i++) {
      imgIndexRef.current[i] = -1;
      rRef.current[i] = INITIAL_RADIUS;
      rTargetRef.current[i] = INITIAL_RADIUS;
    }
    return () => {};
  }, []);

  // ---------- Play handler ----------

  const handlePlay = () => {
    if ((idListRef.current === null || countRef.current === 0) && uiBubblesSnapshot.length > 0) {
      setBubblesFromArraysToUi(uiBubblesSnapshot);
    }
    // create a new game id for this match and tell statsClient to tag events with it
    const gid = `game-${Date.now()}`;
    currentGameRef.current = gid;
    try {
      statsClient && typeof (statsClient as any).setGame === "function" && (statsClient as any).setGame(gid, arenaType || ARENA_TYPES.NORMAL);
    } catch (e) {}

    // Immediately post a zero-count presence event for every participant so
    // the server will create game-level entries for all players (prevents
    // boss games from containing only the single player who later generated
    // events). Include `arena` so entries go to the correct store.
    try {
      const seen = new Set();
      const players: string[] = [];
      // collect from current image list (normal bubbles)
      const imgs = imgSrcsRef.current || [];
      for (const s of imgs) {
        if (!s) continue;
        const key = (String(s || '') || '').replace(/^https?:\/\/[^\/]+\//, '').replace(/^\/+/, '').split('/').pop() || String(s);
        if (!seen.has(key)) { seen.add(key); players.push(key); }
      }
      // include superbubble if present
      if (superBubbleRef.current && superBubbleRef.current.imgSrc) {
        const sb = String(superBubbleRef.current.imgSrc || '');
        const key = sb.replace(/^https?:\/\/[^\/]+\//, '').replace(/^\/+/, '').split('/').pop() || sb;
        if (!seen.has(key)) { seen.add(key); players.push(key); }
      }
      // fire-and-forget presence posts
      for (const p of players) {
        try {
          fetch('http://localhost:5000/api/stats/event', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ player: p, hits: 0, kills: 0, game: gid, arena: arenaType || ARENA_TYPES.NORMAL }),
          }).catch(() => {});
        } catch (e) {}
      }
    } catch (e) {}
    setIsRunning(true);
    setWinner(null);
    setWinnersList(null);
    setWinnersImages(null);
    if (arenaType === ARENA_TYPES.NORMAL && !revealStartedRef.current) {
      startRevealPipelineIfNeeded();
    }
  };

  // UI helpers for toggles (replace checkboxes)
  const ToggleButton: React.FC<{ on: boolean; onToggle: () => void; label: string }> = ({ on, onToggle, label }) => (
    <button onClick={onToggle} style={{ padding: "6px 10px", borderRadius: 8, background: on ? "#6b44ff" : "#333", color: "#fff", border: "none", cursor: "pointer" }}>
      {label}: {on ? "ON" : "OFF"}
    </button>
  );

  // ---------- JSX ----------

  if (!arenaType) {
    return (
      <div style={{ height: "100vh", background: "#111", color: "white", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 20 }}>
        <h1>Select Arena</h1>
        <div style={{ display: "flex", gap: 12 }}>
          <button onClick={() => setArenaType(ARENA_TYPES.NORMAL)} style={{ padding: "10px 20px" }}>
            Normal Arena
          </button>
          <button onClick={() => setArenaType(ARENA_TYPES.BOSS)} style={{ padding: "10px 20px" }}>
            Boss Arena
          </button>
        </div>
      </div>
    );
  }

  // Layout: arena-container (left) + right sidebar (controls). Leaderboard sits inside arena-container on the right of the arena.
  return (
    <div className="arena-page" style={{ display: "flex", height: "100vh", width: "100vw", background: "#111", overflow: "hidden", position: "relative" }}>
      <div style={{ flex: 1, display: "flex", height: "100vh", alignItems: "center", justifyContent: "center" }}>
        <div
          className="arena-container"
          style={{
            display: "flex",
            borderRadius: 10,
            border: "1px solid #000",
            overflow: "hidden",
            height: "82vh", // slightly reduced height to reduce bottom crowding
            width: "78vw",
            maxWidth: "1280px",
            maxHeight: "920px",
            background: "transparent",
          }}
        >
          <div
            ref={arenaRef}
            className={`arena ${winner || winnersList || winnersImages ? "arena-blur" : ""}`}
            style={{
              flex: "1 1 auto",
              position: "relative",
              borderRadius: 0,
              width: "100%",
              height: "100%",
              margin: 0,
              background: "rgba(8,8,8,0.95)",
              overflow: "hidden",
            }}
          >
            <canvas ref={canvasRef} style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", zIndex: 100 }} />
            {renderAllProjectiles()}
            {renderMuzzleFlashes()}
            {renderHitEffects()}

            {/* spikes as SVG DOM for sharpness */}
            {spikeEnabled &&
              spikePositions.map((spike, i) => {
                const w = spikeSize;
                const h = spikeSize;
                let style: React.CSSProperties = { position: "absolute", pointerEvents: "none", zIndex: 120, transform: "translate(-50%,0)" };
                let points = "";
                if (spike.side === "top") {
                  style.left = spike.x;
                  style.top = spike.y;
                  points = `0,0 ${w},0 ${w / 2},${h}`;
                } else if (spike.side === "bottom") {
                  style.left = spike.x;
                  style.top = spike.y - h;
                  points = `0,${h} ${w},${h} ${w / 2},0`;
                } else if (spike.side === "left") {
                  style.left = spike.x;
                  style.top = spike.y;
                  style.transform = "translate(0,-50%)";
                  points = `0,0 0,${h} ${w},${h / 2}`;
                } else {
                  style.left = spike.x - w;
                  style.top = spike.y;
                  style.transform = "translate(0,-50%)";
                  points = `${w},0 ${w},${h} 0,${h / 2}`;
                }
                return (
                  <svg key={`spike-${i}`} width={w} height={h} style={style}>
                    <polygon points={points} fill="#fff" />
                  </svg>
                );
              })}
          </div>

          {/* Leaderboard placed to the right of arena (fixed-ish width) */}
          <div
            className="leaderboard"
            style={{
              width: arenaType === ARENA_TYPES.NORMAL ? 260 : 320,
              minWidth: 220,
              maxWidth: 360,
              background: "rgba(8,8,8,0.95)",
              borderLeft: "3px solid rgba(61,59,59,0.55)",
              boxSizing: "border-box",
              overflow: "hidden", // keep internal controls from creating outer scrollbar
            }}
          >
            {arenaType === ARENA_TYPES.BOSS ? renderBossVersusCard() : renderLeaderboardNormal()}
          </div>
        </div>
      </div>

      {/* right controls sidebar */}
      <div style={{ width: 300, minWidth: 260, display: "flex", flexDirection: "column", alignItems: "center", marginTop: 18, position: "relative", zIndex: 41 }}>
        <div style={{ width: "100%", maxWidth: 300, background: "rgba(24,24,24,0.95)", borderRadius: 12, padding: 12, boxSizing: "border-box", maxHeight: "88vh", overflowY: "auto" }}>
          <button onClick={handlePlay} disabled={isRunning} style={{ width: "100%", height: 40, marginBottom: 12 }}>
            ▶ Play
          </button>

          <button onClick={() => setControlsOpen((s) => !s)} style={{ width: "100%", height: 40, marginBottom: 12 }}>
            ⚙️ {controlsOpen ? "Hide Settings" : "Settings"}
          </button>

          <button onClick={handleBack} disabled={isRunning} style={{ width: "100%", height: 40, marginBottom: 12 }}>
            ⤺ Back
          </button>

          <button onClick={resetArenaKeepTypePublic} disabled={!winner && !winnersList && !winnersImages} style={{ width: "100%", height: 40, marginBottom: 12 }}>
            🔄 Reset
          </button>

          <div style={{ display: controlsOpen ? "block" : "none", paddingTop: 6, color: "#ddd", width: "100%" }}>
            <div style={{ marginBottom: 10 }}>
              <label style={{ color: "#ccc" }}>Speed: {speedMultiplier.toFixed(1)}x</label>
              <input type="range" min={0.5} max={15} step={0.1} value={speedMultiplier} onChange={(e) => setSpeedMultiplier(parseFloat(e.target.value))} style={{ width: "100%" }} />
            </div>

            <div style={{ marginBottom: 8, display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ color: "#ccc" }}>Spikes</div>
              <ToggleButton on={spikeEnabled} onToggle={() => setSpikeEnabled((s) => !s)} label={spikeEnabled ? "Enabled" : "Disabled"} />
            </div>

            {spikeEnabled && (
              <>
                <div style={{ marginBottom: 8 }}>
                  <label style={{ color: "#ccc" }}>Spike Count: {spikeCount}</label>
                  <input type="range" min={1} max={20} step={1} value={spikeCount} onChange={(e) => setSpikeCount(parseInt(e.target.value))} style={{ width: "100%" }} />
                </div>
                <div style={{ marginBottom: 8 }}>
                  <label style={{ color: "#ccc" }}>Spike Size: {spikeSize}px</label>
                  <input type="range" min={10} max={80} step={1} value={spikeSize} onChange={(e) => setSpikeSize(parseInt(e.target.value))} style={{ width: "100%" }} />
                </div>
              </>
            )}

            {arenaType === ARENA_TYPES.BOSS && (
              <div style={{ marginTop: 8 }}>
                <div style={{ marginBottom: 8 }}>
                  <div style={{ color: "#ccc", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>Super Power</div>
                    <ToggleButton on={superpowerEnabled} onToggle={() => setSuperpowerEnabled((s) => !s)} label={superpowerEnabled ? "Enabled" : "Disabled"} />
                  </div>

                  <div style={{ display: "flex", gap: 8, marginTop: 8, marginBottom: 8, flexWrap: "wrap" }}>
                    {(["flame", "arrow", "bullet"] as (keyof typeof SUPER_BUBBLE_TYPES)[]).map((k) => (
                      <button
                        key={k}
                        onClick={() => setSelectedPowers((s) => ({ ...s, [k]: !s[k] }))}
                        style={{
                          padding: "6px 8px",
                          borderRadius: 8,
                          background: selectedPowers[k] ? "#6b44ff" : "#333",
                          color: "#fff",
                          border: "none",
                          cursor: "pointer",
                          minWidth: 64,
                        }}
                      >
                        {SUPER_BUBBLE_TYPES[k].name}
                      </button>
                    ))}
                  </div>

                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                    <div style={{ color: "#ccc" }}>Mode:</div>
                    <label style={{ color: "#ccc", display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="radio" name="firemode" value="manual" checked={firingMode === "manual"} onChange={() => setFiringMode("manual")} />
                      Manual
                    </label>
                    <label style={{ color: "#ccc", display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="radio" name="firemode" value="auto" checked={firingMode === "auto"} onChange={() => setFiringMode("auto")} />
                      Auto (every 3s)
                    </label>
                  </div>

                  <div style={{ marginBottom: 8 }}>
                    <label style={{ color: "#ccc" }}>Projectile speed: {projectileSpeedPerTick}px/tick</label>
                    <input type="range" min={1} max={18} step={0.5} value={projectileSpeedPerTick} onChange={(e) => setProjectileSpeedPerTick(parseFloat(e.target.value))} style={{ width: "100%" }} />
                  </div>

                  <div style={{ marginTop: 8 }}>
                    <button onClick={() => handleShoot()} disabled={!isRunning || !superBubbleRef.current || !superpowerEnabled} style={{ width: "100%", height: 36 }}>
                      🔫 Shoot (Manual)
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {(winner || winnersList || winnersImages) && <WinnerOverlay winnerBubble={winner ?? undefined} winners={winnersList ?? undefined} winnersImgs={winnersImages ?? undefined} />}
    </div>
  );
};

export default ArenaPage;
