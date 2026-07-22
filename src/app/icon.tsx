import { ImageResponse } from "next/og";

// Matches src/components/LogoMark.tsx's woven gold/violet "F" mark exactly
// (same paths/colors) -- kept in sync manually since ImageResponse can't
// import a "use client" component. Update both if the brand mark changes.
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
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
          borderRadius: 8,
        }}
      >
        <svg width="22" height="22" viewBox="0 0 32 32" fill="none">
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
