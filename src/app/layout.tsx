import type { Metadata } from "next";
import { Fraunces, IBM_Plex_Mono, Inter } from "next/font/google";
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

export const metadata: Metadata = {
  title: "FreeLoom — Homeschool Transcript Builder",
  description: "Real learning, formally recorded.",
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
        No shared NavBar/footer here on purpose: the landing page and the
        authenticated app now have genuinely different chrome (a
        self-contained marketing nav with anchor links vs. the app's own
        nav), so each route group supplies its own instead of one wrapper
        trying to serve both. See src/app/(app)/layout.tsx and
        src/app/page.tsx.
      */}
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
