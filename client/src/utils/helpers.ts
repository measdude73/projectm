import type { BubbleData, Spike } from "../pages/ArenaPage";

export function getRandom(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

export const checkCollision = (b1: BubbleData, b2: BubbleData) => {
  const dx = b1.x - b2.x;
  const dy = b1.y - b2.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  return distance < b1.radius + b2.radius;
};

// function pointDistance(px: number, py: number, qx: number, qy: number): number {
//   return Math.sqrt((px - qx) ** 2 + (py - qy) ** 2);
// }

export function checkSpikeCollision(b: BubbleData, thorns: Spike[]): Spike | null {
  for (const thorn of thorns) {
    const { x, y, size, side } = thorn;
    let tipX = x, tipY = y;

    // Compute triangle tip coordinates
    switch (side) {
      case "top":
        tipX += size / 2;
        tipY += size;   // triangle tip downward
        break;
      case "bottom":
        tipX += size / 2;
        tipY -= size;   // triangle tip upward
        break;
      case "left":
        tipX += size;   
        tipY += size / 2; // tip rightward
        break;
      case "right":
        tipX -= size;
        tipY += size / 2; // tip leftward
        break;
    }

    const dx = b.x - tipX;
    const dy = b.y - tipY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Only bounce if bubble actually "touches" the tip
    if (dist <= b.radius + 2) { // +2 for tolerance
      return thorn;
    }
  }
  return null;
}


 
