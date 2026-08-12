import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: "#102A43",
          borderRadius: 38,
          color: "#FFFFFF",
          display: "flex",
          fontSize: 68,
          fontWeight: 800,
          height: "100%",
          justifyContent: "center",
          letterSpacing: -6,
          width: "100%",
        }}
      >
        CI
        <span
          style={{
            borderBottom: "9px solid #16A34A",
            borderRight: "9px solid #16A34A",
            height: 51,
            marginLeft: 8,
            marginTop: -12,
            transform: "rotate(45deg)",
            width: 28,
          }}
        />
      </div>
    ),
    size,
  );
}
