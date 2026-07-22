import { ImageResponse } from "next/og";

// Shown when a FreeLoom link is shared/hovered/previewed (iMessage, Slack,
// Twitter/X, Safari/Arc link previews, etc.) -- same navy/gold/violet "F"
// mark as icon.tsx and LogoMark.tsx, kept in sync manually since
// ImageResponse can't import a "use client" component.
export const alt = "FreeLoom — Real learning, formally recorded.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
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
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 108,
              height: 108,
              borderRadius: 24,
              background: "#1c2242",
              border: "2px solid #2b3260",
            }}
          >
            <svg width="64" height="64" viewBox="0 0 32 32" fill="none">
              <path
                d="M11 26V9h13"
                stroke="#8968c9"
                strokeWidth="3.25"
                strokeLinecap="round"
                strokeLinejoin="round"
                transform="translate(1.2,-1.2)"
              />
              <path d="M10 25V8h13M10 16h9.5" stroke="#c7a252" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div style={{ display: "flex", fontSize: 88, fontWeight: 700, color: "#ece8de" }}>FreeLoom</div>
        </div>
        <div style={{ display: "flex", fontSize: 32, color: "#9b96b3" }}>Real learning, formally recorded.</div>
      </div>
    ),
    { ...size }
  );
}
