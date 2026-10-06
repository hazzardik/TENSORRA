import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import PwaRegister from "@/components/pwa-register";
import "katex/dist/katex.min.css";
import "./globals.css";
import "./table-responsive.css";
import "./design-v022.css";

const inter = Inter({
  subsets: ["latin", "cyrillic"],
  variable: "--font-inter",
  display: "swap",
});

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
      <body className={inter.variable}>
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
