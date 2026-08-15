import { ImageResponse } from "next/og";

export const alt = "CIV — Create. Issue. Verify.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", background: "#f7f9fc", color: "#102a43", padding: "72px", fontFamily: "sans-serif" }}>
      <div style={{ width: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", borderTop: "10px solid #2563eb", paddingTop: "48px" }}>
        <div style={{ display: "flex", alignItems: "center", fontSize: 62, fontWeight: 800, letterSpacing: "-4px" }}>
          CI
          <svg aria-hidden="true" width="58" height="58" viewBox="0 0 58 58" fill="none" style={{ marginLeft: "2px" }}>
            <path d="M10 30.5 23.5 44 49 13" stroke="#16a34a" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ maxWidth: "940px", fontSize: 68, lineHeight: 1.05, fontWeight: 750, letterSpacing: "-3px" }}>Professional business documents, without the paperwork headache.</div>
          <div style={{ marginTop: "30px", fontSize: 26, color: "#52667a", letterSpacing: "1px" }}>Create. Issue. Verify.</div>
        </div>
      </div>
    </div>,
    size,
  );
}
