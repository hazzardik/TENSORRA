"use client";

import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export default function InstallAppButton({ compact = false }: { compact?: boolean }) {
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [standalone, setStandalone] = useState(false);

  useEffect(() => {
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
    setStandalone(window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
    const handler = (raw: Event) => {
      raw.preventDefault();
      setEvent(raw as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (standalone) return null;

  async function install() {
    if (event) {
      await event.prompt();
      const choice = await event.userChoice;
      if (choice.outcome === "accepted") setEvent(null);
      return;
    }
    if (ios) {
      window.alert("На iPhone/iPad: нажми «Поделиться» в Safari → «На экран Домой».");
      return;
    }
    window.alert("Открой TENSORRA в Chrome/Edge и выбери «Установить приложение» в меню браузера.");
  }

  return (
    <button className={compact ? "installButton compact" : "installButton"} onClick={() => void install()}>
      {compact ? "Install" : "Install TENSORRA"}
    </button>
  );
}
