const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

// Persistent leaderboard stores (file-backed) - normal and boss separated
const STATS_FILE = path.join(__dirname, "stats.json");
const STATS_BOSS_FILE = path.join(__dirname, "stats_boss.json");
// store shape (for each):
// { games: { [gameId]: { players: { [player]: { hits,kills,wins } }, winner?: string, createdAt } }, totals: { [player]: { hits,kills,wins } } }
let leaderboardStore = { games: {}, totals: {} };
let bossStore = { games: {}, totals: {} };

// normalize a player identifier to the filename portion (strip URL/path)
const normalizePlayerKey = (p) => {
  try {
    let key = String(p || "");
    key = key.replace(/^https?:\/\/[^\/]+\//, "").replace(/^\/+/, "");
    const parts = key.split('/');
    return parts[parts.length - 1] || String(p);
  } catch (e) {
    return String(p);
  }
};
const loadStats = () => {
  try {
    // load normal stats
    if (fs.existsSync(STATS_FILE)) {
      const raw = fs.readFileSync(STATS_FILE, "utf8");
      const parsed = raw ? JSON.parse(raw) : {};
      if (parsed && typeof parsed === "object") {
        if (parsed.games || parsed.totals) {
          leaderboardStore = parsed;
        } else {
          // migrate legacy flat format -> normalized totals
          leaderboardStore = { games: {}, totals: {} };
          Object.keys(parsed).forEach((p) => {
            const v = parsed[p] || {};
            let key = String(p || '');
            try { key = key.replace(/^https?:\/\/[^\/]+\//, '').replace(/^\/+/, ''); const parts = key.split('/'); key = parts[parts.length - 1] || String(p); } catch (e) {}
            const existing = leaderboardStore.totals[key] || { hits: 0, kills: 0, wins: 0 };
            existing.hits = (existing.hits || 0) + Number(v.hits || 0);
            existing.kills = (existing.kills || 0) + Number(v.kills || 0);
            existing.wins = (existing.wins || 0) + Number(v.wins || 0);
            leaderboardStore.totals[key] = existing;
          });
          try { fs.writeFileSync(STATS_FILE, JSON.stringify(leaderboardStore, null, 2), 'utf8'); } catch (e) {}
        }
      }
    } else { leaderboardStore = { games: {}, totals: {} }; fs.writeFileSync(STATS_FILE, JSON.stringify(leaderboardStore, null, 2), "utf8"); }

    // load boss stats (if exists), otherwise initialize
    if (fs.existsSync(STATS_BOSS_FILE)) {
      const rawB = fs.readFileSync(STATS_BOSS_FILE, "utf8");
      const parsedB = rawB ? JSON.parse(rawB) : {};
      if (parsedB && typeof parsedB === 'object' && (parsedB.games || parsedB.totals)) {
        bossStore = parsedB;
      } else {
        bossStore = { games: {}, totals: {} };
        try { fs.writeFileSync(STATS_BOSS_FILE, JSON.stringify(bossStore, null, 2), 'utf8'); } catch (e) {}
      }
    } else {
      bossStore = { games: {}, totals: {} };
      fs.writeFileSync(STATS_BOSS_FILE, JSON.stringify(bossStore, null, 2), 'utf8');
    }
  } catch (e) {
    console.error("Failed to load stats files", e);
    leaderboardStore = { games: {}, totals: {} };
    bossStore = { games: {}, totals: {} };
  }
};

const saveStats = (which='normal') => {
  try {
    if (which === 'boss') {
      fs.writeFileSync(STATS_BOSS_FILE, JSON.stringify(bossStore, null, 2), "utf8");
    } else {
      fs.writeFileSync(STATS_FILE, JSON.stringify(leaderboardStore, null, 2), "utf8");
    }
  } catch (e) {
    console.error("Failed to save stats file", e);
  }
};

loadStats();

// helper: determine which store to use based on arena param, game id, or player name heuristic
const detectBossByKey = (s) => {
  try {
    const k = String(s||'').toLowerCase();
    return k.includes('boss') || k.includes('super') || k.includes('superbubble') || k.includes('bossimg');
  } catch(e){return false}
};
const getStoreFor = ({ arena, game, player } = {}) => {
  if (arena === 'boss') return { store: bossStore, which: 'boss' };
  if (arena === 'normal') return { store: leaderboardStore, which: 'normal' };
  // game id hint
  if (game && String(game).toLowerCase().includes('boss')) return { store: bossStore, which: 'boss' };
  // player hint
  if (player && detectBossByKey(player)) return { store: bossStore, which: 'boss' };
  // default to normal
  return { store: leaderboardStore, which: 'normal' };
};

// POST an event: { player: string, hits?: number, kills?: number }
// POST an event: { player: string, hits?: number, kills?: number, game?: string }
app.post("/api/stats/event", (req, res) => {
  try {
    const { player, hits = 0, kills = 0, game, arena } = req.body || {};
    if (!player) return res.status(400).json({ error: "player is required" });
    const pRaw = player;
    const p = normalizePlayerKey(player);
    const h = Number(hits) || 0;
    const k = Number(kills) || 0;

    const { store, which } = getStoreFor({ arena, game, player: pRaw });

    // update totals in selected store
    if (!store.totals[p]) store.totals[p] = { hits: 0, kills: 0, wins: 0 };
    store.totals[p].hits += h;
    store.totals[p].kills += k;

    // update game-specific bucket if provided
    if (game) {
      const gid = String(game);
      if (!store.games[gid]) store.games[gid] = { players: {}, createdAt: Date.now() };
      if (!store.games[gid].players[p]) store.games[gid].players[p] = { hits: 0, kills: 0, wins: 0 };
      store.games[gid].players[p].hits += h;
      store.games[gid].players[p].kills += k;
    }

    saveStats(which);
    return res.json({ ok: true, player: p, totals: store.totals[p], game: game || null, arena: which });
  } catch (e) {
    console.error("Error recording stat event", e);
    return res.status(500).json({ error: "failed to record event" });
  }
});

// Return aggregated leaderboard sorted by kills then hits
// GET aggregated leaderboard
// query params: ?game=gameId (returns game-specific), ?scope=combined (or default combined)
app.get("/api/stats", (req, res) => {
  try {
    const { game, scope, arena } = req.query || {};
    const { store } = getStoreFor({ arena, game });
    if (game) {
      const gid = String(game);
      const g = store.games[gid];
      if (!g) return res.json([]);
      const entries = Object.keys(g.players || {}).map((p) => ({ player: p, ...g.players[p] }));
      entries.sort((a, b) => (b.kills !== a.kills ? b.kills - a.kills : b.hits - a.hits));
      return res.json(entries);
    }

    // default: combined totals from selected store
    const entries = Object.keys(store.totals || {}).map((p) => ({ player: p, ...store.totals[p] }));
    entries.sort((a, b) => (b.kills !== a.kills ? b.kills - a.kills : b.hits - a.hits));
    res.json(entries);
  } catch (e) {
    console.error("Error reading leaderboard", e);
    res.status(500).json({ error: "failed to read stats" });
  }
});

// Optional: return raw store
app.get("/api/stats/raw", (req, res) => {
  // return both stores for debugging
  res.json({ normal: leaderboardStore, boss: bossStore });
});

// Return list of games (ids + createdAt + winner)
app.get("/api/stats/games", (req, res) => {
  try {
    const { arena } = req.query || {};
    const { store } = getStoreFor({ arena });
    const games = Object.keys(store.games || {}).map((gid) => {
      const g = store.games[gid];
      return { id: gid, createdAt: g.createdAt || null, winner: g.winner || null };
    });
    res.json(games);
  } catch (e) {
    console.error("Error reading games list", e);
    res.status(500).json({ error: "failed to read games" });
  }
});

// set winner for a game: { game, player }
app.post("/api/stats/winner", (req, res) => {
  try {
    const { game, player, arena } = req.body || {};
    if (!game || !player) return res.status(400).json({ error: "game and player are required" });
    const gid = String(game);
    const pKey = normalizePlayerKey(player);
    const { store, which } = getStoreFor({ arena, game, player });
    if (!store.games[gid]) store.games[gid] = { players: {}, createdAt: Date.now() };
    store.games[gid].winner = pKey;
    // increment wins in both game-level and totals (use normalized key)
    if (!store.games[gid].players[pKey]) store.games[gid].players[pKey] = { hits: 0, kills: 0, wins: 0 };
    store.games[gid].players[pKey].wins = (store.games[gid].players[pKey].wins || 0) + 1;
    if (!store.totals[pKey]) store.totals[pKey] = { hits: 0, kills: 0, wins: 0 };
    store.totals[pKey].wins = (store.totals[pKey].wins || 0) + 1;
    saveStats(which);
    res.json({ ok: true, game: gid, winner: pKey, arena: which });
  } catch (e) {
    console.error("Error setting winner", e);
    res.status(500).json({ error: "failed to set winner" });
  }
});

// Optional: reset leaderboard
app.delete("/api/stats", (req, res) => {
  const { arena } = req.query || {};
  if (arena === 'boss') {
    bossStore = { games: {}, totals: {} };
    saveStats('boss');
    return res.json({ ok: true, arena: 'boss' });
  }
  leaderboardStore = { games: {}, totals: {} };
  saveStats('normal');
  res.json({ ok: true, arena: 'normal' });
});

// Normal images (unchanged)
app.get("/api/images", (req, res) => {
  const imagesDir = path.join(__dirname, "images");
  fs.readdir(imagesDir, (err, files) => {
    if (err) return res.status(500).json({ error: "Failed to read images" });
    const imageUrls = files.map((file) => `/images/${file}`);
    res.json(imageUrls);
  });
});
app.use("/images", express.static(path.join(__dirname, "images")));

// Boss images (normal bubbles)
app.get("/api/bossimgs", (req, res) => {
  const bossImgsDir = path.join(__dirname, "bossimgs");
  fs.readdir(bossImgsDir, (err, files) => {
    if (err) return res.status(500).json({ error: "Failed to read boss images" });
    // filter out directories
    const onlyFiles = files.filter(f => !fs.statSync(path.join(bossImgsDir, f)).isDirectory());
    res.json(onlyFiles);
  });
});
app.use("/bossimgs", express.static(path.join(__dirname, "bossimgs")));

// Super bubble images moved to separate folder: superbubbleimg
app.get("/api/superbubbleimg", (req, res) => {
  const superBubbleDir = path.join(__dirname, "superbubbleimg");
  fs.readdir(superBubbleDir, (err, files) => {
    if (err)
      return res.status(500).json({ error: "Failed to read superbubble images" });
    const onlyFiles = files.filter(f => !fs.statSync(path.join(superBubbleDir, f)).isDirectory());
    res.json(onlyFiles);
  });
});
app.use("/superbubbleimg", express.static(path.join(__dirname, "superbubbleimg")));

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// Serve a simple standalone leaderboard HTML on the server port
app.get("/leaderboard", (req, res) => {
  res.sendFile(path.join(__dirname, "leaderboard.html"));
});

// Public user-facing leaderboard (limited controls)
app.get("/leaderboard/user", (req, res) => {
  res.sendFile(path.join(__dirname, "leaderboard_user.html"));
});
