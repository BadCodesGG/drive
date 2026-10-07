"use client";

import { useEffect, useId, useRef } from "react";
import { Button } from "@/components/ui/button";

/**
 * The drive's loader: real progress over the build steps, a label for the current one,
 * and a way out. Esc cancels too (input.ts). With a keyboard and mouse, focus starts on Cancel.
 */
export function Loader({ label, value, focusCancel, onCancel }: { label: string; value: number; focusCancel: boolean; onCancel: () => void }) {
  const id = useId();
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focusCancel) cancel.current?.focus({ preventScroll: true });
  }, [focusCancel]);
  return (
    <div
      data-hero-loader
      className="pointer-events-auto absolute left-1/2 top-1/2 z-30 grid w-[min(340px,82%)] -translate-x-1/2 -translate-y-1/2 justify-items-center gap-2.5 border border-border bg-bg/85 px-5 py-[18px] font-mono text-[11px] uppercase tracking-[0.08em] text-ink-secondary backdrop-blur-md"
    >
      <p id={id} className="m-0">{label}</p>
      <div role="progressbar" aria-label="Loading the drive" aria-describedby={id} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} className="h-1 w-full bg-border">
        <i className="block h-full bg-accent transition-[width] duration-200 ease-out motion-reduce:transition-none" style={{ width: `${value}%` }} />
      </div>
      <Button
        ref={cancel}
        type="button"
        variant="outline"
        size="sm"
        onClick={onCancel}
        className="h-auto min-h-6 rounded-none border-border px-3 py-1 font-mono text-[11px] font-normal uppercase tracking-[0.08em] text-ink hover:border-ink-tertiary hover:bg-transparent focus-visible:ring-2 focus-visible:ring-accent"
      >
        Cancel
      </Button>
    </div>
  );
}
