import type { TrackData, TrackId } from "./types";

// One chunk per circuit, fetched only for the circuit on screen. Next needs literal import
// paths, so this is an explicit map rather than a template string.
const CHUNKS: Record<TrackId, () => Promise<{ default: unknown }>> = {
  spa: () => import("./spa.json"),
  sebring: () => import("./sebring.json"),
  fuji: () => import("./fuji.json"),
};

/** The circuit's committed track and ground data. */
export async function loadTrackData(id: TrackId): Promise<TrackData> {
  return (await CHUNKS[id]()).default as TrackData;
}
