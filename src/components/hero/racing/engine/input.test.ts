import { describe, expect, it } from "vitest";
import { readKey, type KeyTarget } from "./input";

// A stand-in for the event target: which selectors it sits inside.
const el = (...inside: string[]): KeyTarget => ({ closest: (sel: string) => (sel.split(",").some((s) => inside.includes(s.trim())) ? {} : null) });
const body = el();
const controls = el("[data-hero-controls]");
const ev = (key: string, target: KeyTarget | null = body, type: "keydown" | "keyup" = "keydown", mods: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean } = {}) => ({ key, type, target, ...mods });

describe("keyboard gate", () => {
  it("W, A, S or D with focus on the page body does not start a drive", () => {
    for (const k of ["w", "a", "s", "d"]) expect(readKey(ev(k), { driving: false })).toMatchObject({ start: false });
  });

  it("W with focus on a racing control starts a drive, and holds throttle", () => {
    expect(readKey(ev("w", controls), { driving: false })).toEqual({ key: "w", down: true, start: true, prevent: false });
    expect(readKey(ev("W", controls), { driving: false })).toMatchObject({ key: "w", start: true });
  });

  it("while driving, W/A/S/D press and release their keys", () => {
    expect(readKey(ev("d"), { driving: true })).toEqual({ key: "d", down: true, start: false, prevent: false });
    expect(readKey(ev("d", body, "keyup"), { driving: true })).toEqual({ key: "d", down: false, start: false, prevent: false });
  });

  it("arrows drive only while driving, and then never scroll the page", () => {
    expect(readKey(ev("ArrowUp"), { driving: false })).toBeNull();
    expect(readKey(ev("ArrowLeft", controls), { driving: false })).toBeNull();
    expect(readKey(ev("ArrowUp"), { driving: true })).toEqual({ key: "w", down: true, start: false, prevent: true });
    expect(readKey(ev("ArrowDown", body, "keyup"), { driving: true })).toEqual({ key: "s", down: false, start: false, prevent: true });
    expect(readKey(ev("ArrowRight"), { driving: true })).toMatchObject({ key: "d" });
  });

  it("Esc exits and R respawns, on keydown and only while driving", () => {
    expect(readKey(ev("Escape"), { driving: true })).toEqual({ action: "exit" });
    expect(readKey(ev("Escape", body, "keyup"), { driving: true })).toBeNull();
    expect(readKey(ev("Escape"), { driving: false })).toBeNull();
    expect(readKey(ev("r"), { driving: true })).toEqual({ action: "respawn" });
    expect(readKey(ev("R"), { driving: false })).toBeNull();
  });

  it("C toggles the view on keydown, only while driving, and is never a page-wide shortcut", () => {
    expect(readKey(ev("c"), { driving: true })).toEqual({ action: "view" });
    expect(readKey(ev("C"), { driving: true })).toEqual({ action: "view" });
    expect(readKey(ev("c", body, "keyup"), { driving: true })).toBeNull();
    expect(readKey(ev("c"), { driving: false })).toBeNull();
    expect(readKey(ev("c", controls), { driving: false })).toBeNull();
    expect(readKey(ev("c", el("input")), { driving: true })).toBeNull();
    expect(readKey(ev("c", body, "keydown", { ctrlKey: true }), { driving: true })).toBeNull();
  });

  it("holding R, C or Esc acts once: their auto-repeats are ignored, while a held driving key keeps driving", () => {
    const held = (key: string) => ({ ...ev(key), repeat: true });
    expect(readKey(held("r"), { driving: true })).toBeNull();
    expect(readKey(held("C"), { driving: true })).toBeNull();
    expect(readKey(held("Escape"), { driving: true })).toBeNull();
    expect(readKey(held("w"), { driving: true })).toEqual({ key: "w", down: true, start: false, prevent: false });
    expect(readKey(held("ArrowLeft"), { driving: true })).toEqual({ key: "a", down: true, start: false, prevent: true });
  });

  it("ignores keys typed into an input, textarea, select or contenteditable", () => {
    for (const sel of ["input", "textarea", "select", "[contenteditable]"]) {
      expect(readKey(ev("w", el(sel)), { driving: true })).toBeNull();
      expect(readKey(ev("Escape", el(sel)), { driving: true })).toBeNull();
    }
  });

  it("leaves browser shortcuts alone: a letter pressed with Ctrl, Cmd or Alt neither drives nor starts", () => {
    expect(readKey(ev("w", controls, "keydown", { ctrlKey: true }), { driving: false })).toBeNull();
    expect(readKey(ev("r", body, "keydown", { metaKey: true }), { driving: true })).toBeNull();
    expect(readKey(ev("d", body, "keydown", { altKey: true }), { driving: true })).toBeNull();
    // A release always lands, so a key held into a shortcut is never left stuck down.
    expect(readKey(ev("w", body, "keyup", { ctrlKey: true }), { driving: true })).toMatchObject({ key: "w", down: false });
  });

  it("ignores every other key", () => {
    expect(readKey(ev("x"), { driving: true })).toBeNull();
    expect(readKey(ev("Tab"), { driving: true })).toBeNull();
    expect(readKey(ev(" "), { driving: true })).toBeNull();
  });
});
