// src/utils/arenaShapes.ts

export type ArenaShapeType = "rectangle" | "circle" | "pentagon" | "hexagon";

interface ArenaShape {
  drawStyle: (width: number, height: number) => React.CSSProperties;
}

export const arenaShapes: Record<ArenaShapeType, ArenaShape> = {
  rectangle: {
    drawStyle: (width, height) => ({
      top: `${(height * 0.025)}px`,
      left: `${(width * 0.025)}px`,
      width: `${width * 0.95}px`,
      height: `${height * 0.95}px`,
      borderRadius: "8px",
    }),
  },
  circle: {
    drawStyle: (width, height) => {
      const size = Math.min(width, height) * 0.95;
      return {
        top: `${(height - size) / 2}px`,
        left: `${(width - size) / 2}px`,
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: "50%",
      };
    },
  },
  pentagon: {
    drawStyle: (width, height) => {
      const size = Math.min(width, height) * 0.45; // Ensures it fits
      const cx = width / 2;
      const cy = height / 2;
      const points = Array.from({ length: 5 }).map((_, i) => {
        const angle = (i * 2 * Math.PI) / 5 - Math.PI / 2;
        const x = cx + size * Math.cos(angle);
        const y = cy + size * Math.sin(angle);
        return `${x},${y}`;
      }).join(" ");
      return {
        top: "0px",
        left: "0px",
        width: `${width}px`,
        height: `${height}px`,
        clipPath: `polygon(${points})`,
        border: "4px solid black",
      };
    },
  },
  hexagon: {
    drawStyle: (width, height) => {
      const size = Math.min(width, height) * 0.45; // Ensures it fits
      const cx = width / 2;
      const cy = height / 2;
      const points = Array.from({ length: 6 }).map((_, i) => {
        const angle = (i * 2 * Math.PI) / 6 - Math.PI / 2;
        const x = cx + size * Math.cos(angle);
        const y = cy + size * Math.sin(angle);
        return `${x},${y}`;
      }).join(" ");
      return {
        top: "0px",
        left: "0px",
        width: `${width}px`,
        height: `${height}px`,
        clipPath: `polygon(${points})`,
        border: "4px solid black",
      };
    },
  },
};
