// src/pages/ArenaPage.tsx
import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import Bubble from "../components/Bubbles";
import { getRandom, checkCollision, checkThornCollision } from "../utils/helpers";
import ThornsOverlay from "../components/ThornsOverlay";

export interface BubbleData {
  x: number;
  y: number;
  radius: number;
  health: number;
  imgSrc: string;
  vx: number;
  vy: number;
}

export interface ThornsOverlayProps {
  arenaWidth: number;
  arenaHeight: number;
  thornCount: number;
}

const ArenaPage = () => {
  const speed = 3;
  const angle = getRandom(0, 2 * Math.PI);
  const navigate = useNavigate();

  const [thornCount, setThornCount] = useState(1);
  const [thornEnabled, setThornEnabled] = useState(false);

  const [bubbles, setBubbles] = useState<BubbleData[]>([]);
  const [speedMultiplier, setSpeedMultiplier] = useState(5);
  const [isRunning, setIsRunning] = useState(false);

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
    return { width: window.innerWidth * 0.9, height: window.innerHeight * 0.9 };
  };

  const getRadiusForCount = (count: number) => {
    if (count <= 100) return 50;
    if (count <= 1000) return 35;
    if (count <= 10000) return 25;
    return 15;
  };

  useEffect(() => {
    const fetchImages = async () => {
      try {
        const res = await fetch("http://localhost:5000/api/images");
        const images: string[] = await res.json();
        const newImages = images.filter(img => !imageListRef.current.includes(img));

        if (newImages.length > 0) {
          const arena = getArenaDimensions();
          const targetRadius = getRadiusForCount(images.length);
          const newBubbles = newImages.map(imgSrc => ({
            x: getRandom(targetRadius, arena.width - targetRadius),
            y: getRandom(targetRadius, arena.height - targetRadius),
            radius: targetRadius,
            health: 100,
            imgSrc: "http://localhost:5000" + imgSrc,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
          }));

          setBubbles(prev => {
            const updated = [...prev, ...newBubbles];
            const radiusAll = getRadiusForCount(updated.length);
            return updated.map(b => ({ ...b, radius: radiusAll }));
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

  useEffect(() => {
    if (!isRunning) return;

    const interval = setInterval(() => {
      setBubbles(prev => {
        const arena = getArenaDimensions();
        const updated = prev.map(b => {
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

        // bubble-bubble collisions
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

        // thorn collisions
        if (thornEnabled) {
          for (let i = 0; i < updated.length; i++) {
            const b = updated[i];
            if (checkThornCollision(b, arena.width, arena.height)) {
              updated[i].health = Math.max(updated[i].health - 5, 0);

              const hitAngle = getRandom(0, 2 * Math.PI);
              updated[i].vx = Math.cos(hitAngle) * speed;
              updated[i].vy = Math.sin(hitAngle) * speed;
            }
          }
        }

        const alive = updated.filter(b => b.health > 0);
        const targetRadius = getRadiusForCount(alive.length);
        return alive.map(b => ({ ...b, radius: targetRadius }));
      });
    }, 50);

    return () => clearInterval(interval);
  }, [speedMultiplier, isRunning, thornEnabled]);

  return (
    <div className="flex h-screen w-screen bg-gray-900 text-white">
      <div ref={arenaRef} className="arena relative">
        <div className="bubble-container">
          {bubbles.map((bubble, idx) => <Bubble key={idx} {...bubble} />)}
        </div>

        {thornEnabled && (
          <ThornsOverlay 
            arenaWidth={arenaRef.current?.clientWidth || 0} 
            arenaHeight={arenaRef.current?.clientHeight || 0} 
            thornCount={thornCount} 
          />
        )}
      </div>

      <div className="sidebar">
        <h2 className="text-xl font-bold mb-4">Controls</h2>
        <div>
          <label className="block mb-1">Speed: {speedMultiplier.toFixed(1)}x</label>
          <input
            type="range"
            min="0.5"
            max="15"
            step="0.1"
            value={speedMultiplier}
            onChange={e => setSpeedMultiplier(parseFloat(e.target.value))}
            className="w-full"
          />
        </div>

        <div className="mt-4">
          <label className="block mb-1">Enable Thorns:</label>
          <input 
            type="checkbox" 
            checked={thornEnabled} 
            onChange={e => setThornEnabled(e.target.checked)} 
            className="mr-2"
          />
        </div>

        {thornEnabled && (
          <div className="mt-2">
            <label className="block mb-1">Thorn Count: {thornCount}</label>
            <input
              type="range"
              min="1"
              max="20"
              step="1"
              value={thornCount}
              onChange={e => setThornCount(parseInt(e.target.value))}
              className="w-full"
            />
          </div>
        )}

        <button
          onClick={() => setIsRunning(true)}
          disabled={isRunning}
          className={`w-full mt-6 py-2 ${isRunning ? "bg-gray-500 cursor-not-allowed" : "bg-green-600 hover:bg-green-700"}`}
        >
          Start
        </button>

        <button
          onClick={() => navigate("/menu")}
          className="w-full mt-2 py-2 bg-red-600 hover:bg-red-700"
        >
          Back to Menu
        </button>
      </div>
    </div>
  );
};

export default ArenaPage;
