const API_EVENT = "http://localhost:5000/api/stats/event";

type Counts = Record<string, number>;

const hits: Counts = {};
const kills: Counts = {};
let sending = false;
let currentGame: string | null = null;
let currentArena: string | null = null; // 'normal' or 'boss'

export function setGame(id: string | null, arena?: string | null) {
  currentGame = id;
  currentArena = arena || null;
}

export function recordHit(player?: string) {
  if (!player) return;
  const k = String(player);
  hits[k] = (hits[k] || 0) + 1;
}

export function recordKill(player?: string) {
  if (!player) return;
  const k = String(player);
  kills[k] = (kills[k] || 0) + 1;
}

async function flushOnce() {
  if (sending) return;
  const players = new Set<string>([...Object.keys(hits), ...Object.keys(kills)]);
  if (players.size === 0) return;
  sending = true;

  for (const p of players) {
  const body: any = { player: p, hits: hits[p] || 0, kills: kills[p] || 0 };
  if (currentGame) body.game = currentGame;
  if (currentArena) body.arena = currentArena;
    try {
      await fetch(API_EVENT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      delete hits[p];
      delete kills[p];
    } catch (e) {
      // network error: keep counts local to retry later
      console.warn("statsClient: failed to send stats for", p, e);
    }
  }

  sending = false;
}

const FLUSH_INTERVAL = 3000;
setInterval(() => void flushOnce(), FLUSH_INTERVAL);

window.addEventListener("beforeunload", () => {
  try {
    void flushOnce();
  } catch (e) {}
});

export default {
  setGame,
  recordHit,
  recordKill,
  flush: flushOnce,
};
