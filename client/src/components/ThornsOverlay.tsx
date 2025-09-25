// src/components/ThornsOverlay.tsx
import React from "react";

interface ThornsOverlayProps {
  arenaWidth: number;
  arenaHeight: number;
  thornCount: number;
}

const ThornsOverlay: React.FC<ThornsOverlayProps> = ({ arenaWidth, arenaHeight, thornCount }) => {
  const sides = ["top", "right", "bottom", "left"];

  // Generate thorn positions once and store them (fixed placement)
  const thornPositions = React.useMemo(() => {
    const thorns = [];
    for (let i = 0; i < thornCount; i++) {
      const side = sides[Math.floor(Math.random() * sides.length)];
      const size = 20 + Math.random() * 10; // Variation in size
      
      let style: React.CSSProperties = {};

      if (side === "top") {
        style = {
          position: "absolute",
          top: 0,
          left: Math.random() * (arenaWidth - size),
          width: 0,
          height: 0,
          borderLeft: `${size / 2}px solid transparent`,
          borderRight: `${size / 2}px solid transparent`,
          borderTop: `${size}px solid black`,
        };
      } else if (side === "bottom") {
        style = {
          position: "absolute",
          bottom: 0,
          left: Math.random() * (arenaWidth - size),
          width: 0,
          height: 0,
          borderLeft: `${size / 2}px solid transparent`,
          borderRight: `${size / 2}px solid transparent`,
          borderBottom: `${size}px solid black`,
        };
      } else if (side === "left") {
        style = {
          position: "absolute",
          left: 0,
          top: Math.random() * (arenaHeight - size),
          width: 0,
          height: 0,
          borderTop: `${size / 2}px solid transparent`,
          borderBottom: `${size / 2}px solid transparent`,
          borderLeft: `${size}px solid black`,
        };
      } else if (side === "right") {
        style = {
          position: "absolute",
          right: 0,
          top: Math.random() * (arenaHeight - size),
          width: 0,
          height: 0,
          borderTop: `${size / 2}px solid transparent`,
          borderBottom: `${size / 2}px solid transparent`,
          borderRight: `${size}px solid black`,
        };
      }

      thorns.push(
        <div key={i} style={style} />
      );
    }
    return thorns;
  }, [arenaWidth, arenaHeight, thornCount]);

  return (
    <div className="absolute top-0 left-0 w-full h-full pointer-events-none">
      {thornPositions}
    </div>
  );
};

export default ThornsOverlay;
