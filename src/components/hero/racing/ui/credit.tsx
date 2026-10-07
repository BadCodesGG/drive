import type { ReactNode } from "react";
import { CHIP } from "./legible";

/** Where each source states its terms; the OpenStreetMap link is the one its attribution guidelines ask for. */
export const CREDIT_LINKS = {
  osm: "https://www.openstreetmap.org/copyright",
  odbl: "https://opendatacommons.org/licenses/odbl/1-0/",
  spw: "https://geoportail.wallonie.be/catalogue/218033a9-b755-4a93-b812-e97475935c62.html",
  gsi: "https://www.gsi.go.jp/ENGLISH/page_e30286.html",
  usgs: "https://www.usgs.gov/3d-elevation-program",
  terrain: "https://github.com/tilezen/joerd/blob/master/docs/attribution.md",
} as const;

const LINK = "underline decoration-dotted underline-offset-2 hover:text-ink hover:decoration-solid focus-visible:outline-2 focus-visible:outline-accent";

function A({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={LINK}>
      {children}
    </a>
  );
}

/**
 * The data credit, shown whenever the scene is live: a short line naming every source, and the full
 * sentence behind a native disclosure, with each source linked to its terms. It opens upward over the
 * scene, so it never takes layout space. The line sits on the scene's chip (legible.ts), cloned onto
 * each line it wraps to on a phone. The links are in the opened sentence, not the line: a link inside
 * a summary would fight the disclosure's own click.
 */
export function Credit() {
  return (
    <details data-hero-credit className="pointer-events-auto absolute inset-x-6 bottom-2 text-right md:inset-x-auto md:bottom-7 md:right-16">
      <summary className={`${CHIP} inline cursor-pointer list-none box-decoration-clone text-[11px] leading-4 text-ink-secondary underline decoration-dotted underline-offset-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden`}>
        Map data: © OpenStreetMap contributors (ODbL), Service public de Wallonie (SPW), GSI Japan, USGS 3DEP, Terrain Tiles
      </summary>
      <p className="absolute bottom-full right-0 mb-2 w-[min(28rem,calc(100vw-3rem))] max-h-[min(60vh,24rem)] overflow-y-auto overscroll-contain border border-border bg-bg p-3 [@media(max-height:500px)]:max-h-[38vh] [@media(max-height:500px)]:w-[min(44rem,calc(100vw-3rem))] text-left text-xs leading-relaxed text-ink-secondary">
        Circuits, woods, land use, buildings and roads from <A href={CREDIT_LINKS.osm}>© OpenStreetMap contributors</A> (<A href={CREDIT_LINKS.odbl}>ODbL</A>). Ground heights: <A href={CREDIT_LINKS.spw}>Service public de Wallonie (SPW)</A> (LiDAR DTM, CC BY 4.0); Source: <A href={CREDIT_LINKS.gsi}>Geospatial Information Authority of Japan</A> (GSI Japan, 出典：国土地理院), elevation resampled and merged by this project, not by GSI; <A href={CREDIT_LINKS.usgs}>3DEP data courtesy of the U.S. Geological Survey</A> (USGS 3DEP). Distant skyline: <A href={CREDIT_LINKS.terrain}>Terrain Tiles</A> (Europe terrain data produced using Copernicus data and information funded by the European Union, EU-DEM layers; United States 3DEP, GMTED2010 and SRTM terrain data courtesy of the U.S. Geological Survey).
      </p>
    </details>
  );
}
