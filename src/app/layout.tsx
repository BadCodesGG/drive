import type { Metadata, Viewport } from "next";
import { hankenGrotesk, manrope } from "@/app/fonts";
import "./globals.css";

const title = "Drive · Spa, Sebring and Fuji in a GT3 or F1";
const ogImage = { url: "/og.jpg", width: 1200, height: 630, alt: "The Spa-Francorchamps miniature, ready to drive" };
const description =
  "Drive Spa, Sebring and Fuji at true scale in a GT3 car or an F1 car, in your browser. Chase or cockpit camera, on a keyboard or a touch screen.";

export const metadata: Metadata = {
  metadataBase: new URL("https://drive.badcodes.dev"),
  title,
  description,
  alternates: { canonical: "/" },
  // The idle miniature at Spa with the app's name over it (public/og.jpg).
  openGraph: { type: "website", siteName: "Drive", title, description, url: "/", images: [ogImage] },
  twitter: { card: "summary_large_image", title, description, images: [ogImage.url] },
};

export const viewport: Viewport = {
  themeColor: "#0b0e17",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${hankenGrotesk.variable} ${manrope.variable}`}>
      <body>{children}</body>
    </html>
  );
}
