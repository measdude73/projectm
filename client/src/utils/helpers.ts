// src/utils/helpers.ts
import type { BubbleData } from "../pages/ArenaPage";

export const getRandom = (min: number, max: number) =>
  Math.random() * (max - min) + min;

export const checkCollision = (b1: BubbleData, b2: BubbleData) => {
  const dx = b1.x - b2.x;
  const dy = b1.y - b2.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  return distance < b1.radius + b2.radius;
};

// ✅ Only return true when bubble overlaps an actual thorn spike
export const checkThornCollision = (
  b: BubbleData,
  arenaWidth: number,
  arenaHeight: number,
  thornSize: number = 30 // spike size
): boolean => {
  // treat spikes as little triangles/rectangles along edges instead of full walls

  // left spikes
  const leftHit =
    b.x - b.radius <= thornSize &&
    b.y % Math.floor(arenaHeight / 20) < thornSize;

  // right spikes
  const rightHit =
    b.x + b.radius >= arenaWidth - thornSize &&
    b.y % Math.floor(arenaHeight / 20) < thornSize;

  // top spikes
  const topHit =
    b.y - b.radius <= thornSize &&
    b.x % Math.floor(arenaWidth / 20) < thornSize;

  // bottom spikes
  const bottomHit =
    b.y + b.radius >= arenaHeight - thornSize &&
    b.x % Math.floor(arenaWidth / 20) < thornSize;

  return leftHit || rightHit || topHit || bottomHit;
};
