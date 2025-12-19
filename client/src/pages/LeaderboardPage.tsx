import React, { useEffect, useState } from "react";

interface Row {
  player: string;
  hits: number;
  kills: number;
}

const LeaderboardPage: React.FC = () => {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchLeaderboard = async () => {
    setLoading(true);
    try {
      const res = await fetch("http://localhost:5000/api/stats");
      const data = await res.json();
      setRows(data || []);
    } catch (e) {
      console.error("Failed to fetch leaderboard", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeaderboard();
    const t = setInterval(fetchLeaderboard, 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="p-6 text-white">
      <h2 className="text-2xl font-bold mb-4">Leaderboard</h2>
      {loading && <div>Loading...</div>}
      <div className="bg-white/10 rounded-md overflow-hidden">
        <div className="grid grid-cols-12 gap-2 p-3 font-semibold bg-white/5">
          <div className="col-span-1">#</div>
          <div className="col-span-7">Player</div>
          <div className="col-span-2 text-right">Kills</div>
          <div className="col-span-2 text-right">Hits</div>
        </div>
        <div>
          {rows.map((r, i) => (
            <div key={r.player} className="grid grid-cols-12 gap-2 p-3 border-t border-white/5 items-center">
              <div className="col-span-1">{i + 1}</div>
              <div className="col-span-7 truncate">{r.player}</div>
              <div className="col-span-2 text-right">{r.kills}</div>
              <div className="col-span-2 text-right">{r.hits}</div>
            </div>
          ))}
          {rows.length === 0 && !loading && <div className="p-4">No data yet.</div>}
        </div>
      </div>
    </div>
  );
};

export default LeaderboardPage;
