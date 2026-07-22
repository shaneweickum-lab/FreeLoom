import type { Metadata, Viewport } from "next";
import { Fraunces, IBM_Plex_Mono, Inter } from "next/font/google";
import { APP_URL } from "@/lib/appUrl";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  weight: "variable",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  weight: "variable",
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
});

const TITLE = "FreeLoom — Homeschool Transcript Builder";
const DESCRIPTION = "Real learning, formally recorded.";

export const metadata: Metadata = {
  // Required to resolve the file-convention opengraph-image/icon routes
  // (see opengraph-image.tsx) into absolute URLs for og:image/twitter:image
  // -- without this, link previews (iMessage, Slack, X, Safari/Arc hover
  // previews) have nothing to show.
  metadataBase: new URL(APP_URL),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    siteName: "FreeLoom",
    url: APP_URL,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

// Tints Safari's tab/URL bar (and the iOS status bar once added to the
// home screen) to match the app's own background instead of Safari's
// default white/gray chrome.
export const viewport: Viewport = {
  themeColor: "#0a0d1c",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${fraunces.variable} ${plexMono.variable} h-full antialiased`}
    >
      {/*
        No shared nav/footer here on purpose: the landing page and the
        authenticated app have genuinely different chrome (a self-contained
        marketing nav with anchor links vs. the app's own left rail), so
        each route group supplies its own instead of one wrapper trying to
        serve both. See src/app/(app)/layout.tsx (AppRail) and
        src/app/page.tsx.
      */}
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
