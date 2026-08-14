import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Relay — chat is for people, work runs on Relay",
  description: "An AI project manager for teams that hate project management.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Keep the layout locked to the visual viewport so mobile Safari doesn't zoom on
  // focus or let content spill sideways; users can still pinch-zoom (maximumScale unset).
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* set theme before paint to avoid flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('relay-theme');if(t){document.documentElement.setAttribute('data-theme',t);}}catch(e){}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
