import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: "#102A43",
          borderRadius: 14,
          color: "#FFFFFF",
          display: "flex",
          fontSize: 24,
          fontWeight: 800,
          height: "100%",
          justifyContent: "center",
          letterSpacing: -2,
          width: "100%",
        }}
      >
        CI
        <span
          style={{
            borderBottom: "4px solid #16A34A",
            borderRight: "4px solid #16A34A",
            height: 20,
            marginLeft: 3,
            marginTop: -5,
            transform: "rotate(45deg)",
            width: 11,
          }}
        />
      </div>
    ),
    size,
  );
}
