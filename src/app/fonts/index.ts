import localFont from "next/font/local";

// The game's two faces, self-hosted so neither the build nor a dev server fetches from Google Fonts.
// The files are the latin subsets next/font/google served, byte for byte (both are OFL; licences
// beside them), with that subset's unicode-range. Each is a variable font declared once per weight
// the game uses, as Google's CSS did, so an in-between weight still snaps to the same face. The
// faces keep their real family names, which the canvas text names too, and the size-adjusted
// fallbacks are Google's own, declared in globals.css. Font loader arguments must be literals.
export const hankenGrotesk = localFont({
  src: [
    { path: "./hanken-grotesk-latin.woff2", weight: "500", style: "normal" },
    { path: "./hanken-grotesk-latin.woff2", weight: "700", style: "normal" },
    { path: "./hanken-grotesk-latin.woff2", weight: "800", style: "normal" },
    { path: "./hanken-grotesk-latin.woff2", weight: "900", style: "normal" },
  ],
  declarations: [
    { prop: "font-family", value: "Hanken Grotesk" },
    { prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" },
  ],
  // next/font heads the stack with a family named after this const, which no face carries (the faces
  // are renamed above), so the browser moves on to the real name and then Google's fallback.
  adjustFontFallback: false,
  fallback: ["Hanken Grotesk", "Hanken Grotesk Fallback"],
  variable: "--font-hanken-grotesk",
  display: "swap",
});

export const manrope = localFont({
  src: [
    { path: "./manrope-latin.woff2", weight: "400", style: "normal" },
    { path: "./manrope-latin.woff2", weight: "500", style: "normal" },
    { path: "./manrope-latin.woff2", weight: "600", style: "normal" },
    { path: "./manrope-latin.woff2", weight: "700", style: "normal" },
  ],
  declarations: [
    { prop: "font-family", value: "Manrope" },
    { prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" },
  ],
  adjustFontFallback: false,
  fallback: ["Manrope", "Manrope Fallback"],
  variable: "--font-manrope",
  display: "swap",
});
