// src/pages/ArenaPage.tsx
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import Bubble from "../components/Bubbles";
import { getRandom, checkCollision } from "../utils/helpers";
import "../App.css";

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

const SUPER_BUBBLE_TYPES: { [k: string]: SuperPower } = {
  flame: { name: "Flame Shot", damage: 15 },
  arrow: { name: "Arrow Shot", damage: 10 },
  bullet: { name: "Bullet Shot", damage: 20 },
};

const ARENA_TYPES = {
  NORMAL: "normal",
  BOSS: "boss",
} as const;

const SUPER_BUBBLE_HEALTH = 20;

let nextBubbleId = 1;
let nextProjectileId = 1;

const ArenaPage: React.FC = () => {
  const speed = 3;

  // refs & state
  const arenaRef = useRef<HTMLDivElement | null>(null);
  const imageListRef = useRef<string[]>([]); // stores raw image items returned by the server (boss or normal)
  const bossImgRef = useRef<string>("");

  const [arenaType, setArenaType] = useState<string | null>(null);
  const [bubbles, setBubbles] = useState<BubbleData[]>([]);
  const [superBubble, setSuperBubble] = useState<BubbleData | null>(null);
  const [superBubbleType, setSuperBubbleType] = useState<keyof typeof SUPER_BUBBLE_TYPES>("flame");
  const [projectiles, setProjectiles] = useState<
    Array<{ id: number; x: number; y: number; vx: number; vy: number; type: keyof typeof SUPER_BUBBLE_TYPES }>
  >([]);
  const [isRunning, setIsRunning] = useState(false);
  const [winner, setWinner] = useState<BubbleData | null>(null);

  // New: store multiple winners (for boss normals-case)
  const [winnersList, setWinnersList] = useState<BubbleData[] | null>(null);
  // NEW: store winners images for boss-won-by-normals to display ALL normal images (requested change)
  const [winnersImages, setWinnersImages] = useState<string[] | null>(null);

  // spikes / controls
  const [spikeEnabled, setSpikeEnabled] = useState(false);
  const [spikeCount, setSpikeCount] = useState(1);
  const [spikeSize, setSpikeSize] = useState(30);
  const [spikePositions, setSpikePositions] = useState<Omit<Spike, "size">[]>([]);

  const [speedMultiplier, setSpeedMultiplier] = useState(2.5);
  const [controlsOpen, setControlsOpen] = useState(false);

  // ---- NEW: superpower control states ----
  const [superpowerEnabled, setSuperpowerEnabled] = useState(false); // master toggle
  const [selectedPowers, setSelectedPowers] = useState<{ [k in keyof typeof SUPER_BUBBLE_TYPES]?: boolean }>({
    flame: true,
    arrow: false,
    bullet: false,
  });
  const [firingMode, setFiringMode] = useState<"auto" | "manual">("manual");
  const autoFireRef = useRef<number | null>(null);

  // Refs used inside boss loop to avoid stale closures
  const bubblesRef = useRef<BubbleData[]>([]);
  const superRef = useRef<BubbleData | null>(null);
  const projectilesRef = useRef(projectiles);
  const arenaTypeRef = useRef<string | null>(arenaType);

  useEffect(() => {
    bubblesRef.current = bubbles;
  }, [bubbles]);
  useEffect(() => {
    superRef.current = superBubble;
  }, [superBubble]);
  useEffect(() => {
    projectilesRef.current = projectiles;
  }, [projectiles]);
  useEffect(() => {
    arenaTypeRef.current = arenaType;
  }, [arenaType]);

  // ---------- small utilities ----------
  const getArenaDimensions = () => {
    const arena = arenaRef.current;
    if (arena) {
      return { width: arena.clientWidth, height: arena.clientHeight };
    }
    return { width: window.innerWidth * 0.9, height: window.innerHeight * 0.9 };
  };

  const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
  const dist2 = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
  };

  const getRadiusForCount = (count: number) => {
    if (count <= 10) return 50;
    if (count <= 50) return 45;
    if (count <= 100) return 40;
    if (count <= 500) return 35;
    if (count <= 1000) return 30;
    if (count <= 5000) return 25;
    if (count <= 10000) return 20;
    if (count <= 50000) return 15;
    if (count <= 100000) return 10;
    return 5;
  };

  // Separation & bounce helpers (used in boss logic)
  const separatePair = (a: BubbleData, b: BubbleData) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 0.0001;
    const overlap = a.radius + b.radius - d;
    if (overlap > 0) {
      const ux = dx / d;
      const uy = dy / d;
      a.x -= ux * (overlap / 2);
      a.y -= uy * (overlap / 2);
      b.x += ux * (overlap / 2);
      b.y += uy * (overlap / 2);
    }
  };

  const bouncePair = (a: BubbleData, b: BubbleData) => {
    const vx = a.vx - b.vx;
    const vy = a.vy - b.vy;
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const d2 = dx * dx + dy * dy;
    if (d2 === 0) return;
    const dot = vx * dx + vy * dy;
    if (dot > 0) return;
    const collisionScale = dot / d2;
    const cx = dx * collisionScale;
    const cy = dy * collisionScale;
    a.vx = a.vx - cx;
    a.vy = a.vy - cy;
    b.vx = b.vx + cx;
    b.vy = b.vy + cy;
    a.vx *= 0.98;
    a.vy *= 0.98;
    b.vx *= 0.98;
    b.vy *= 0.98;
  };

  // detect spike hit for a bubble (returns full spike object including size)
  const detectSpikeHit = (b: BubbleData) => {
    const arena = getArenaDimensions();
    for (const s of spikePositions) {
      const size = spikeSize;
      if (s.side === "top") {
        if (b.x + b.radius >= s.x && b.x - b.radius <= s.x + size && b.y - b.radius <= size) return { ...s, size };
      } else if (s.side === "bottom") {
        if (b.x + b.radius >= s.x && b.x - b.radius <= s.x + size && b.y + b.radius >= arena.height - size) return { ...s, size };
      } else if (s.side === "left") {
        if (b.y + b.radius >= s.y && b.y - b.radius <= s.y + size && b.x - b.radius <= size) return { ...s, size };
      } else {
        if (b.y + b.radius >= s.y && b.y - b.radius <= s.y + size && b.x + b.radius >= arena.width - size) return { ...s, size };
      }
    }
    return null;
  };

  // -------------------- spike placement --------------------
  useEffect(() => {
    if (!spikeEnabled) {
      setSpikePositions([]);
      return;
    }
    const arena = getArenaDimensions();
    const newPositions: Omit<Spike, "size">[] = [];
    const minDist = 30;
    const maxAttempts = 50;
    for (let i = 0; i < spikeCount; i++) {
      const sides = ["top", "bottom", "left", "right"];
      const side = sides[Math.floor(Math.random() * sides.length)];
      let attempts = 0;
      let valid = false;
      let x = 0;
      let y = 0;
      while (!valid && attempts < maxAttempts) {
        attempts++;
        if (side === "top") {
          x = Math.random() * (arena.width - minDist);
          y = 0;
          valid = newPositions.filter((p) => p.side === "top").every((p) => Math.abs(x - p.x) > minDist);
        } else if (side === "bottom") {
          x = Math.random() * (arena.width - minDist);
          y = arena.height;
          valid = newPositions.filter((p) => p.side === "bottom").every((p) => Math.abs(x - p.x) > minDist);
        } else if (side === "left") {
          x = 0;
          y = Math.random() * (arena.height - minDist);
          valid = newPositions.filter((p) => p.side === "left").every((p) => Math.abs(y - p.y) > minDist);
        } else {
          x = arena.width;
          y = Math.random() * (arena.height - minDist);
          valid = newPositions.filter((p) => p.side === "right").every((p) => Math.abs(y - p.y) > minDist);
        }
      }
      if (valid) newPositions.push({ side, x, y });
    }
    setSpikePositions(newPositions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spikeEnabled, spikeCount, arenaRef.current?.clientWidth, arenaRef.current?.clientHeight]);

  // -------------------- load images for selected arena --------------------
  useLayoutEffect(() => {
    if (!arenaType) return;
    if (isRunning) return;

    (async () => {
      const arena = getArenaDimensions();
      if (arenaType === ARENA_TYPES.NORMAL) {
        try {
          const res = await fetch("http://localhost:5000/api/images");
          const images: string[] = await res.json();
          const targetRadius = getRadiusForCount(images.length);
          const newBubbles: BubbleData[] = [];
          for (const img of images) {
            let tries = 0;
            let x = 0;
            let y = 0;
            let valid = false;
            while (!valid && tries < 100) {
              tries++;
              x = getRandom(targetRadius, arena.width - targetRadius);
              y = getRandom(targetRadius, arena.height - targetRadius);
              valid = true;
              for (const b of [...newBubbles]) {
                const dx = x - b.x;
                const dy = y - b.y;
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
              imgSrc: "http://localhost:5000" + img,
              vx: Math.cos(Math.random() * Math.PI * 2) * speed,
              vy: Math.sin(Math.random() * Math.PI * 2) * speed,
              id: nextBubbleId++,
            });
          }
          setBubbles((prev) => {
            const combined = [...prev, ...newBubbles];
            const r = getRadiusForCount(combined.length);
            return combined.map((b) => ({ ...b, radius: r }));
          });
          imageListRef.current = images; // store returned identifiers
        } catch (e) {
          console.error("Error fetching normal images", e);
        }
      } else {
        try {
          const res = await fetch("http://localhost:5000/api/bossimgs");
          const images: string[] = await res.json();
          const targetRadius = getRadiusForCount(images.length);
          const newBubbles: BubbleData[] = [];
          for (const img of images) {
            let tries = 0;
            let x = 0;
            let y = 0;
            let valid = false;
            while (!valid && tries < 100) {
              tries++;
              x = getRandom(targetRadius, arena.width - targetRadius);
              y = getRandom(targetRadius, arena.height - targetRadius);
              valid = true;
              for (const b of [...newBubbles]) {
                const dx = x - b.x;
                const dy = y - b.y;
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
              vx: 0,
              vy: 0,
              id: nextBubbleId++,
            });
          }
          setBubbles(newBubbles);
          imageListRef.current = images; // store raw list for boss images (we'll use this for winner gallery)
        } catch (e) {
          console.error("Error fetching boss images", e);
          setBubbles([]);
        }

        try {
          const res2 = await fetch("http://localhost:5000/api/superbubbleimg");
          const imgs: string[] = await res2.json();
          let src = "";
          if (imgs.length > 0) src = `http://localhost:5000/superbubbleimg/${imgs[0]}`;
          bossImgRef.current = src;
          setSuperBubble((prev) => {
            if (prev) return prev;
            const dim = getArenaDimensions();
            return {
              x: dim.width / 2,
              y: dim.height / 2,
              radius: 60,
              health: SUPER_BUBBLE_HEALTH,
              imgSrc: src,
              vx: 0,
              vy: 0,
              id: nextBubbleId++,
            };
          });
        } catch (e) {
          console.error("Error fetching superbubble image", e);
        }
      }
    })();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arenaType]);

  // -------------------- assign movement when game starts (boss) --------------------
  useEffect(() => {
    if (!isRunning) return;
    if (arenaType === ARENA_TYPES.BOSS) {
      setBubbles((prev) =>
        prev.map((b) => {
          if (Math.abs(b.vx) > 0.01 || Math.abs(b.vy) > 0.01) return b;
          const ang = Math.random() * Math.PI * 2;
          const sp = speed * (0.6 + Math.random() * 0.9);
          return { ...b, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp };
        })
      );
      setSuperBubble((sb) => {
        if (!sb) return sb;
        if (Math.abs(sb.vx) > 0.01 || Math.abs(sb.vy) > 0.01) return sb;
        const ang = Math.random() * Math.PI * 2;
        const sp = speed * 0.8;
        return { ...sb, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp };
      });
    }
  }, [isRunning, arenaType]);

  // -------------------- main loop (normal and boss separated) --------------------
  useEffect(() => {
    if (!isRunning || !arenaType) return;

    // NORMAL arena loop
    if (arenaType === ARENA_TYPES.NORMAL) {
      const normalInterval = window.setInterval(() => {
        const arena = getArenaDimensions();
        setBubbles((prev) => {
          const moved = prev.map((b) => {
            let nx = b.x + b.vx * speedMultiplier;
            let ny = b.y + b.vy * speedMultiplier;
            let nvx = b.vx;
            let nvy = b.vy;
            if (nx - b.radius <= 0) {
              nx = b.radius;
              nvx = Math.abs(nvx);
            }
            if (nx + b.radius >= arena.width) {
              nx = arena.width - b.radius;
              nvx = -Math.abs(nvx);
            }
            if (ny - b.radius <= 0) {
              ny = b.radius;
              nvy = Math.abs(nvy);
            }
            if (ny + b.radius >= arena.height) {
              ny = arena.height - b.radius;
              nvy = -Math.abs(nvy);
            }
            return { ...b, x: nx, y: ny, vx: nvx, vy: nvy };
          });

          // normal-normal collisions
          for (let i = 0; i < moved.length; i++) {
            for (let j = i + 1; j < moved.length; j++) {
              const a = moved[i];
              const c = moved[j];
              if (checkCollision(a, c)) {
                separatePair(a, c);
                bouncePair(a, c);
                moved[i].health = Math.max(moved[i].health - 8, 0);
                moved[j].health = Math.max(moved[j].health - 8, 0);
              }
            }
          }

          // -------- spike handling for NORMAL arena (fix from request) --------
          if (spikeEnabled) {
            for (let i = 0; i < moved.length; i++) {
              const b = moved[i];
              const s = detectSpikeHit(b);
              if (s) {
                // damage and push away
                moved[i].health = Math.max(moved[i].health - 18, 0);
                if (s.side === "top") {
                  moved[i].y = Math.max(moved[i].y, s.size + b.radius + 2);
                  moved[i].vy = Math.abs(moved[i].vy) || 2;
                } else if (s.side === "bottom") {
                  moved[i].y = Math.min(moved[i].y, arena.height - s.size - b.radius - 2);
                  moved[i].vy = -Math.abs(moved[i].vy) || -2;
                } else if (s.side === "left") {
                  moved[i].x = Math.max(moved[i].x, s.size + b.radius + 2);
                  moved[i].vx = Math.abs(moved[i].vx) || 2;
                } else {
                  moved[i].x = Math.min(moved[i].x, arena.width - s.size - b.radius - 2);
                  moved[i].vx = -Math.abs(moved[i].vx) || -2;
                }
              }
            }
          }

          const alive = moved.filter((b) => b.health > 0);

          if (alive.length === 1) {
            // single normal winner (normal arena)
            setWinnersList(null);
            setWinnersImages(null);
            setWinner(alive[0]);
            setIsRunning(false);
          }

          return alive;
        });
      }, 50);
      return () => clearInterval(normalInterval);
    }

    // BOSS arena loop
    if (arenaType === ARENA_TYPES.BOSS) {
      const bossInterval = window.setInterval(() => {
        // Work on local copies, then commit once per tick
        const arena = getArenaDimensions();

        const normals = bubblesRef.current.map((b) => ({ ...b }));
        const superLocal = superRef.current ? { ...superRef.current } : null;
        const projLocal = projectilesRef.current.slice().map((p) => ({ ...p }));

        // 1) move normals
        for (const b of normals) {
          let nx = b.x + b.vx * speedMultiplier;
          let ny = b.y + b.vy * speedMultiplier;
          let nvx = b.vx;
          let nvy = b.vy;
          if (nx - b.radius <= 0) {
            nx = b.radius;
            nvx = Math.abs(nvx);
          } else if (nx + b.radius >= arena.width) {
            nx = arena.width - b.radius;
            nvx = -Math.abs(nvx);
          }
          if (ny - b.radius <= 0) {
            ny = b.radius;
            nvy = Math.abs(nvy);
          } else if (ny + b.radius >= arena.height) {
            ny = arena.height - b.radius;
            nvy = -Math.abs(nvy);
          }
          b.x = clamp(nx, b.radius, arena.width - b.radius);
          b.y = clamp(ny, b.radius, arena.height - b.radius);
          b.vx = nvx;
          b.vy = nvy;
        }

        // 2) move super
        if (superLocal) {
          let nx = superLocal.x + superLocal.vx * speedMultiplier;
          let ny = superLocal.y + superLocal.vy * speedMultiplier;
          let nvx = superLocal.vx;
          let nvy = superLocal.vy;
          if (nx - superLocal.radius <= 0) {
            nx = superLocal.radius;
            nvx = Math.abs(nvx);
          } else if (nx + superLocal.radius >= arena.width) {
            nx = arena.width - superLocal.radius;
            nvx = -Math.abs(nvx);
          }
          if (ny - superLocal.radius <= 0) {
            ny = superLocal.radius;
            nvy = Math.abs(nvy);
          } else if (ny + superLocal.radius >= arena.height) {
            ny = arena.height - superLocal.radius;
            nvy = -Math.abs(nvy);
          }
          superLocal.x = clamp(nx, superLocal.radius, arena.width - superLocal.radius);
          superLocal.y = clamp(ny, superLocal.radius, arena.height - superLocal.radius);
          superLocal.vx = nvx;
          superLocal.vy = nvy;
        }

        // 3) normal-normal collisions
        for (let i = 0; i < normals.length; i++) {
          for (let j = i + 1; j < normals.length; j++) {
            const A = normals[i];
            const B = normals[j];
            const minD2 = (A.radius + B.radius) * (A.radius + B.radius);
            if (dist2(A, B) < minD2) {
              separatePair(A, B);
              bouncePair(A, B);
              A.health = Math.max(0, A.health - 3);
              B.health = Math.max(0, B.health - 3);
            }
          }
        }

        // 4) normal-super collisions
        let sbHealthAfter = superLocal ? superLocal.health : null;
        if (superLocal) {
          let hits = 0;
          for (const n of normals) {
            const minD2 = (n.radius + superLocal.radius) * (n.radius + superLocal.radius);
            if (dist2(n, superLocal) < minD2) {
              hits++;
              separatePair(n, superLocal);
              bouncePair(n, superLocal);
              n.health = Math.max(0, n.health - Math.max(10, Math.round(n.health * 0.06)));
              const dx = n.x - superLocal.x;
              const dy = n.y - superLocal.y;
              const d = Math.sqrt(dx * dx + dy * dy) || 0.0001;
              n.x += (dx / d) * 6;
              n.y += (dy / d) * 6;
            }
          }
          if (hits > 0) {
            let newH = sbHealthAfter!;
            for (let k = 0; k < hits; k++) {
              newH = Math.max(0, Math.floor(newH - newH * 0.12));
            }
            sbHealthAfter = newH;
          }
        }

        // 5) spikes (Normals only — superbubble should NOT take spike damage)
        if (spikeEnabled && spikePositions.length > 0) {
          for (const n of normals) {
            const s = detectSpikeHit(n);
            if (s) {
              n.health = Math.max(0, n.health - 18);
              if (s.side === "top") {
                n.y = Math.max(n.radius + s.size + 2, n.y + 8);
                n.vy = Math.abs(n.vy) || 2;
              } else if (s.side === "bottom") {
                n.y = Math.min(arena.height - n.radius - s.size - 2, n.y - 8);
                n.vy = -Math.abs(n.vy) || -2;
              } else if (s.side === "left") {
                n.x = Math.max(n.radius + s.size + 2, n.x + 8);
                n.vx = Math.abs(n.vx) || 2;
              } else {
                n.x = Math.min(arena.width - n.radius - s.size - 2, n.x - 8);
                n.vx = -Math.abs(n.vx) || -2;
              }
            }
          }
          // NOTE: superLocal is intentionally NOT damaged by spikes per your request
        }

        // 6) projectiles (move + check hits)
        const nextProjectiles: typeof projectiles = [];
        for (const p of projLocal) {
          const nx = p.x + p.vx;
          const ny = p.y + p.vy;
          if (nx < 0 || ny < 0 || nx > arena.width || ny > arena.height) continue;
          let hit = false;
          for (const n of normals) {
            const dx = n.x - nx;
            const dy = n.y - ny;
            if (dx * dx + dy * dy < n.radius * n.radius) {
              const power = SUPER_BUBBLE_TYPES[p.type];
              n.health = Math.max(0, n.health - power.damage);
              hit = true;
              break;
            }
          }
          if (!hit) nextProjectiles.push({ ...p, x: nx, y: ny });
        }

        // 7) remove popped normals
        const aliveNormals = normals.filter((n) => n.health > 0);

        // 8) commit super snapshot
        if (superLocal) superLocal.health = sbHealthAfter ?? superLocal.health;

        // 9) winner logic (local snapshot)
        if (superLocal && superLocal.health <= 0) {
          // Super died -> normals win (show ALL normal images loaded for boss arena)
          setIsRunning(false);
          setSuperBubble(null);
          setBubbles(aliveNormals);
          setProjectiles(nextProjectiles);
          setWinner(null);
          setWinnersList(null);

          // IMPORTANT CHANGE: show all boss normal images (full set) in winners images irrespective of survivors
          // imageListRef.current contains the raw filenames returned by the server for boss images
          const allBossImgs = (imageListRef.current || []).map((imgName) => `http://localhost:5000/bossimgs/${imgName}`);
          setWinnersImages(allBossImgs.length > 0 ? allBossImgs : null);

          return;
        }

        if (aliveNormals.length === 0 && superLocal) {
          // All normals dead -> superbubble wins
          setIsRunning(false);
          setBubbles([]);
          setProjectiles([]);
          setSuperBubble({ ...superLocal });
          setWinner({ ...superLocal, health: Math.round(superLocal.health) });
          setWinnersList(null);
          setWinnersImages(null);
          return;
        }

        // 10) commit state
        const targetRadius = getRadiusForCount(aliveNormals.length);
        const adjustedNormals = aliveNormals.map((b) => ({ ...b, radius: targetRadius }));
        setBubbles(adjustedNormals);
        if (superLocal) setSuperBubble(superLocal);
        setProjectiles(nextProjectiles);
      }, 50);

      return () => clearInterval(bossInterval);
    }

    // nothing to return except cleanup functions above
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning, arenaType, spikeEnabled, spikeCount, spikeSize, speedMultiplier]);

  // -------------------- Superpower firing helpers --------------------
  // 8 compass directions (normalized unit vectors)
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

  // picks a random available power key (if multiple selected), returns a key from SUPER_BUBBLE_TYPES
  const pickRandomSelectedPower = (): keyof typeof SUPER_BUBBLE_TYPES => {
    const keys = Object.keys(SUPER_BUBBLE_TYPES) as (keyof typeof SUPER_BUBBLE_TYPES)[];
    const available = keys.filter((k) => selectedPowers[k]);
    if (available.length === 0) return "flame";
    return available[Math.floor(Math.random() * available.length)];
  };

  // pick random compass direction object
  const pickRandomDirection = () => {
    return COMPASS[Math.floor(Math.random() * COMPASS.length)];
  };

  // compute projectile velocity per tick. projectiles in boss loop move by p.vx each tick (no multiplier)
  const projectileSpeedPerTick = 6; // tune this for visual speed

  // -------------------- Shoot (manual or auto) --------------------
  // IMPORTANT: spawn from superbubble's current position (use superRef to avoid stale closures)
  const handleShoot = (forcedDirection?: { vx: number; vy: number }) => {
    if (!superRef.current || arenaType !== ARENA_TYPES.BOSS || !isRunning || !superpowerEnabled) return;
    const sb = superRef.current;
    const dir = forcedDirection ?? pickRandomDirection();
    const powerKey = pickRandomSelectedPower();
    const vx = dir.vx * projectileSpeedPerTick;
    const vy = dir.vy * projectileSpeedPerTick;

    nextProjectileId++;
    // spawn exactly at superbubble center
    setProjectiles((p) => [...p, { id: nextProjectileId, x: sb.x, y: sb.y, vx, vy, type: powerKey }]);
  };

  // -------------------- Auto-fire effect (fires every 3s when enabled) --------------------
  useEffect(() => {
    // cleanup any previous interval
    if (autoFireRef.current) {
      window.clearInterval(autoFireRef.current);
      autoFireRef.current = null;
    }

    if (arenaType === ARENA_TYPES.BOSS && isRunning && superpowerEnabled && firingMode === "auto") {
      // Start interval
      const id = window.setInterval(() => {
        // choose random direction and shoot (use superRef)
        const dir = pickRandomDirection();
        handleShoot(dir);
      }, 3000);
      autoFireRef.current = id as unknown as number;
      // cleanup
      return () => {
        if (autoFireRef.current) {
          window.clearInterval(autoFireRef.current);
          autoFireRef.current = null;
        }
      };
    }
    return;
    // depend on relevant states to start/stop auto firing
  }, [arenaType, isRunning, superpowerEnabled, firingMode, selectedPowers]);

  // -------------------- projectile visuals (realistic + rotated) --------------------
  const renderProjectileVisual = (p: { id: number; x: number; y: number; type: keyof typeof SUPER_BUBBLE_TYPES; vx: number; vy: number }) => {
    // compute angle in degrees so the sprite points along its velocity
    const angleDeg = Math.atan2(p.vy, p.vx) * (180 / Math.PI);

    // position + rotation via CSS transform: translate(-50%,-50%) to center, then rotate
    const baseStyle: React.CSSProperties = {
      position: "absolute",
      left: p.x,
      top: p.y,
      transform: `translate(-50%,-50%) rotate(${angleDeg}deg)`,
      zIndex: 1200,
      pointerEvents: "none",
    };

    if (p.type === "flame") {
      // layered flame silhouette with gradient and a soft tail
      return (
        <svg key={p.id} width={36} height={48} style={baseStyle} viewBox="0 0 36 48" preserveAspectRatio="xMidYMid meet">
          <defs>
            <radialGradient id={`fg${p.id}`} cx="50%" cy="30%" r="60%">
              <stop offset="0%" stopColor="#fff59d" />
              <stop offset="30%" stopColor="#ffb74d" />
              <stop offset="70%" stopColor="#ff7043" />
              <stop offset="100%" stopColor="#b71c1c" />
            </radialGradient>
            <filter id={`blur${p.id}`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="0.6" />
            </filter>
          </defs>

          {/* outer glow */}
          <path
            d="M18 46 C20 36, 30 30, 30 22 C30 14, 22 12, 18 6 C14 12, 6 14, 6 22 C6 30, 14 36, 18 46 Z"
            fill="url(#fg{p.id})"
            opacity={0.18}
            transform="translate(0,-2)"
            style={{ filter: `url(#blur${p.id})` }}
          />

          {/* main flame */}
          <path
            d="M18 40 C20 32, 26 28, 26 22 C26 16, 20 14, 18 10 C16 14, 10 16, 10 22 C10 28, 16 32, 18 40 Z"
            fill={`url(#fg${p.id})`}
            stroke="rgba(0,0,0,0.08)"
            strokeWidth={0.4}
          />

          {/* inner hot core */}
          <path d="M18 30 C19 26, 22 24, 22 20 C22 16, 19 15, 18 12 C17 15, 14 16, 14 20 C14 24, 17 26, 18 30 Z" fill="#fff8e0" opacity={0.9} />
        </svg>
      );
    } else if (p.type === "arrow") {
      // arrow: shaft + head + fletching
      // draw horizontally to the right and rotate via style
      return (
        <svg key={p.id} width={52} height={12} style={baseStyle} viewBox="0 0 52 12" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id={`arrowGrad${p.id}`} x1="0" x2="1">
              <stop offset="0%" stopColor="#6b4f3b" />
              <stop offset="100%" stopColor="#3b2b1f" />
            </linearGradient>
          </defs>
          {/* shaft */}
          <rect x="0" y="5" width="36" height="2" rx="1" fill="url(#arrowGrad{p.id})" />
          {/* head */}
          <polygon points="36,0 52,6 36,12" fill="#222" stroke="#111" strokeWidth="0.5" />
          {/* fletching */}
          <polygon points=" -2,2 2,6 -2,10" transform="translate(36,0)" fill="#8b6a4a" opacity={0.95} />
          <polygon points=" -6,2 -2,6 -6,10" transform="translate(32,0)" fill="#6b4f3b" opacity={0.9} />
        </svg>
      );
    } else {
      // bullet: capsule + tip
      return (
        <svg key={p.id} width={36} height={12} style={baseStyle} viewBox="0 0 36 12" preserveAspectRatio="xMidYMid meet">
          {/* body capsule */}
          <rect x="0" y="2" width="22" height="8" rx="4" fill="#ffd54f" stroke="#e0a800" strokeWidth={0.6} />
          {/* tip */}
          <polygon points="22,0 36,6 22,12" fill="#ddd" stroke="#c6c6c6" strokeWidth={0.4} />
          {/* slight shine */}
          <rect x="3" y="3" width="10" height="2" rx="1" fill="rgba(255,255,255,0.6)" />
        </svg>
      );
    }
  };

    // -------------------- Reset & Back helpers --------------------
  const resetArenaKeepType = () => {
    setIsRunning(false);
    setWinner(null);
    setWinnersList(null);
    setWinnersImages(null);
    setBubbles([]);
    setSuperBubble(null);
    setProjectiles([]);
    imageListRef.current = [];
    bossImgRef.current = "";
    // clear auto-fire interval if any
    if (autoFireRef.current) {
      window.clearInterval(autoFireRef.current);
      autoFireRef.current = null;
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
    setIsRunning(false);
    setWinner(null);
    setWinnersList(null);
    setWinnersImages(null);
    setBubbles([]);
    setSuperBubble(null);
    setProjectiles([]);
    imageListRef.current = [];
    bossImgRef.current = "";
    setArenaType(null);
    // clear auto-fire
    if (autoFireRef.current) {
      window.clearInterval(autoFireRef.current);
      autoFireRef.current = null;
    }
  };

  // -------------------- rendering helpers --------------------
  const normalizedHealthForBubble = (b: BubbleData | null) => {
    if (!b) return 0;
    if (b === superBubble) {
      return Math.max(0, Math.min(100, (b.health / SUPER_BUBBLE_HEALTH) * 100));
    }
    return Math.max(0, Math.min(100, b.health));
  };

  const renderSuperBubbleWithHealth = () => {
    if (!superBubble) return null;
    const barWidth = superBubble.radius * 2;
    const healthPercent = Math.max(0, (superBubble.health / SUPER_BUBBLE_HEALTH) * 100);
    return (
      <>
        <div
          style={{
            position: "absolute",
            left: superBubble.x - superBubble.radius,
            top: superBubble.y - superBubble.radius - 18,
            width: barWidth,
            height: 8,
            backgroundColor: "gray",
            borderRadius: 4,
            overflow: "hidden",
            border: "1px solid #333",
            zIndex: 3000,
          }}
        >
          <div style={{ width: `${healthPercent}%`, height: "100%", backgroundColor: "red", borderRadius: 4 }} />
        </div>
        <Bubble {...{ ...superBubble, health: normalizedHealthForBubble(superBubble) }} />
      </>
    );
  };


  // -------------------- projectile render wrapper (maps projectiles with rotation) --------------------
  // We'll provide p.vx/p.vy to render function so it can compute rotation and draw.
  const renderAllProjectiles = () => {
    return projectiles.map((p) => renderProjectileVisual({ ...p, vx: p.vx, vy: p.vy }));
  };

  // ---------- Leaderboard and boss card renderers ----------
  const renderLeaderboardNormal = () => {
    const top = [...bubbles].sort((a, b) => b.health - a.health).slice(0, 10);
    // total height chosen to fit 10 items (header occupies small space)
    const containerHeight = 450;
    const itemHeight = Math.floor((containerHeight - 40) / 10); // leave ~40px for header
    const imgSize = 34;

    return (
      <div style={{ width: "100%", padding: 8, boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <div style={{ fontSize: 16 }}>🏆</div>
          <h3 style={{ margin: 0, color: "#ddd", fontSize: 15 }}>Leaderboard</h3>
        </div>

        <div
          style={{
            height: containerHeight,
            overflow: "hidden", // prevent internal scrollbar
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-start",
            gap: 10,
          }}
        >
          {top.map((entry) => {
            const fullName = entry.imgSrc.split("/").pop() ?? `#${entry.id}`;
            return (
              <div
                key={entry.id}
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  height: itemHeight,
                  minHeight: itemHeight,
                  maxHeight: itemHeight,
                  boxSizing: "border-box",
                  paddingRight: 6,
                  background: "transparent",
                }}
              >
                <img
                  src={entry.imgSrc}
                  alt="player"
                  style={{
                    width: imgSize,
                    height: imgSize,
                    borderRadius: 8,
                    objectFit: "cover",
                    flex: `0 0 ${imgSize}px`,
                  }}
                />

                {/* name + hp container must be able to shrink: minWidth:0 */}
                <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
                  <div
                    title={fullName}
                    style={{
                      color: "#fff",
                      fontSize: 12,
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      maxWidth: "100%",
                    }}
                  >
                    {fullName}
                  </div>

                  <div style={{ color: entry.health > 60 ? "green" : entry.health > 30 ? "yellow" : "red", fontSize: 11 }}>
                    {Math.round(entry.health)} hp
                  </div>
                </div>
              </div>
            );
          })}

          {/* fill empty slots (visual) so layout always shows 10 rows */}
          {Array.from({ length: Math.max(0, 10 - top.length) }).map((_, idx) => (
            <div
              key={`empty-${idx}`}
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                height: itemHeight,
                minHeight: itemHeight,
                maxHeight: itemHeight,
                boxSizing: "border-box",
                paddingRight: 6,
                opacity: 0.35,
              }}
            >
              <div style={{ width: imgSize, height: imgSize, borderRadius: 8, background: "rgba(255,255,255,0.03)" }} />
              <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <div style={{ color: "#777", fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>—</div>
                <div style={{ color: "#666", fontSize: 11 }}>—</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderBossVersusCard = () => {
    const leftNormals = bubbles.slice(0, 10);
    const sbPct = superBubble ? Math.max(0, Math.round((superBubble.health / SUPER_BUBBLE_HEALTH) * 100)) : 0;
    return (
      <div style={{ width: "100%", padding: 8 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {leftNormals.map((n) => (
            <div key={n.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <img src={n.imgSrc} alt="n" style={{ width: 44, height: 44, borderRadius: 8, objectFit: "cover" }} />
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
            <img src={superBubble?.imgSrc} alt="super" style={{ width: 64, height: 64, borderRadius: 10, objectFit: "cover" }} />
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ color: "#fff", fontSize: 13 }}>Super Bubble</div>
              <div style={{ color: sbPct > 60 ? "green" : sbPct > 30 ? "yellow" : "red", fontSize: 12 }}>{sbPct}hp</div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Winner overlay
  const WinnerOverlay: React.FC<{ winnerBubble?: BubbleData; winners?: BubbleData[]; winnersImgs?: string[] }> = ({ winnerBubble, winners, winnersImgs }) => {
    // If winnersImgs provided -> show those images (this is the boss-change we implemented)
    if (winnersImgs && winnersImgs.length > 0) {
      return (
        <div
          className="winner-modal"
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            pointerEvents: "auto",
          }}
        >
          <div
            onClick={() => {
              resetArenaKeepType();
              setArenaType(null);
              setWinner(null);
              setWinnersList(null);
              setWinnersImages(null);
            }}
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(0,0,0,0.6)",
              backdropFilter: "blur(6px)",
            }}
          />
          <div
            style={{
              position: "relative",
              zIndex: 10000,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12,
              animation: "winnerPop 700ms ease both",
              color: "#fff",
            }}
          >
            <h2 style={{ margin: 0 }}>Normals Win!</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(80px, 1fr))", gap: 12, width: "80vw", maxWidth: 600 }}>
              {winnersImgs.map((src, idx) => (
                <div
                  key={`winimg-${idx}`}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    background: "rgba(255,255,255,0.03)",
                    padding: 8,
                    borderRadius: 8,
                  }}
                >
                  <img src={src} alt={`win-${idx}`} style={{ width: 64, height: 64, borderRadius: 8, objectFit: "cover" }} />
                </div>
              ))}
            </div>
            <div style={{ color: "#aaa", fontSize: 13 }}>Click anywhere to continue</div>
          </div>

          <style>{`
            @keyframes winnerPop {
              0% { opacity: 0; transform: translateY(20px); }
              100% { opacity: 1; transform: translateY(0); }
            }
          `}</style>
        </div>
      );
    }

    // If winners array (subset) provided -> show those
    if (winners && winners.length > 0) {
      return (
        <div
          className="winner-modal"
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            pointerEvents: "auto",
          }}
        >
          <div
            onClick={() => {
              resetArenaKeepType();
              setArenaType(null);
              setWinner(null);
              setWinnersList(null);
              setWinnersImages(null);
            }}
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(0,0,0,0.6)",
              backdropFilter: "blur(6px)",
            }}
          />
          <div
            style={{
              position: "relative",
              zIndex: 10000,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12,
              animation: "winnerPop 700ms ease both",
              color: "#fff",
            }}
          >
            <h2 style={{ margin: 0 }}>Normals Win!</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(80px, 1fr))", gap: 12, width: "80vw", maxWidth: 600 }}>
              {winners.map((w) => (
                <div
                  key={w.id}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    background: "rgba(255,255,255,0.03)",
                    padding: 8,
                    borderRadius: 8,
                  }}
                >
                  <img src={w.imgSrc} alt="win" style={{ width: 64, height: 64, borderRadius: 8, objectFit: "cover" }} />
                  <div style={{ marginTop: 6, color: w.health > 60 ? "green" : w.health > 30 ? "yellow" : "red" }}>{Math.round(w.health)} hp</div>
                </div>
              ))}
            </div>
            <div style={{ color: "#aaa", fontSize: 13 }}>Click anywhere to continue</div>
          </div>

          <style>{`
            @keyframes winnerPop {
              0% { opacity: 0; transform: translateY(20px); }
              100% { opacity: 1; transform: translateY(0); }
            }
          `}</style>
        </div>
      );
    }

    // single winner (bubble)
    if (!winnerBubble) return null;
    const displayHealth = winnerBubble === superBubble ? Math.round((winnerBubble.health / SUPER_BUBBLE_HEALTH) * 100) : Math.round(winnerBubble.health);
    return (
      <div
        className="winner-modal"
        style={{
          position: "fixed",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 9999,
          pointerEvents: "auto",
        }}
      >
        <div
          onClick={() => {
            resetArenaKeepType();
            setArenaType(null);
            setWinner(null);
            setWinnersList(null);
            setWinnersImages(null);
          }}
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            backdropFilter: "blur(6px)",
          }}
        />
        <div
          style={{
            position: "relative",
            zIndex: 10000,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
            animation: "winnerPop 700ms ease both",
          }}
        >
          <h2 style={{ color: "#fff", margin: 0, transform: "translateY(-20px)" }}>
            {winnerBubble === superBubble ? "Super Bubble Wins!" : "Winner!"}
          </h2>

          <div
            style={{
              width: winnerBubble.radius * 4,
              height: winnerBubble.radius * 4,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transformOrigin: "center",
              animation: "bubbleZoom 700ms ease both",
              boxShadow: "0 8px 40px rgba(0,0,0,0.6)",
              background: "rgba(0,0,0,0.2)",
            }}
          >
            <img src={winnerBubble.imgSrc} alt="winner" style={{ width: "86%", height: "86%", borderRadius: "50%", objectFit: "cover" }} />
          </div>

          <div style={{ color: "#fff" }}>{displayHealth} hp</div>
          <div style={{ color: "#aaa", fontSize: 13 }}>Click anywhere to continue</div>
        </div>

        {/* animations */}
        <style>{`
          @keyframes bubbleZoom {
            0% { transform: scale(0.4) translateY(40px); opacity: 0; }
            60% { transform: scale(1.08) translateY(-6px); opacity: 1; }
            100% { transform: scale(1) translateY(0); opacity: 1; }
          }
          @keyframes winnerPop {
            0% { opacity: 0; transform: translateY(20px); }
            100% { opacity: 1; transform: translateY(0); }
          }
        `}</style>
      </div>
    );
  };

  // -------------------- Render start --------------------
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

  // -------------------- main JSX --------------------
  return (
    <div className="arena-page" style={{ display: "flex", height: "100vh", width: "100vw", background: "#111" }}>
      <div style={{ flex: 1, display: "flex", height: "100vh" }}>
        <div className="arena-wrapper" style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center" }}>
          <div className="arena-container">
            <div ref={arenaRef} className={`arena ${winner || winnersList || winnersImages ? "arena-blur" : ""}`} style={{ position: "relative" }}>
              <div className="bubble-container" style={{ position: "relative", width: "100%", height: "100%" }}>
                {bubbles.map((b) => (
                  <Bubble key={b.id} {...{ ...b, health: Math.max(0, Math.min(100, b.health)) }} />
                ))}

                {arenaType === ARENA_TYPES.BOSS && renderSuperBubbleWithHealth()}

                {/* projectiles (render improved visuals) */}
                {renderAllProjectiles()}
              </div>

              {/* spikes visuals */}
              {spikeEnabled &&
                spikePositions.map((spike, i) => {
                  const w = spikeSize;
                  const h = spikeSize;
                  let style: React.CSSProperties = { position: "absolute", pointerEvents: "none" };
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
                    points = `0,0 0,${h} ${w},${h / 2}`;
                  } else {
                    style.left = spike.x - w;
                    style.top = spike.y;
                    points = `${w},0 ${w},${h} 0,${h / 2}`;
                  }
                  return (
                    <svg key={`spike-${i}`} width={w} height={h} style={style}>
                      <polygon points={points} fill="#fff" />
                    </svg>
                  );
                })}
            </div>

            {/* leaderboard or vs card */}
            <div className="leaderboard" style={{ marginTop: 8 }}>
              {arenaType === ARENA_TYPES.BOSS ? renderBossVersusCard() : renderLeaderboardNormal()}
            </div>
          </div>
        </div>
      </div>

      {/* sidebar controls */}
      <div style={{ width: 260, minWidth: 220, display: "flex", flexDirection: "column", alignItems: "center", marginTop: 48, position: "relative", zIndex: 41, background: "rgba(24,24,24,0.95)", borderRadius: 16, padding: 12 }}>
        <button
          onClick={() => {
            setIsRunning(true);
            setWinner(null);
            setWinnersList(null);
            setWinnersImages(null);
            bubblesRef.current = bubbles;
            superRef.current = superBubble;
            projectilesRef.current = projectiles;
          }}
          disabled={isRunning}
          style={{ width: 200, height: 40, marginBottom: 12 }}
        >
          ▶ Play
        </button>

        <button onClick={() => setControlsOpen((s) => !s)} style={{ width: 200, height: 40, marginBottom: 12 }}>
          ⚙️ Settings
        </button>

        <button onClick={handleBack} disabled={isRunning} style={{ width: 200, height: 40, marginBottom: 12 }}>
          ⬅ Back
        </button>

        <button onClick={resetArenaKeepTypePublic} disabled={!winner && !winnersList && !winnersImages} style={{ width: 200, height: 40, marginBottom: 12 }}>
          🔄 Reset
        </button>

        <div style={{ width: "100%", position: "relative", zIndex: 35 }}>
          <div style={{ display: controlsOpen ? "block" : "none", paddingTop: 10, color: "#ddd", width: "100%" }}>
            <div style={{ marginBottom: 10 }}>
              <label style={{ color: "#ccc" }}>Speed: {speedMultiplier.toFixed(1)}x</label>
              <input type="range" min={0.5} max={15} step={0.1} value={speedMultiplier} onChange={(e) => setSpeedMultiplier(parseFloat(e.target.value))} style={{ width: "100%" }} />
            </div>

            <div style={{ marginBottom: 8 }}>
              <label style={{ color: "#ccc" }}>Enable Spikes:</label>
              <input type="checkbox" checked={spikeEnabled} onChange={(e) => setSpikeEnabled(e.target.checked)} style={{ marginLeft: 8 }} />
            </div>
            {spikeEnabled && (
              <>
                <div style={{ marginBottom: 8 }}>
                  <label style={{ color: "#ccc" }}>Spike Count: {spikeCount}</label>
                  <input type="range" min={1} max={20} step={1} value={spikeCount} onChange={(e) => setSpikeCount(parseInt(e.target.value))} style={{ width: "100%" }} />
                </div>
                <div style={{ marginBottom: 8 }}>
                  <label style={{ color: "#ccc" }}>Spike Size: {spikeSize}px</label>
                  <input type="range" min={10} max={50} step={1} value={spikeSize} onChange={(e) => setSpikeSize(parseInt(e.target.value))} style={{ width: "100%" }} />
                </div>
              </>
            )}

            {/* ---------- Boss-specific settings (superpowers) ---------- */}
            {arenaType === ARENA_TYPES.BOSS && (
              <div style={{ marginTop: 8 }}>
                <div style={{ marginBottom: 8 }}>
                  <label style={{ color: "#ccc", display: "block", marginBottom: 6 }}>Super Power</label>

                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                    <label style={{ color: "#ccc" }}>Enable Power:</label>
                    <input type="checkbox" checked={superpowerEnabled} onChange={(e) => setSuperpowerEnabled(e.target.checked)} style={{ marginLeft: 8 }} />
                  </div>

                  <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
                    <label style={{ color: "#ccc" }}>Powers:</label>
                    <label style={{ color: "#ccc", display: "flex", alignItems: "center", gap: 6 }}>
                      <input type="checkbox" checked={!!selectedPowers.flame} onChange={(e) => setSelectedPowers((s) => ({ ...s, flame: e.target.checked }))} />
                      Flame
                    </label>
                    <label style={{ color: "#ccc", display: "flex", alignItems: "center", gap: 6 }}>
                      <input type="checkbox" checked={!!selectedPowers.arrow} onChange={(e) => setSelectedPowers((s) => ({ ...s, arrow: e.target.checked }))} />
                      Arrow
                    </label>
                    <label style={{ color: "#ccc", display: "flex", alignItems: "center", gap: 6 }}>
                      <input type="checkbox" checked={!!selectedPowers.bullet} onChange={(e) => setSelectedPowers((s) => ({ ...s, bullet: e.target.checked }))} />
                      Bullet
                    </label>
                  </div>

                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                    <label style={{ color: "#ccc" }}>Mode:</label>
                    <label style={{ color: "#ccc", display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="radio" name="firemode" value="manual" checked={firingMode === "manual"} onChange={() => setFiringMode("manual")} />
                      Manual
                    </label>
                    <label style={{ color: "#ccc", display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="radio" name="firemode" value="auto" checked={firingMode === "auto"} onChange={() => setFiringMode("auto")} />
                      Auto (every 3s)
                    </label>
                  </div>

                  {/* Manual shoot button (uses selected powers; direction random) */}
                  <div style={{ marginTop: 8 }}>
                    <button
                      onClick={() => {
                        // manual shoot uses handleShoot which randomizes direction and power internally
                        handleShoot();
                      }}
                      disabled={!isRunning || !superBubble || !superpowerEnabled}
                      style={{ width: "100%", height: 36 }}
                    >
                      🔫 Shoot (Manual)
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Winner overlay */}
      {(winner || winnersList || winnersImages) && <WinnerOverlay winnerBubble={winner ?? undefined} winners={winnersList ?? undefined} winnersImgs={winnersImages ?? undefined} />}
    </div>
  );
};

export default ArenaPage;
