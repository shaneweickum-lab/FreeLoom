import { ImageResponse } from "next/og";

// Safari-specific: this is what "Add to Home Screen" (iOS) and Reading
// List/Top Sites (macOS) actually use -- icon.tsx's rounded-square favicon
// is never shown in those contexts. 180x180 is Apple's documented target
// size for the highest-density (@3x) home-screen icon. No border-radius
// here on purpose: iOS/iPadOS applies its own corner mask to home-screen
// icons, so a pre-rounded source image would double up and look wrong.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#1c2242",
        }}
      >
        <svg width="112" height="112" viewBox="0 0 32 32" fill="none">
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
    ),
    { ...size }
  );
}
