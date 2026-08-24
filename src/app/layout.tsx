import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Relay — chat is for people, work runs on Relay",
  description: "An AI project manager for teams that hate project management.",
  manifest: "/manifest.webmanifest",
  applicationName: "Relay",
  appleWebApp: {
    capable: true,
    title: "Relay",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Keep the layout locked to the visual viewport so mobile Safari doesn't zoom on
  // focus or let content spill sideways; users can still pinch-zoom (maximumScale unset).
  viewportFit: "cover",
  // Tint the browser/PWA chrome to match the app in each theme.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#5b5fe9" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1117" },
  ],
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
