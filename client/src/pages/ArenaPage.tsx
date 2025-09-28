// ArenaPage.tsx
import React, { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import Bubble from "../components/Bubbles";
import {
  getRandom,
  checkCollision,
  checkSpikeCollision,
} from "../utils/helpers";
import "../App.css";

export interface BubbleData {
  x: number;
  y: number;
  radius: number;
  health: number;
  imgSrc: string;
  vx: number;
  vy: number;
  pendingDamage?: number;
}

export interface Spike {
  side: string;
  x: number;
  y: number;
  size: number;
}

const ArenaPage = () => {
  const speed = 3;
  const angle = getRandom(0, 2 * Math.PI);
  const navigate = useNavigate();

  const [spikeCount, setSpikeCount] = useState(1);
  const [spikeEnabled, setSpikeEnabled] = useState(false);
  const [spikeSize, setSpikeSize] = useState(30);
  const [spikePositions, setSpikePositions] = useState<Omit<Spike, "size">[]>(
    []
  );
  const [bubbles, setBubbles] = useState<BubbleData[]>([]);
  const [speedMultiplier, setSpeedMultiplier] = useState(2.5);
  const [isRunning, setIsRunning] = useState(false);
  const [winner, setWinner] = useState<BubbleData | null>(null);
  const [controlsOpen, setControlsOpen] = useState(false);

  const arenaRef = useRef<HTMLDivElement>(null);
  const imageListRef = useRef<string[]>([]);

  const getArenaDimensions = () => {
    const arena = arenaRef.current;
    if (arena) {
      return {
        width: arena.clientWidth,
        height: arena.clientHeight,
      };
    }
    return {
      width: window.innerWidth * 0.9,
      height: window.innerHeight * 0.9,
    };
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

  // Spike generator
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
      const side = sides[Math.floor(Math.random() * 4)];
      let x = 0,
        y = 0;
      let attempts = 0;
      let valid = false;
      while (!valid && attempts < maxAttempts) {
        attempts++;
        if (side === "top") {
          x = Math.random() * (arena.width - minDist);
          y = 0;
          valid = newPositions
            .filter((t) => t.side === "top")
            .every((t) => Math.abs(x - t.x) > minDist);
        } else if (side === "bottom") {
          x = Math.random() * (arena.width - minDist);
          y = arena.height;
          valid = newPositions
            .filter((t) => t.side === "bottom")
            .every((t) => Math.abs(x - t.x) > minDist);
        } else if (side === "left") {
          x = 0;
          y = Math.random() * (arena.height - minDist);
          valid = newPositions
            .filter((t) => t.side === "left")
            .every((t) => Math.abs(y - t.y) > minDist);
        } else if (side === "right") {
          x = arena.width;
          y = Math.random() * (arena.height - minDist);
          valid = newPositions
            .filter((t) => t.side === "right")
            .every((t) => Math.abs(y - t.y) > minDist);
        }
      }
      if (valid) newPositions.push({ side, x, y });
    }
    setSpikePositions(newPositions);
  }, [
    spikeCount,
    spikeEnabled,
    arenaRef.current?.clientWidth,
    arenaRef.current?.clientHeight,
  ]);

  const spikes: Spike[] = spikePositions.map((pos) => ({
    ...pos,
    size: spikeSize,
  }));

  // Images fetch
  useEffect(() => {
    const fetchImages = async () => {
      try {
        const res = await fetch("http://localhost:5000/api/images");
        const images: string[] = await res.json();
        const newImages = images.filter(
          (img) => !imageListRef.current.includes(img)
        );
        if (newImages.length > 0) {
          const arena = getArenaDimensions();
          const targetRadius = getRadiusForCount(images.length);

          const newBubbles: BubbleData[] = [];
          const allExisting = [...bubbles];
          for (const imgSrc of newImages) {
            let tries = 0;
            let x = 0;
            let y = 0;
            let valid = false;

            while (!valid && tries < 100) {
              tries++;
              x = getRandom(targetRadius, arena.width - targetRadius);
              y = getRandom(targetRadius, arena.height - targetRadius);
              valid = true;

              for (const b of [...allExisting, ...newBubbles]) {
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
              imgSrc: "http://localhost:5000" + imgSrc,
              vx: Math.cos(angle) * speed,
              vy: Math.sin(angle) * speed,
            });
          }

          setBubbles((prev) => {
            const updated = [...prev, ...newBubbles];
            const radiusAll = getRadiusForCount(updated.length);
            return updated.map((b) => ({ ...b, radius: radiusAll }));
          });
          imageListRef.current = images;
        }
      } catch (err) {
        console.error(err);
      }
    };
    fetchImages();
    const interval = setInterval(fetchImages, 2000);
    return () => clearInterval(interval);
  }, []);

  // Game loop
  useEffect(() => {
    if (!isRunning || winner) return;
    const interval = setInterval(() => {
      setBubbles((prev) => {
        const arena = getArenaDimensions();
        const updated = prev.map((b) => {
          let newX = b.x + b.vx * speedMultiplier;
          let newY = b.y + b.vy * speedMultiplier;
          let vx = b.vx;
          let vy = b.vy;

          if (newX - b.radius <= 0) {
            newX = b.radius;
            vx = Math.abs(vx);
          }
          if (newX + b.radius >= arena.width) {
            newX = arena.width - b.radius;
            vx = -Math.abs(vx);
          }
          if (newY - b.radius <= 0) {
            newY = b.radius;
            vy = Math.abs(vy);
          }
          if (newY + b.radius >= arena.height) {
            newY = arena.height - b.radius;
            vy = -Math.abs(vy);
          }
          return { ...b, x: newX, y: newY, vx, vy };
        });

        // Bubble-bubble collisions
        for (let i = 0; i < updated.length; i++) {
          for (let j = i + 1; j < updated.length; j++) {
            if (checkCollision(updated[i], updated[j])) {
              updated[i].vx *= -1;
              updated[i].vy *= -1;
              updated[j].vx *= -1;
              updated[j].vy *= -1;

              updated[i].health = Math.max(updated[i].health - 10, 0);
              updated[j].health = Math.max(updated[j].health - 10, 0);
            }
          }
        }

        // Spike collisions
        if (spikeEnabled) {
          for (let i = 0; i < updated.length; i++) {
            const b = updated[i];
            const hitSpike = checkSpikeCollision(b, spikes);
            if (hitSpike) {
              updated[i].health = Math.max(updated[i].health - 20, 0);

              const speedMag = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
              const randomAngle = Math.random() * 2 * Math.PI;

              let pushX = 0;
              let pushY = 0;
              switch (hitSpike.side) {
                case "top":
                  pushY = 1;
                  break;
                case "bottom":
                  pushY = -1;
                  break;
                case "left":
                  pushX = 1;
                  break;
                case "right":
                  pushX = -1;
                  break;
              }

              const pushDistance = b.radius * 0.8;
              updated[i].x += pushX * pushDistance;
              updated[i].y += pushY * pushDistance;

              updated[i].vx = speedMag * Math.cos(randomAngle);
              updated[i].vy = speedMag * Math.sin(randomAngle);
            }
          }
        }

        // Winner check
        const alive = updated.filter((b) => b.health > 0);
        if (alive.length === 1) {
          setWinner(alive[0]);
          setIsRunning(false);
          return alive;
        }

        const targetRadius = getRadiusForCount(alive.length);
        return alive.map((b) => ({ ...b, radius: targetRadius }));
      });
    }, 50);
    return () => clearInterval(interval);
  }, [speedMultiplier, isRunning, spikeEnabled, spikes, winner]);

  // Leaderboard
  const leaderboard = [...bubbles]
    .sort((a, b) => b.health - a.health)
    .slice(0, 12);

  return (
    <div className="arena-page">
      {/* Sliding Controls Drawer */}
      <div
        className={`controls-drawer ${
          controlsOpen ? "drawer-open" : "drawer-closed"
        }`}
      >
        <div className="controls-inner">
          <h2 className="controls-title">Controls</h2>
          <div>
            <label className="block mb-1">
              Speed: {speedMultiplier.toFixed(1)}x
            </label>
            <input
              type="range"
              min="0.5"
              max="15"
              step="0.1"
              value={speedMultiplier}
              onChange={(e) => setSpeedMultiplier(parseFloat(e.target.value))}
              className="slider"
            />
          </div>
          <div className="mt-4">
            <label className="block mb-1">Enable Spikes:</label>
            <input
              type="checkbox"
              checked={spikeEnabled}
              onChange={(e) => setSpikeEnabled(e.target.checked)}
              className="mr-2"
            />
          </div>
          {spikeEnabled && (
            <>
              <div className="mt-2">
                <label className="block mb-1">Spike Count: {spikeCount}</label>
                <input
                  type="range"
                  min="1"
                  max="20"
                  step="1"
                  value={spikeCount}
                  onChange={(e) => setSpikeCount(parseInt(e.target.value))}
                  className="slider"
                />
              </div>
              <div className="mt-4">
                <label className="block mb-1">Spike Size: {spikeSize}px</label>
                <input
                  type="range"
                  min="10"
                  max="50"
                  step="1"
                  value={spikeSize}
                  onChange={(e) => setSpikeSize(parseInt(e.target.value))}
                  className="slider"
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Toggle Button + Start Button */}
      <div className="controls-toggle">
        <button
          onClick={() => setControlsOpen(!controlsOpen)}
          className="settings-btn"
        >
          ⚙️
        </button>
        <button
          onClick={() => setIsRunning(true)}
          disabled={isRunning}
          className={`play-btn ${isRunning ? "play-disabled" : ""}`}
        >
          ▶
        </button>
      </div>

      {/* Arena + Leaderboard container */}
      <div className="arena-wrapper">
        <div className="arena-container">
          {/* Arena */}
          <div
            ref={arenaRef}
            className={`arena ${winner ? "arena-blur" : ""}`}
          >
            <div className="bubble-container">
              {bubbles.map((bubble, idx) => (
                <Bubble key={idx} {...bubble} />
              ))}
            </div>

            {spikeEnabled &&
              spikes.map((spike, i) => {
                let points = "";
                const w = spike.size;
                const h = spike.size;
                let style: React.CSSProperties = {
                  position: "absolute",
                  pointerEvents: "none",
                };
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
                } else if (spike.side === "right") {
                  style.left = spike.x - w;
                  style.top = spike.y;
                  points = `${w},0 ${w},${h} 0,${h / 2}`;
                }
                return (
                  <svg key={`spike-${i}`} width={w} height={h} style={style}>
                    <polygon points={points} fill="white" />
                  </svg>
                );
              })}
          </div>

          {/* Leaderboard */}
          <div className="leaderboard">
            <h2 className="leaderboard-title">Leaderboard🏆</h2>
            <ul className="leaderboard-list">
              {leaderboard.map((b, idx) => (
                <li key={idx} className="leaderboard-item">
                  <img
                    src={b.imgSrc}
                    alt="player"
                    className="leaderboard-img"
                  />
                  <span className="leaderboard-name">
                    {b.imgSrc.split("/").pop()}
                  </span>
                  <span>{b.health}hp</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Winner Modal */}
      {winner && (
        <div className="winner-modal">
          <div className="relative">
            <div className="winner-bubble">
              <img
                src={winner.imgSrc}
                alt="Winner"
                className="winner-img"
              />
            </div>
            <div className="absolute inset-0 flex items-center justify-center">
              <h1 className="winner-text">Winner!</h1>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ArenaPage;
