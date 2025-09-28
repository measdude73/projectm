// import React, { useEffect } from "react";
// import type { Thorn } from "../pages/ArenaPage";

// interface ThornsOverlayProps {
//   arenaWidth: number;
//   arenaHeight: number;
//   thornCount: number;
//   setThorns: React.Dispatch<React.SetStateAction<Thorn[]>>;
//   thorns: Thorn[]; // <- add this!
// }

// export const ThornsOverlay: React.FC<ThornsOverlayProps> = ({
//   arenaWidth,
//   arenaHeight,
//   thornCount,
//   setThorns,
//   thorns,
// }) => {
//   useEffect(() => {
//     if (arenaWidth === 0 || arenaHeight === 0) return;

//     const thorns: Thorn[] = [];
//     for (let i = 0; i < thornCount; i++) {
//       const side = ["top", "bottom", "left", "right"][
//         Math.floor(Math.random() * 4)
//       ];

//       const size = 30; // spike size
//       let x = 0;
//       let y = 0;

//       if (side === "top") {
//         x = Math.random() * (arenaWidth - size);
//         y = 0;
//       } else if (side === "bottom") {
//         x = Math.random() * (arenaWidth - size);
//         y = arenaHeight - size;
//       } else if (side === "left") {
//         x = 0;
//         y = Math.random() * (arenaHeight - size);
//       } else if (side === "right") {
//         x = arenaWidth - size;
//         y = Math.random() * (arenaHeight - size);
//       }

//       thorns.push({ side, x, y, size });
//     }

//     setThorns(thorns);
//   }, [arenaWidth, arenaHeight, thornCount, setThorns]);

// // ThornsOverlay.tsx (only update the rendering return block)
// return (
//   <div className="absolute inset-0 pointer-events-none">
//     {thorns.map((thorn, i) => {
//       let points = "";
//       let style: React.CSSProperties = {
//         position: "absolute",
//         pointerEvents: "none",
//       };
//       const w = thorn.size;
//       const h = thorn.size;

//       switch (thorn.side) {
//         case "top":
//           style.left = thorn.x;
//           style.top = thorn.y;
//           // Triangle pointing down (base at top, tip inward)
//           points = `0,0 ${w},0 ${w/2},${h}`;
//           break;
//         case "bottom":
//           style.left = thorn.x;
//           style.top = thorn.y;
//           // Triangle pointing up (base at bottom, tip inward)
//           points = `0,${h} ${w},${h} ${w/2},0`;
//           break;
//         case "left":
//           style.left = thorn.x;
//           style.top = thorn.y;
//           // Triangle pointing right (base at left, tip inward)
//           points = `0,0 0,${h} ${w},${h/2}`;
//           break;
//         case "right":
//           style.left = thorn.x;
//           style.top = thorn.y;
//           // Triangle pointing left (base at right, tip inward)
//           points = `${w},0 ${w},${h} 0,${h/2}`;
//           break;
//       }
//       return (
//         <svg
//           key={`thorn-${i}`}
//           width={w}
//           height={h}
//           style={style}
//         >
//           <polygon points={points} fill="black" />
//         </svg>
//       );
//     })}
//   </div>
// );


// };
