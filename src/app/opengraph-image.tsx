import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Shown when a FreeLoom link is shared/hovered/previewed (iMessage, Slack,
// Twitter/X, Safari/Arc link previews, etc.) -- same brand mark as
// src/app/icon.png and LogoMark.tsx, but reads FreeLoom-Logo-og.png (a
// 240x240 resize of the real public/FreeLoom-Logo.png) rather than the
// full source art: this route stays code-generated (composes a
// background/gradient/wordmark, so it can't use the static-file icon
// convention), and there's no reason to base64-inline a 2MB image for a
// mark rendered at 108px. Read + base64-inlined rather than referenced by
// URL: ImageResponse's Satori renderer can't fetch a relative "/..." path
// the way a browser would, per Next.js's own ImageResponse docs.
export const alt = "FreeLoom — Real learning, formally recorded.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const logoData = await readFile(join(process.cwd(), "public", "FreeLoom-Logo-og.png"), "base64");
  const logoSrc = `data:image/png;base64,${logoData}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 28,
          background: "#0a0d1c",
          backgroundImage:
            "radial-gradient(circle at 30% 20%, rgba(199,162,82,0.16), transparent 55%), radial-gradient(circle at 75% 75%, rgba(137,104,201,0.16), transparent 55%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <img src={logoSrc} width={108} height={108} alt="" />
          <div style={{ display: "flex", fontSize: 88, fontWeight: 700, color: "#ece8de" }}>FreeLoom</div>
        </div>
        <div style={{ display: "flex", fontSize: 32, color: "#9b96b3" }}>Real learning, formally recorded.</div>
      </div>
    ),
    { ...size }
  );
}
