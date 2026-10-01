import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TENSORRA AI",
    short_name: "TENSORRA",
    description: "Reasoning AI with memory, private knowledge and tools.",
    start_url: "/app",
    display: "standalone",
    background_color: "#07090d",
    theme_color: "#07090d",
    orientation: "any",
    icons: [
      { src: "/icons/tensorra.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icons/tensorra.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
