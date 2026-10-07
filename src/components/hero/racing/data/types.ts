/**
 * The shapes of the per-circuit data chunks (spa.json, sebring.json, fuji.json beside this file).
 * The committed JSON is the source of truth: track and scenery geometry derived from OpenStreetMap,
 * with elevation from the public sources named in the README.
 */
export const TRACK_IDS = ["spa", "sebring", "fuji"] as const;
export type TrackId = (typeof TRACK_IDS)[number];
export const isTrackId = (v: unknown): v is TrackId => typeof v === "string" && (TRACK_IDS as readonly string[]).includes(v);

export interface Mood {
  sky: { top: string; bottom: string };
  sun: { color: string; intensity: number; elevation: number; azimuth: number };
  fog: { color: string; near: number; far: number };
  hemi: { sky: string; ground: string; intensity: number };
  ground: string;
}

/** A landmark, with named places already resolved to lap fractions. */
export interface Landmark {
  type: string;
  at?: number;
  pos?: [number, number];
  side?: number;
  offset?: number;
  shift?: number;
  count?: number;
  spread?: number;
  osm?: string;
}

export interface Track {
  name: string;
  km: string;
  ref: number;
  osm: number;
  len: number;
  pit: { side: number; from: number; to: number; off: number };
  marks: Record<string, [number, number]>;
  pts: [number, number][];
  line: number[];
  hw: number;
  runoff: number;
  bumpy?: boolean;
  sectors: string[];
  mood: Mood;
  landmarks: Landmark[];
  elev: number[];
  height: number[];
}

/** A closed OpenStreetMap outline (its first point repeated last), in drive-frame metres. */
export interface OsmPoly {
  id: string;
  pts: [number, number][];
  /** Woods: needleleaved, broadleaved or mixed, where the map says. */
  leaf?: string | null;
  /** Grass and buildings: the map's own kind (meadow, farmland; house, hangar...). */
  kind?: string;
  /** Buildings: the tagged or derived height (m), and whether it is a default rather than a mapped value. */
  height?: number;
  def?: number;
}

/** An OpenStreetMap polyline (a public road, a row of trees), in drive-frame metres. */
export interface OsmLine {
  id: string;
  pts: [number, number][];
  /** Roads: the carriageway width (m). */
  w?: number;
}

export interface Ground {
  grid: { origin: [number, number]; cell: number; nx: number; nz: number; h: string };
  far: { r: number; n: number; c: [number, number]; h: string };
  mount?: { bearingDeg: number; distM: number; summitM: number; angleDeg: number; xz: [number, number] };
  osm: {
    woods: OsmPoly[];
    scrub: OsmPoly[];
    grass: OsmPoly[];
    water: OsmPoly[];
    parking: OsmPoly[];
    aeroway: OsmPoly[];
    buildings: OsmPoly[];
    grandstands: OsmPoly[];
    /** Tanks; one mapped as a single point has a one-point outline. */
    tanks: OsmPoly[];
    roads: OsmLine[];
    treeRows: OsmLine[];
    /** [x, z, osm id] per mapped tree. */
    trees: [number, number, number][];
  };
}

/** One circuit's chunk: src/components/hero/racing/data/<id>.json. */
export interface TrackData {
  track: Track;
  ground: Ground;
}
