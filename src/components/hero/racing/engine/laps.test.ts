import { describe, expect, it } from "vitest";
import { bestKey, fmt, lapTick, newLapState, parseBest, type Best, type LapEvents } from "./laps";

describe("lap times as the HUD writes them", () => {
  it("formats seconds as m:ss.sss", () => {
    expect(fmt(150.5)).toBe("2:30.500");
    expect(fmt(0)).toBe("0:00.000");
    expect(fmt(65.1234)).toBe("1:05.123");
  });
});

describe("stored best laps", () => {
  it("keys each circuit and car apart, in the v3 format", () => {
    expect(bestKey("spa", "gt3")).toBe("hero-best-lap-v3:spa:gt3");
    expect(bestKey("fuji", "f1")).toBe("hero-best-lap-v3:fuji:f1");
  });

  it("reads a real lap as it was stored", () => {
    expect(parseBest(JSON.stringify({ lap: 150.5, times: [0, 1.5, 3] }))).toEqual({ lap: 150.5, times: [0, 1.5, 3] });
  });

  it("ignores anything that is not a real lap, so the ghost comes back", () => {
    for (const raw of [null, "", "not json", "null", JSON.stringify({ lap: -5, times: [1] }), JSON.stringify({ lap: "2:30", times: [1] }), JSON.stringify({ lap: 150.5, times: [1, null, 3] }), JSON.stringify({ lap: 150.5 }), JSON.stringify({ lap: 0, times: [] })])
      expect(parseBest(raw)).toBeNull();
  });
});

describe("lap timing", () => {
  // A 100-sample lap with sector lines at 34 and 68, against a ghost that takes 10 s (0.1 s a sample).
  const trk = { N: 100, cp: [34, 68] };
  const ghost = (): Best => ({ lap: 10, times: Float32Array.from({ length: 100 }, (_, i) => i * 0.1), mine: false });
  const record = () => {
    const said: string[] = [], spoken: string[] = [], splits: { k: number; hud: string; tone: string; status: string }[] = [];
    const bests: { lap: number; times: Float32Array }[] = [];
    const ev: LapEvents = {
      say: (text, _secs, _tone, voice) => { said.push(text); spoken.push(voice ?? text); },
      split: (s) => splits.push(s),
      newBest: (lap, times) => bests.push({ lap, times }),
    };
    return { ev, said, spoken, splits, bests };
  };
  // One physics tick at a time, the car moving one sample a tick from `from` to `to` (wrapping).
  const drive = (G: ReturnType<typeof newLapState>, from: number, to: number, best: Best, ev: LapEvents) => {
    for (let i = from; i !== to; i = (i + 1) % 100) { const bi = (i + 1) % 100; lapTick(G, i, bi, trk, best, ev); }
  };

  it("the out lap is untimed; timing starts at the chequered line", () => {
    const G = newLapState(100), r = record();
    drive(G, 60, 95, ghost(), r.ev);
    expect(G.timing).toBe(false);
    drive(G, 95, 5, ghost(), r.ev);
    expect(G.timing).toBe(true);
    expect(r.said).toEqual(["Timing"]);
  });

  it("the first sector line shows the split and its gap to the ghost, in the HUD and aloud", () => {
    const G = newLapState(100), r = record();
    drive(G, 95, 40, ghost(), r.ev);
    // Timing began on the tick that crossed the line (sample 0), so sample 34 is 35 ticks in.
    expect(r.splits).toEqual([{ k: 1, hud: "S1 0:00.292 -3.11", tone: "good", status: "Sector 1: 0:00.292, 3.11 seconds faster than the ghost" }]);
    expect(r.spoken).toContain("Sector 1: 0:00.292, 3.11 seconds faster than the ghost");
  });

  it("a slower sector is marked bad", () => {
    const G = newLapState(100), r = record(), slow: Best = { lap: 10, times: new Float32Array(100), mine: false };
    drive(G, 95, 40, slow, r.ev);
    expect(r.splits[0]).toMatchObject({ tone: "bad", hud: "S1 0:00.292 +0.29" });
  });

  it("a full lap past both sector lines counts, and beating the ghost makes it the new best", () => {
    const G = newLapState(100), r = record();
    drive(G, 95, 0, ghost(), r.ev); // across the line: timing starts
    drive(G, 0, 99, ghost(), r.ev); // round the lap
    drive(G, 99, 0, ghost(), r.ev); // and across it again
    expect(r.splits.map((s) => s.k)).toEqual([1, 2]);
    expect(G.last).toBeCloseTo(100 / 120, 9);
    expect(r.said.at(-1)).toBe("New best 0:00.833 (-9.167): the ghost is you now");
    expect(r.bests).toHaveLength(1);
    expect(r.bests[0].lap).toBeCloseTo(100 / 120, 9);
    // The recorded lap's split times: sample i was first reached (i + 1) ticks in, never decreasing.
    expect(r.bests[0].times[50]).toBeCloseTo(51 / 120, 5);
    expect(G.timing).toBe(true);
    expect(G.lapT).toBeCloseTo(1 / 120, 9);
  });

  it("a lap slower than the best is shown with its gap and not stored", () => {
    const G = newLapState(100), r = record(), quick: Best = { lap: 0.5, times: new Float32Array(100), mine: true };
    drive(G, 95, 0, quick, r.ev);
    drive(G, 0, 99, quick, r.ev);
    drive(G, 99, 0, quick, r.ev);
    expect(r.said.at(-1)).toBe("Lap 0:00.833 (+0.333)");
    expect(r.bests).toHaveLength(0);
  });

  it("a lap that skips a sector line is not counted", () => {
    const G = newLapState(100), r = record();
    drive(G, 95, 10, ghost(), r.ev);
    lapTick(G, 97, 1, trk, ghost(), r.ev); // back across the line without passing either sector
    expect(r.said.at(-1)).toBe("Lap not counted: a sector was missed");
    expect(r.bests).toHaveLength(0);
  });

  it("the ghost's index follows the lap clock", () => {
    const G = newLapState(100), r = record();
    drive(G, 95, 30, ghost(), r.ev);
    // 31 ticks in (0.258 s): the ghost has passed sample 2 (0.2 s) but not sample 3 (0.3 s).
    expect(G.gi).toBe(2);
  });
});
