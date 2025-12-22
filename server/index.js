const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

// Serve static files for images
app.use('/images', express.static(path.join(__dirname, 'images')));
app.use('/bossimgs', express.static(path.join(__dirname, 'bossimgs')));
app.use('/superbubbleimg', express.static(path.join(__dirname, 'superbubbleimg')));
app.use('/superimgstorage', express.static(path.join(__dirname, 'superimgstorage')));


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

// Reconcile existing stores on startup:
// - Move any games in the normal store that appear to be boss games into the boss store
// - Ensure boss store contains only hits (zero out kills/wins)
const reconcileStores = () => {
  try {
    // move games from normal -> boss if any player key looks like a boss asset
    Object.keys(leaderboardStore.games || {}).forEach((gid) => {
      const g = leaderboardStore.games[gid];
      const playerKeys = Object.keys((g && g.players) || {});
      const hasBossKey = playerKeys.some(pk => detectBossByKey(pk) || detectBossByKey(g.winner));
      if (hasBossKey) {
        // ensure boss store game exists and copy
        bossStore.games[gid] = g;
        // remove from normal store
        delete leaderboardStore.games[gid];
        // move totals contributions for these players from normal -> boss (hits only)
        playerKeys.forEach(pk => {
          const normKey = normalizePlayerKey(pk);
          const pStats = (g.players && g.players[pk]) || { hits: 0, kills: 0, wins: 0 };
          // subtract from normal totals if present
          if (leaderboardStore.totals && leaderboardStore.totals[normKey]) {
            leaderboardStore.totals[normKey].hits = Math.max(0, (leaderboardStore.totals[normKey].hits || 0) - (pStats.hits || 0));
            leaderboardStore.totals[normKey].kills = Math.max(0, (leaderboardStore.totals[normKey].kills || 0) - (pStats.kills || 0));
            leaderboardStore.totals[normKey].wins = Math.max(0, (leaderboardStore.totals[normKey].wins || 0) - (pStats.wins || 0));
            // if totals become empty, leave hits (0) — we'll clean zeros later
          }
          // add to boss totals (hits only)
          const bKey = normalizePlayerKey(pk);
          if (!bossStore.totals[bKey]) bossStore.totals[bKey] = { hits: 0, kills: 0, wins: 0 };
          bossStore.totals[bKey].hits = (bossStore.totals[bKey].hits || 0) + (pStats.hits || 0);
        });
      }
    });

    // Ensure boss store has only hits (zero kills/wins across totals and games)
    Object.keys(bossStore.totals || {}).forEach((p) => {
      // remove kills/wins properties entirely for boss totals
      delete bossStore.totals[p].kills;
      delete bossStore.totals[p].wins;
      bossStore.totals[p].hits = bossStore.totals[p].hits || 0;
    });
    Object.keys(bossStore.games || {}).forEach((gid) => {
      const g = bossStore.games[gid];
      g.players = g.players || {};
      Object.keys(g.players).forEach((pk) => {
        // remove kills/wins from game-level boss entries as well
        delete g.players[pk].kills;
        delete g.players[pk].wins;
        g.players[pk].hits = g.players[pk].hits || 0;
      });
    });

    // persist any modifications
    saveStats('normal');
    saveStats('boss');
  } catch (e) {
    console.error('Error reconciling stores', e);
  }
};

reconcileStores();
// helper: determine which store to use based on arena param, game id, or player name heuristic
const detectBossByKey = (s) => {
  try {
    const k = String(s||'').toLowerCase();
    // check for explicit markers
    if (k.includes('boss') || k.includes('superbubble-') || k.includes('super') || k.includes('bossimg')) return true;
    // check for superbubbleimg path
    if (k.includes('/superbubbleimg/')) return true;
    return false;
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

// Helper: copy superbubble image to superimgstorage with game-specific name
const storeSuperBubbleImage = (playerPath, gameId) => {
  try {
    if (!playerPath) return null;
    
    // Extract filename and try to find it
    let sourceFile = null;
    const dirs = [
      path.join(__dirname, 'superbubbleimg'),
      path.join(__dirname, 'bossimgs'),
      path.join(__dirname, 'images')
    ];
    
    // Search for the file in different directories
    for (const dir of dirs) {
      const files = fs.readdirSync(dir);
      const match = files.find(f => playerPath.includes(f) || playerPath.includes(f.split('.')[0]));
      if (match) {
        sourceFile = path.join(dir, match);
        break;
      }
    }
    
    if (!sourceFile || !fs.existsSync(sourceFile)) return null;
    
    // Create superimgstorage directory if it doesn't exist
    const storageDir = path.join(__dirname, 'superimgstorage');
    if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });
    
    // Copy to storage with game-specific name
    const ext = path.extname(sourceFile);
    const storageName = `game-${gameId}-superbubble${ext}`;
    const destFile = path.join(storageDir, storageName);
    fs.copyFileSync(sourceFile, destFile);
    
    return storageName;
  } catch(e) {
    console.error('Failed to store superbubble image', e);
    return null;
  }
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
    // Log incoming event for diagnostics
    console.log('[stats:event] incoming', { player: pRaw, normalized: p, hits: h, kills: k, game, arena });

    // Determine correct store: prefer explicit arena param; otherwise, if a game bucket
    // already exists in bossStore or leaderboardStore use that; otherwise fall back to heuristics.
    let storeInfo = null;
    if (arena === 'boss') storeInfo = { store: bossStore, which: 'boss' };
    else if (arena === 'normal') storeInfo = { store: leaderboardStore, which: 'normal' };
    else if (game) {
      const gid = String(game);
      if (bossStore.games && bossStore.games[gid]) storeInfo = { store: bossStore, which: 'boss' };
      else if (leaderboardStore.games && leaderboardStore.games[gid]) storeInfo = { store: leaderboardStore, which: 'normal' };
    }
    if (!storeInfo) storeInfo = getStoreFor({ arena, game, player: pRaw });
    const { store, which } = storeInfo;

    console.log('[stats:event] routed to store', which, 'for player', p);

    // update totals in selected store
    // debug: log boss events to help diagnose missing hits
  
    // For boss arena: only add to totals if NOT superbubble (superbubble only in game-level)
    if (which !== 'boss' || !detectBossByKey(pRaw)) {
      if (!store.totals[p]) store.totals[p] = { hits: 0, kills: 0, wins: 0 };
      // Always record hits. For boss arena we intentionally ignore kills/wins.
      store.totals[p].hits += h;
      if (which !== 'boss') {
        store.totals[p].kills += k;
      }
    }

    // update game-specific bucket if provided

    if (game) {
      const gid = String(game);
      if (!store.games[gid]) store.games[gid] = { players: {}, createdAt: Date.now() };
      // Determine if this is a superbubble entry (for boss arena only)
      const isSuperBubble = which === 'boss' && detectBossByKey(pRaw);
      if (isSuperBubble) {
        // Record superbubble hits INSIDE players as 'superbubble' key
        if (!store.games[gid].players['superbubble']) {
          store.games[gid].players['superbubble'] = { hits: 0 };
          // Store the superbubble image on first hit
          const sbImageName = storeSuperBubbleImage(pRaw, gid);
          if (sbImageName) {
            store.games[gid].players['superbubble'].image = sbImageName;
          }
        }
        store.games[gid].players['superbubble'].hits += h;
      } else {
        // Normal player entry
        if (!store.games[gid].players[p]) store.games[gid].players[p] = { hits: 0, kills: 0, wins: 0 };
        // Record hits for all arenas. Only record kills for non-boss arenas.
        store.games[gid].players[p].hits += h;
        if (which !== 'boss') {
          store.games[gid].players[p].kills += k;
        }
      }
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
    const { store, which } = getStoreFor({ arena, game });
    if (game) {
      const gid = String(game);
      const g = store.games[gid];
      if (!g) return res.json([]);
        const entries = Object.keys(g.players || {}).map((p) => {
          const e = { player: p, ...g.players[p] };
          if (which === 'boss') { delete e.kills; delete e.wins; }
          return e;
        });
        if (which === 'boss') entries.sort((a, b) => (b.hits || 0) - (a.hits || 0));
        else entries.sort((a, b) => (b.kills !== a.kills ? b.kills - a.kills : b.hits - a.hits));
      return res.json(entries);
    }

    // default: combined totals from selected store
    const entries = Object.keys(store.totals || {}).map((p) => {
      const e = { player: p, ...store.totals[p] };
      if (which === 'boss') { delete e.kills; delete e.wins; }
      return e;
    });
    if (which === 'boss') entries.sort((a, b) => (b.hits || 0) - (a.hits || 0));
    else entries.sort((a, b) => (b.kills !== a.kills ? b.kills - a.kills : b.hits - a.hits));
    res.json(entries);
  } catch (e) {
    console.error("Error reading leaderboard", e);
    res.status(500).json({ error: "failed to read stats" });
  }
});

// Optional: return full game details (including superbubble if present)
app.get("/api/stats/game-detail", (req, res) => {
  try {
    const { game, arena } = req.query || {};
    if (!game) return res.status(400).json({ error: "game param required" });
    const { store, which } = getStoreFor({ arena, game: String(game) });
    const gid = String(game);
    const g = store.games[gid];
    if (!g) return res.json({ players: {}, superbubble: null });
    
    // Return game details: players + superbubble (if present inside players)
    const result = {
      players: {},
      superbubble: null,
      createdAt: g.createdAt || null,
      winner: g.winner || null
    };
    
    // Map players and extract superbubble if present
    Object.keys(g.players || {}).forEach((p) => {
      if (p === 'superbubble') {
        // superbubble is inside players, extract it separately
        result.superbubble = g.players[p];
      } else {
        const e = { ...g.players[p] };
        if (which === 'boss') { delete e.kills; delete e.wins; }
        result.players[p] = e;
      }
    });
    
    res.json(result);
  } catch (e) {
    console.error("Error reading game detail", e);
    res.status(500).json({ error: "failed to read game detail" });
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
    
    // Do NOT create player entries for special winners like "team" or "superbubble"
    const isSpecialWinner = pKey === 'team' || pKey === 'superbubble';
    
    if (!isSpecialWinner) {
      // For regular players, create entry if needed
      if (!store.games[gid].players[pKey]) store.games[gid].players[pKey] = { hits: 0, kills: 0, wins: 0 };
      if (which !== 'boss') {
        store.games[gid].players[pKey].wins = (store.games[gid].players[pKey].wins || 0) + 1;
        if (!store.totals[pKey]) store.totals[pKey] = { hits: 0, kills: 0, wins: 0 };
        store.totals[pKey].wins = (store.totals[pKey].wins || 0) + 1;
      } else {
        if (!store.totals[pKey]) store.totals[pKey] = { hits: 0, kills: 0, wins: 0 };
        // ensure wins=0 for boss totals
        store.totals[pKey].wins = 0;
      }
    }
    
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
