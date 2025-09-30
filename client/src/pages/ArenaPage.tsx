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

const SUPER_BUBBLE_HEALTH = 250;

let nextBubbleId = 1;
let nextProjectileId = 1;

const ArenaPage: React.FC = () => {
  const speed = 3;

  // refs & state
  const arenaRef = useRef<HTMLDivElement | null>(null);
  const imageListRef = useRef<string[]>([]);
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

  // spikes / controls
  const [spikeEnabled, setSpikeEnabled] = useState(false);
  const [spikeCount, setSpikeCount] = useState(1);
  const [spikeSize, setSpikeSize] = useState(30);
  const [spikePositions, setSpikePositions] = useState<Omit<Spike, "size">[]>([]);

  const [speedMultiplier, setSpeedMultiplier] = useState(2.5);
  const [controlsOpen, setControlsOpen] = useState(false);

  // -------------------- helpers --------------------
  const getArenaDimensions = () => {
    const arena = arenaRef.current;
    if (arena) {
      return { width: arena.clientWidth, height: arena.clientHeight };
    }
    return { width: window.innerWidth * 0.9, height: window.innerHeight * 0.9 };
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
  }, [spikeEnabled, spikeCount, arenaRef.current?.clientWidth, arenaRef.current?.clientHeight]);

  const spikes: Spike[] = spikePositions.map((p) => ({ ...p, size: spikeSize }));

  // -------------------- robust spike-hit detection helper --------------------
  // We detect spike hits ourselves based on spike placement (top/bottom/left/right).
  const detectSpikeHit = (b: BubbleData) => {
    const arena = getArenaDimensions();
    for (const s of spikes) {
      const size = s.size;
      if (s.side === "top") {
        const sx = s.x;
        const sy = 0;
        // spike triangular area spans x:[sx, sx+size], y:[0,size]
        if (b.x >= sx - b.radius && b.x <= sx + size + b.radius && b.y - b.radius <= sy + size) {
          // ensure overlapping in y
          if (b.y - b.radius <= size) return s;
        }
      } else if (s.side === "bottom") {
        const sx = s.x;
        const sy = getArenaDimensions().height;
        if (b.x >= sx - b.radius && b.x <= sx + size + b.radius && b.y + b.radius >= sy - size) {
          if (b.y + b.radius >= sy - size) return s;
        }
      } else if (s.side === "left") {
        const sx = 0;
        const sy = s.y;
        if (b.y >= sy - b.radius && b.y <= sy + s.size + b.radius && b.x - b.radius <= sx + s.size) {
          if (b.x - b.radius <= size) return s;
        }
      } else if (s.side === "right") {
        const sx = getArenaDimensions().width;
        const sy = s.y;
        if (b.y >= sy - b.radius && b.y <= sy + s.size + b.radius && b.x + b.radius >= sx - s.size) {
          if (b.x + b.radius >= sx - size) return s;
        }
      }
    }
    return null;
  };

  // -------------------- load images for selected arena --------------------
  useLayoutEffect(() => {
    if (!arenaType) return;
    if (isRunning) return; // don't modify while running

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
          imageListRef.current = images;
        } catch (e) {
          console.error("Error fetching normal images", e);
        }
      } else {
        // boss arena
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
          imageListRef.current = images;
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

  // -------------------- assign movement when game starts --------------------
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

  // -------------------- super bubble bounce movement --------------------
  useEffect(() => {
    if (arenaType !== ARENA_TYPES.BOSS || !isRunning || !superBubble) return;
    const t = setInterval(() => {
      setSuperBubble((sb) => {
        if (!sb) return sb;
        const arena = getArenaDimensions();
        let nx = sb.x + sb.vx * speedMultiplier;
        let ny = sb.y + sb.vy * speedMultiplier;
        let nvx = sb.vx;
        let nvy = sb.vy;
        if (nx - sb.radius <= 0) {
          nx = sb.radius;
          nvx = Math.abs(nvx);
        }
        if (nx + sb.radius >= arena.width) {
          nx = arena.width - sb.radius;
          nvx = -Math.abs(nvx);
        }
        if (ny - sb.radius <= 0) {
          ny = sb.radius;
          nvy = Math.abs(nvy);
        }
        if (ny + sb.radius >= arena.height) {
          ny = arena.height - sb.radius;
          nvy = -Math.abs(nvy);
        }
        return { ...sb, x: nx, y: ny, vx: nvx, vy: nvy };
      });
    }, 50);
    return () => clearInterval(t);
  }, [arenaType, isRunning, superBubble, speedMultiplier]);

  // -------------------- main game loop --------------------
  useEffect(() => {
    if (!isRunning || !arenaType) return;
    const loop = setInterval(() => {
      setBubbles((prev) => {
        const arena = getArenaDimensions();

        // 1) move & bounce
        let moved = prev.map((b) => {
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

        // 2) normal vs normal collisions
        for (let i = 0; i < moved.length; i++) {
          for (let j = i + 1; j < moved.length; j++) {
            const a = moved[i];
            const c = moved[j];
            if (checkCollision(a, c)) {
              // bounce
              moved[i].vx *= -1;
              moved[i].vy *= -1;
              moved[j].vx *= -1;
              moved[j].vy *= -1;

              // separation
              const dx = a.x - c.x;
              const dy = a.y - c.y;
              const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
              const overlap = Math.max(0, a.radius + c.radius - dist);
              if (overlap > 0) {
                const pushX = (dx / dist) * (overlap / 2);
                const pushY = (dy / dist) * (overlap / 2);
                moved[i].x += pushX;
                moved[i].y += pushY;
                moved[j].x -= pushX;
                moved[j].y -= pushY;
              }

              // damage rules
              if (arenaType === ARENA_TYPES.NORMAL) {
                moved[i].health = Math.max(moved[i].health - 10, 0);
                moved[j].health = Math.max(moved[j].health - 10, 0);
              } // else BOSS arena -> no health reduction between normals
            }
          }
        }

        // 3) spikes (robust detection + bounce away)
        if (spikeEnabled) {
          for (let i = 0; i < moved.length; i++) {
            const b = moved[i];
            const hit = detectSpikeHit(b);
            if (hit) {
              // damage once per loop when overlapping
              moved[i].health = Math.max(moved[i].health - 20, 0);

              // bounce away from spike based on its side -- stronger push to avoid sliding
              const pushDistance = b.radius * 1.1;
              let pushX = 0;
              let pushY = 0;
              if (hit.side === "top") {
                pushY = 1;
                // place bubble just below spike area
                moved[i].y = Math.max(moved[i].y, hit.size + b.radius + 2);
              } else if (hit.side === "bottom") {
                pushY = -1;
                moved[i].y = Math.min(moved[i].y, getArenaDimensions().height - hit.size - b.radius - 2);
              } else if (hit.side === "left") {
                pushX = 1;
                moved[i].x = Math.max(moved[i].x, hit.size + b.radius + 2);
              } else if (hit.side === "right") {
                pushX = -1;
                moved[i].x = Math.min(moved[i].x, getArenaDimensions().width - hit.size - b.radius - 2);
              } else {
                // fallback random push
                const a = Math.random() * Math.PI * 2;
                pushX = Math.cos(a);
                pushY = Math.sin(a);
              }

              // set velocity away from spike to avoid re-entry
              const spd = Math.max(1, Math.sqrt(b.vx * b.vx + b.vy * b.vy));
              const angle = Math.atan2(pushY || (Math.random() - 0.5), pushX || (Math.random() - 0.5));
              moved[i].vx = Math.cos(angle) * spd;
              moved[i].vy = Math.sin(angle) * spd;
            }
          }
        }
// 4) boss-specific: normal vs super collisions
if (arenaType === ARENA_TYPES.BOSS && superBubble) {
  let collisionCount = 0;
  moved = moved.map((mb) => {
    if (checkCollision(mb, superBubble)) {
      collisionCount++;
      // normal loses 10% of current health
      const newH = Math.max(mb.health - mb.health * 0.1, 0);
      const dx = mb.x - superBubble.x;
      const dy = mb.y - superBubble.y;
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const pushAmount = 6;
      return {
        ...mb,
        health: newH,
        x: mb.x + (dx / dist) * pushAmount,
        y: mb.y + (dy / dist) * pushAmount,
        vx: -mb.vx,
        vy: -mb.vy,
      };
    }
    return mb;
  });
  if (collisionCount > 0) {
    setSuperBubble((sb) => {
      if (!sb) return sb;
      let newHealth = sb.health;
      for (let k = 0; k < collisionCount; k++) {
        newHealth = Math.max(newHealth - newHealth * 0.15, 0);
      }
      return { ...sb, health: newHealth };
    });
  }
}

        // 5) projectiles move + hits (projectiles only damage normal bubbles)
        if (projectiles.length > 0) {
          const arenaW = arena.width;
          const arenaH = arena.height;
          const nextProjectiles: typeof projectiles = [];
          for (const p of projectiles) {
            const nx = p.x + p.vx;
            const ny = p.y + p.vy;
            if (nx < 0 || ny < 0 || nx > arenaW || ny > arenaH) continue;
            let hit = false;
            for (let i = 0; i < moved.length; i++) {
              const bub = moved[i];
              const dx = bub.x - nx;
              const dy = bub.y - ny;
              if (Math.sqrt(dx * dx + dy * dy) < bub.radius) {
                const power = SUPER_BUBBLE_TYPES[p.type];
                moved[i].health = Math.max(moved[i].health - power.damage, 0);
                hit = true;
                break;
              }
            }
            if (!hit) nextProjectiles.push({ ...p, x: nx, y: ny });
          }
          setProjectiles(nextProjectiles);
        }

// 6) remove popped normal bubbles
let alive = moved.filter((b) => b.health > 0);

// 7) winner logic (use updated health snapshot, not stale state)
let sbNow = superBubble;
if (sbNow && sbNow.health <= 0) {
  sbNow = null; // mark dead
}

if (arenaType === ARENA_TYPES.BOSS) {
  if (!sbNow) {
    if (alive.length > 0) {
      setWinner(alive[0]); // normals win
    } else {
      setWinner(null); // draw
    }
    setIsRunning(false);
    setSuperBubble(null);
    return alive;
  }

  if (sbNow && alive.length === 0) {
    setWinner(sbNow); // superbubble wins
    setIsRunning(false);
    return [];
  }
}


        if (arenaType === ARENA_TYPES.NORMAL) {
          if (alive.length === 1) {
            setWinner(alive[0]);
            setIsRunning(false);
            return alive;
          }
        }

        // resize radius based on alive count
        const targetRadius = getRadiusForCount(alive.length);
        alive = alive.map((b) => ({ ...b, radius: targetRadius }));
        return alive;
      });
    }, 50);

    return () => clearInterval(loop);
  }, [isRunning, arenaType, spikeEnabled, spikeCount, spikeSize, projectiles, superBubble, speedMultiplier]);

  // -------------------- manual Shoot (fires one projectile in a random direction) --------------------
  const handleShoot = () => {
    if (!superBubble || arenaType !== ARENA_TYPES.BOSS || !isRunning) return;
    nextProjectileId++;
    const angle = Math.random() * Math.PI * 2;
    const sp = 7 + Math.random() * 3;
    const vx = Math.cos(angle) * sp;
    const vy = Math.sin(angle) * sp;
    setProjectiles((p) => [...p, { id: nextProjectileId, x: superBubble.x, y: superBubble.y, vx, vy, type: superBubbleType }]);
  };

  // -------------------- Reset & Back helpers --------------------
  const resetArenaKeepType = () => {
    setIsRunning(false);
    setWinner(null);
    setBubbles([]);
    setSuperBubble(null);
    setProjectiles([]);
    imageListRef.current = [];
    bossImgRef.current = "";
  };

  const resetArenaKeepTypePublic = () => {
    resetArenaKeepType();
    setTimeout(() => {
      setWinner(null);
      setIsRunning(false);
    }, 0);
  };

  const handleBack = () => {
    // send back to selection screen and clear internal state
    setIsRunning(false);
    setWinner(null);
    setBubbles([]);
    setSuperBubble(null);
    setProjectiles([]);
    imageListRef.current = [];
    bossImgRef.current = "";
    setArenaType(null);
  };

  // -------------------- Rendering helpers --------------------
  // Normal/Boss bubble component expects health 0-100 for color logic; for superbubble we show its own bar,
  // but still normalize health passed to Bubble component so its ring color behaves correctly.
  const normalizedHealthForBubble = (b: BubbleData | null) => {
    if (!b) return 0;
    if (b === superBubble) {
      // superbubble health (0..SUPER_BUBBLE_HEALTH) -> convert to 0..100
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
        {/* pass a normalized health so the ring color works */}
        <Bubble {...{ ...superBubble, health: normalizedHealthForBubble(superBubble) }} />
      </>
    );
  };

  const renderProjectileVisual = (p: { id: number; x: number; y: number; type: keyof typeof SUPER_BUBBLE_TYPES }) => {
    // SVG visuals: flame, arrow, bullet (realistic-ish)
    if (p.type === "flame") {
      return (
        <svg key={p.id} width={20} height={28} style={{ position: "absolute", left: p.x, top: p.y, transform: "translate(-50%,-50%)", zIndex: 1200 }}>
          <defs>
            <linearGradient id={`g${p.id}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#fff59d" />
              <stop offset="60%" stopColor="#ffb74d" />
              <stop offset="100%" stopColor="#ff7043" />
            </linearGradient>
          </defs>
          <path d="M10 0 C 14 8, 6 12, 10 28" fill={`url(#g${p.id})`} />
        </svg>
      );
    } else if (p.type === "arrow") {
      return (
        <svg key={p.id} width={28} height={8} style={{ position: "absolute", left: p.x, top: p.y, transform: "translate(-50%,-50%)", zIndex: 1200 }}>
          <rect x={0} y={3} width={20} height={2} fill="#7b5a3a" />
          <polygon points="20,0 28,4 20,8" fill="#333" />
        </svg>
      );
    } else {
      // bullet
      return (
        <svg key={p.id} width={12} height={12} style={{ position: "absolute", left: p.x, top: p.y, transform: "translate(-50%,-50%)", zIndex: 1200 }}>
          <circle cx={6} cy={6} r={6} fill="#ffd54f" stroke="#ff9800" strokeWidth={1} />
        </svg>
      );
    }
  };

  // ---------- Leaderboard (top 10) - fixed alignment and cup icon ----------
  const renderLeaderboardNormal = () => {
    const top = [...bubbles].sort((a, b) => b.health - a.health).slice(0, 10);
    return (
      <div style={{ width: "100%", padding: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <div style={{ fontSize: 16 }}>🏆</div>
          <h3 style={{ margin: 0, color: "#ddd" }}>Leaderboard</h3>
        </div>
        <div>
          {top.map((entry) => (
            <div key={entry.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
              <img src={entry.imgSrc} alt="player" style={{ width: 44, height: 44, borderRadius: 8, objectFit: "cover" }} />
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ color: "#fff", fontSize: 13 }}>{entry.imgSrc.split("/").pop()}</div>
                <div style={{ color: entry.health > 60 ? "green" : entry.health > 30 ? "yellow" : "red", fontSize: 12 }}>{Math.round(entry.health)} hp</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // ---------- Boss VS card (same position/size as leaderboard) ----------
  const renderBossVersusCard = () => {
    const leftNormals = bubbles.slice(0, 10); // show up to 10 vertically if available
    const sbPct = superBubble ? Math.max(0, Math.round((superBubble.health / SUPER_BUBBLE_HEALTH) * 100)) : 0;
    return (
      <div style={{ width: "100%", padding: 8 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {/* normals vertical list: photo left, name and health to the right, stacked top->down */}
          {leftNormals.map((n) => (
            <div key={n.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <img src={n.imgSrc} alt="n" style={{ width: 44, height: 44, borderRadius: 8, objectFit: "cover" }} />
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ color: "#fff", fontSize: 13 }}>{n.imgSrc.split("/").pop()}</div>
                <div style={{ color: n.health > 60 ? "green" : n.health > 30 ? "yellow" : "red", fontSize: 12 }}>{Math.round(n.health)} hp</div>
              </div>
            </div>
          ))}

          {/* centered VS */}
          <div style={{ width: "100%", textAlign: "center", marginTop: 6, marginBottom: 6 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#fff" }}>VS</div>
          </div>

          {/* superbubble at bottom of same box */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
            <img src={superBubble?.imgSrc} alt="super" style={{ width: 64, height: 64, borderRadius: 10, objectFit: "cover" }} />
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ color: "#fff", fontSize: 13 }}>Super Bubble</div>
              <div style={{ color: sbPct > 60 ? "green" : sbPct > 30 ? "yellow" : "red", fontSize: 12 }}>{sbPct}%</div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // -------------------- Winner UI (blur + bubble zoom center + winner text above) --------------------
  const WinnerOverlay: React.FC<{ winnerBubble: BubbleData }> = ({ winnerBubble }) => {
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
            // clicking overlay resets to arena selection screen (like previous "OK")
            resetArenaKeepType();
            setArenaType(null);
            setWinner(null);
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
            <div ref={arenaRef} className={`arena ${winner ? "arena-blur" : ""}`} style={{ position: "relative" }}>
              <div className="bubble-container" style={{ position: "relative", width: "100%", height: "100%" }}>
                {bubbles.map((b) => (
                  // pass normalized health to Bubble component: normal (0-100) and superbubble is normalized elsewhere
                  <Bubble key={b.id} {...{ ...b, health: Math.max(0, Math.min(100, b.health)) }} />
                ))}

                {arenaType === ARENA_TYPES.BOSS && renderSuperBubbleWithHealth()}

                {projectiles.map((p) => renderProjectileVisual(p))}
              </div>

              {/* spikes */}
              {spikeEnabled &&
                spikes.map((spike, i) => {
                  const w = spike.size;
                  const h = spike.size;
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
                  // >>> SPIKE COLOR = WHITE as requested
                  return (
                    <svg key={`spike-${i}`} width={w} height={h} style={style}>
                      <polygon points={points} fill="#fff" />
                    </svg>
                  );
                })}
            </div>

            {/* leaderboard or vs card */}
            <div className="leaderboard" style={{ marginTop: 8 }}>
              {arenaType === ARENA_TYPES.BOSS ? (
                renderBossVersusCard()
              ) : (
                <>
                  {/* Leaderboard header + cup aligned */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <div style={{ fontSize: 16 }}>🏆</div>
                    <h2 className="leaderboard-title" style={{ margin: 0 }}>
                      Leaderboard
                    </h2>
                  </div>

                  <div style={{ maxHeight: 380 }}>
                    <ul className="leaderboard-list" style={{ listStyle: "none", padding: 0, margin: 0 }}>
                      {[...bubbles]
                        .sort((a, b) => b.health - a.health)
                        .slice(0, 10)
                        .map((entry, idx) => (
                          <li key={idx} className="leaderboard-item" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                            <img src={entry.imgSrc} alt="player" className="leaderboard-img" style={{ width: 30, height: 30, borderRadius: 8, objectFit: "cover" }} />
                             <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                               <span className="leaderboard-name">{entry.imgSrc.split("/").pop()}</span>
                              <span style={{ color: entry.health > 60 ? "green" : entry.health > 30 ? "yellow" : "red", fontSize: 12 }}>{Math.round(entry.health)} hp</span>
                            </div>
                          </li>
                        ))}
                    </ul>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* sidebar controls */}
      <div style={{ width: 220, minWidth: 180, display: "flex", flexDirection: "column", alignItems: "center", marginTop: 48, position: "relative", zIndex: 41, background: "rgba(24,24,24,0.95)", borderRadius: 16, padding: 12 }}>
        <button onClick={() => setIsRunning(true)} disabled={isRunning} style={{ width: 160, height: 40, marginBottom: 12 }}>
          ▶ Play
        </button>

        <button onClick={() => setControlsOpen((s) => !s)} style={{ width: 160, height: 40, marginBottom: 12 }}>
          ⚙️ Settings
        </button>

        <button onClick={handleBack} disabled={isRunning} style={{ width: 160, height: 40, marginBottom: 12 }}>
          ⬅ Back
        </button>

        <button onClick={resetArenaKeepTypePublic} disabled={!winner} style={{ width: 160, height: 40, marginBottom: 12 }}>
          🔄 Reset
        </button>

        <div style={{ width: "100%", position: "relative", zIndex: 35 }}>
          <div style={{ display: controlsOpen ? "block" : "none", paddingTop: 10, color: "#ddd" }}>
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

            {arenaType === ARENA_TYPES.BOSS && (
              <div style={{ marginTop: 8 }}>
                <label style={{ color: "#ccc" }}>Super Bubble Type:</label>
                <select value={superBubbleType} onChange={(e) => setSuperBubbleType(e.target.value as keyof typeof SUPER_BUBBLE_TYPES)} style={{ width: "100%", marginTop: 6 }}>
                  {Object.keys(SUPER_BUBBLE_TYPES).map((k) => (
                    <option key={k} value={k}>
                      {k.charAt(0).toUpperCase() + k.slice(1)}
                    </option>
                  ))}
                </select>

                <div style={{ marginTop: 8 }}>
                  <button onClick={handleShoot} disabled={!isRunning || !superBubble} style={{ width: "100%", height: 36 }}>
                    🔫 Shoot
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Winner overlay */}
      {winner && <WinnerOverlay winnerBubble={winner} />}
    </div>
  );
};

export default ArenaPage;
