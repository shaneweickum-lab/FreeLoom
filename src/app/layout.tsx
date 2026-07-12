import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import NavBar from "@/components/NavBar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <NavBar />
        <main className="flex-1 mx-auto w-full max-w-5xl px-4 sm:px-6 py-8 sm:py-10">{children}</main>
        <footer className="border-t border-border">
          <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6 text-xs text-muted flex flex-wrap items-center justify-between gap-2">
            <span>© {new Date().getFullYear()} FreeLoom. Real learning, formally recorded.</span>
            <span>An agentic AI platform for homeschool records.</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
