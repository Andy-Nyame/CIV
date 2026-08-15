import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CIV — Create. Issue. Verify.",
    short_name: "CIV",
    description:
      "Create, issue, store and manage professional business documents from one secure workspace.",
    start_url: "/",
    display: "standalone",
    background_color: "#F7F9FC",
    theme_color: "#102A43",
    icons: [{ src: "/icon", sizes: "64x64", type: "image/png" }],
  };
}
