/**
 * The keyboard: a letter key
 * starts a drive only while focus is inside the racing controls, never page-wide, because a page
 * may not carry single-character shortcuts that fire anywhere (WCAG 2.1.4). Once driving, W/A/S/D and the arrows
 * drive, R respawns, C toggles chase and cockpit, and Esc exits until the drive ends. Keys typed into a form field are never read.
 */

/** Whatever the key event landed on: an Element in the page, anything with closest() in a test. */
export interface KeyTarget {
  closest(selector: string): unknown;
}

export interface KeyInput {
  key: string;
  type: string;
  target: KeyTarget | EventTarget | null;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  /** A held key's auto-repeat. */
  repeat?: boolean;
}

export type DriveKey = "w" | "a" | "s" | "d";
/** What a key event means: a held key (and whether it starts a drive), an action, or nothing (null). */
export type KeyRead = { key: DriveKey; down: boolean; start: boolean; prevent: boolean } | { action: "exit" | "respawn" | "view" };

const ARROWS: Record<string, DriveKey> = { ArrowUp: "w", ArrowLeft: "a", ArrowDown: "s", ArrowRight: "d" };
const EDITABLE = "input, textarea, select, [contenteditable]";
/** The racing controls (the Circuit and Car pills and Drive): the only place a letter key starts a drive. */
export const CONTROLS = "[data-hero-controls]";

const within = (t: KeyInput["target"], sel: string) => !!t && typeof (t as KeyTarget).closest === "function" && !!(t as KeyTarget).closest(sel);

export function readKey(e: KeyInput, s: { driving: boolean }): KeyRead | null {
  if (within(e.target, EDITABLE)) return null;
  const down = e.type === "keydown";
  // A shortcut (Ctrl+R, Cmd+W) belongs to the browser; its release still lands, so no key sticks.
  if (down && (e.ctrlKey || e.metaKey || e.altKey)) return null;
  // Esc, R and C act once per press: holding R would respawn over and over, holding C strobe the view.
  // (Their auto-repeats are read too; held driving keys still repeat, harmlessly.)
  const once = s.driving && down && !e.repeat;
  if (e.key === "Escape") return once ? { action: "exit" } : null;
  // Arrows drive too, but only once driving: before that they belong to page scrolling.
  const arrow = ARROWS[e.key];
  if (arrow) return s.driving ? { key: arrow, down, start: false, prevent: true } : null;
  const k = e.key.toLowerCase();
  if (k === "r") return once ? { action: "respawn" } : null;
  if (k === "c") return once ? { action: "view" } : null;
  if (k !== "w" && k !== "a" && k !== "s" && k !== "d") return null;
  return { key: k, down, start: down && !s.driving && within(e.target, CONTROLS), prevent: false };
}

/** What bindKeys drives: the engine's own key handling and whether a drive is under way. */
export interface KeySink {
  key(read: KeyRead): void;
  clearKeys(): void;
  driving(): boolean;
}

/**
 * Listens on the window for the whole of a mount: every key is read by readKey, and a lost
 * window focus lets go of every key. Returns the function that stops listening.
 */
export function bindKeys(win: Window, sink: KeySink): () => void {
  const onKey = (e: KeyboardEvent) => {
    const read = readKey(e, { driving: sink.driving() });
    if (!read) return;
    if ("key" in read && read.prevent) e.preventDefault();
    sink.key(read);
  };
  const blur = () => sink.clearKeys();
  win.addEventListener("keydown", onKey);
  win.addEventListener("keyup", onKey);
  win.addEventListener("blur", blur);
  return () => {
    win.removeEventListener("keydown", onKey);
    win.removeEventListener("keyup", onKey);
    win.removeEventListener("blur", blur);
  };
}
