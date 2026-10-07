import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CREDIT_LINKS, Credit } from "./credit";

const html = renderToStaticMarkup(<Credit />);
const hrefs = [...html.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]);
const text = html.replace(/<[^>]*>/g, "");

describe("the data credit", () => {
  it("links OpenStreetMap's copyright page", () => {
    expect(hrefs).toContain("https://www.openstreetmap.org/copyright");
    expect(html).toMatch(/<a [^>]*>© OpenStreetMap contributors<\/a>/);
  });

  it("links every source it names, once each, over https, opening in a new tab without a referrer", () => {
    expect(hrefs.sort()).toEqual(Object.values(CREDIT_LINKS).sort());
    for (const h of hrefs) expect(h.startsWith("https://")).toBe(true);
    expect(html.match(/target="_blank" rel="noopener noreferrer"/g)).toHaveLength(hrefs.length);
  });

  it("names all five data sources in its line and in the full sentence", () => {
    for (const name of ["OpenStreetMap", "(SPW)", "GSI Japan", "USGS 3DEP", "Terrain Tiles"]) {
      expect(text.split(name).length - 1, name).toBeGreaterThanOrEqual(2);
    }
  });

  it("carries the attribution wording each source's terms require", () => {
    expect(text).toContain("© OpenStreetMap contributors");
    expect(text).toContain("Service public de Wallonie (SPW)");
    expect(text).toContain("CC BY 4.0");
    expect(text).toContain("3DEP data courtesy of the U.S. Geological Survey");
    expect(text).toContain("Geospatial Information Authority of Japan");
    expect(text).toMatch(/elevation resampled and merged by this project/);
    expect(text).toContain("Europe terrain data produced using Copernicus data and information funded by the European Union");
  });

  it("keeps links out of the summary, so the disclosure still toggles", () => {
    expect(html.match(/<summary[\s\S]*?<\/summary>/)![0]).not.toContain("<a ");
  });
});

describe("the opened credit panel", () => {
  const panel = html.match(/<p class="([^"]+)"/)?.[1] ?? "";

  it("is opaque, so the controls beneath never show through", () => {
    expect(panel).toMatch(/(^| )bg-bg( |$)/);
    expect(panel).not.toContain("bg-bg/");
  });

  it("caps its height and scrolls, shorter still on a short screen", () => {
    expect(panel).toContain("overflow-y-auto");
    expect(panel).toContain("max-h-[min(60vh,24rem)]");
    expect(panel).toContain("[@media(max-height:500px)]:max-h-[38vh]");
  });
});
