import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TENSORRA ИИ",
    short_name: "TENSORRA",
    description: "ИИ с памятью, анализом файлов и автоматическим выбором инструментов.",
    start_url: "/app",
    display: "standalone",
    background_color: "#07090d",
    theme_color: "#07090d",
    orientation: "any",
    lang: "ru",
    icons: [
      { src: "/icons/tensorra.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icons/tensorra.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
