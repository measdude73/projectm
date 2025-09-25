// src/components/Bubble.tsx
import React from "react";

interface BubbleProps {
  x: number;
  y: number;
  radius: number;
  health: number;
  imgSrc: string;
}

const Bubble: React.FC<BubbleProps> = ({ x, y, radius, health, imgSrc }) => {
  const strokeWidth = 4;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - health / 100);

  // Decide health color based on current health value
  const getHealthColor = () => {
    if (health > 60) return "green";
    if (health > 30) return "yellow";
    return "red";
  };

  return (
    <svg
      width={radius * 2 + strokeWidth}
      height={radius * 2 + strokeWidth}
      style={{ position: "absolute", left: x - radius, top: y - radius }}
    >
      <circle
        cx={radius + strokeWidth / 2}
        cy={radius + strokeWidth / 2}
        r={radius}
        fill="white"
      />
      <image
        href={imgSrc}
        x={strokeWidth / 2}
        y={strokeWidth / 2}
        width={radius * 2}
        height={radius * 2}
        clipPath={`circle(${radius}px at ${radius}px ${radius}px)`}
      />
      <circle
        cx={radius + strokeWidth / 2}
        cy={radius + strokeWidth / 2}
        r={radius}
        fill="transparent"
        stroke={getHealthColor()}
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
      />
    </svg>
  );
};

export default Bubble;
