import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.cragent.app",
  appName: "CRAgent",
  webDir: "dist-web",
  server: {
    iosScheme: "https",
  },
};

export default config;
