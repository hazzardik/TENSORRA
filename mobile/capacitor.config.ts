import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "ai.tensorra.app",
  appName: "TENSORRA",
  webDir: "www",
  server: {
    // Replace after web deployment. This lets iOS/Android use the same secure TENSORRA web app.
    url: process.env.TENSORRA_WEB_URL ?? "https://app.tensorra.ai",
    cleartext: false,
  },
  ios: { contentInset: "always" },
  android: { allowMixedContent: false },
};

export default config;
