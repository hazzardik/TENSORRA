import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import PwaRegister from "@/components/pwa-register";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "TENSORRA", template: "%s · TENSORRA" },
  description: "ИИ с рассуждением, памятью, анализом файлов и автоматическими инструментами.",
  applicationName: "TENSORRA",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "TENSORRA",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/icons/tensorra.svg",
    apple: "/icons/tensorra.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#07090d",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
