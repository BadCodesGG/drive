"use client";

import type { Ref } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CAR_IDS, type CarId } from "../engine/cars";
import type { Look } from "../engine/prefs";
import { TRACK_IDS, type TrackId } from "../data/types";

const TRACK_LABELS: Record<TrackId, string> = { spa: "Spa", sebring: "Sebring", fuji: "Fuji" };
const CAR_LABELS: Record<CarId, string> = { gt3: "GT3", f1: "F1" };
const LOOK_IDS = ["lowpoly", "detailed"] as const;
const LOOK_LABELS: Record<Look, string> = { lowpoly: "Low poly", detailed: "Detailed" };

/** A row of toggle pills: one group, one pressed choice, every target at least 24 px. */
function Pills<T extends string>({ label, ids, labels, value, onPick, className }: { label: string; ids: readonly T[]; labels: Record<T, string>; value: T; onPick: (id: T) => void; className?: string }) {
  return (
    <div role="group" aria-label={label} className={cn("pointer-events-auto flex gap-0.5 border border-border bg-bg/70 p-[3px] backdrop-blur-md", className)}>
      {ids.map((id) => (
        <Button
          key={id}
          type="button"
          variant="ghost"
          size="sm"
          aria-pressed={id === value}
          onClick={() => onPick(id)}
          className={cn(
            "h-auto min-h-6 min-w-6 rounded-none px-2.5 py-1 pointer-coarse:h-9 font-mono text-[11px] font-normal uppercase tracking-[0.06em] text-ink-secondary shadow-none",
            "hover:bg-surface hover:text-ink focus-visible:ring-2 focus-visible:ring-accent",
            "aria-pressed:text-accent aria-pressed:shadow-[inset_0_-1px_0_var(--accent)]",
          )}
        >
          {labels[id]}
        </Button>
      ))}
    </div>
  );
}

/**
 * The circuit, car and look pickers and Drive. Desktop: two right-aligned rows in the section's
 * top padding, circuits and Drive, then the car and the look. Phone: stacked in the bottom padding, above the credit.
 * Neither ever takes layout space. Drive comes last in the DOM, so it follows the pickers in tab order,
 * and is offered on every device: keys with a fine hovering pointer, the phone pad otherwise.
 * While driving the whole block is hidden and inert, out of sight and out of the tab order.
 */
export function Controls({ trackId, carId, look, onTrack, onCar, onLook, onDrive, driveRef, hidden }: { trackId: TrackId; carId: CarId; look: Look; onTrack: (id: TrackId) => void; onCar: (id: CarId) => void; onLook: (look: Look) => void; onDrive: () => void; driveRef?: Ref<HTMLButtonElement>; hidden?: boolean }) {
  return (
    <div
      data-hero-controls
      inert={hidden}
      className={cn(
        "pointer-events-none absolute inset-x-6 bottom-14 grid grid-cols-[auto_auto] justify-end justify-items-end gap-1.5 transition-opacity duration-300 motion-reduce:transition-none md:inset-x-auto md:bottom-auto md:right-16 md:top-3",
        hidden && "opacity-0",
      )}
    >
      <Pills label="Circuit" ids={TRACK_IDS} labels={TRACK_LABELS} value={trackId} onPick={onTrack} className="col-start-1 row-start-1" />
      <div className="col-span-2 col-start-1 row-start-2 flex flex-wrap justify-end gap-1.5">
        <Pills label="Car" ids={CAR_IDS} labels={CAR_LABELS} value={carId} onPick={onCar} />
        <Pills label="Look" ids={LOOK_IDS} labels={LOOK_LABELS} value={look} onPick={onLook} />
      </div>
      <Button
        ref={driveRef}
        type="button"
        data-hero-drive
        onClick={onDrive}
        className="pointer-events-auto col-start-2 row-start-1 h-auto min-h-6 self-stretch rounded-none px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-[0.08em] shadow-none hover:bg-accent-hover focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink focus-visible:ring-0"
      >
        Drive
      </Button>
    </div>
  );
}
