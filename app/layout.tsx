import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hack Club DNS Editor",
  description: "Browse Hack Club DNS records and open pull requests to add subdomains.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

// Kumo switches palettes on `data-mode`; follow the OS setting before first paint.
const themeScript = `(() => {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = () => (document.documentElement.dataset.mode = mq.matches ? "dark" : "light");
  apply();
  mq.addEventListener("change", apply);
})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="bg-kumo-canvas text-kumo-default antialiased">
        <Providers>{children}</Providers>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
