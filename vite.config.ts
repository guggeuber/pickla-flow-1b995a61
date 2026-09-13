import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { execFileSync } from "node:child_process";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

function resolveBuildSha() {
  const environmentSha = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || process.env.COMMIT_SHA;
  if (environmentSha?.trim()) return environmentSha.trim();
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "local";
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const appName = "Pickla";
  const icon192 = "/pwa-192x192.png";
  const icon512 = "/pwa-512x512.png";
  const themeColor = "#F8FAFC";
  const buildIdentity = {
    sha: resolveBuildSha(),
    built_at: new Date().toISOString(),
  };
  const buildIdentityPlugin: Plugin = {
    name: "pickla-build-identity",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: `${JSON.stringify(buildIdentity)}\n`,
      });
    },
  };

  return {
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        invest: path.resolve(__dirname, "invest.html"),
      },
    },
  },
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    buildIdentityPlugin,
    VitePWA({
      registerType: "autoUpdate",
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectManifest: {
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        globPatterns: ["**/*.{js,css,ico,png,svg,woff2}"],
      },
      includeAssets: [
        "favicon.ico",
        "pwa-192x192.png",
        "pwa-512x512.png",
      ],
      manifest: {
        name: appName,
        short_name: appName,
        description: "Boka, spela och hantera ditt Pickla-konto.",
        theme_color: themeColor,
        background_color: themeColor,
        display: "standalone",
        display_override: ["standalone"],
        lang: "sv",
        orientation: "portrait",
        scope: "/",
        start_url: "/",
        id: "/",
        icons: [
          {
            src: icon192,
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: icon512,
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: icon512,
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
        shortcuts: [
          {
            name: "Idag",
            url: "/",
            icons: [{ src: icon192, sizes: "192x192" }],
          },
          {
            name: "Boka",
            url: "/book",
            icons: [{ src: icon192, sizes: "192x192" }],
          },
          {
            name: "Min profil",
            url: "/my",
            icons: [{ src: icon192, sizes: "192x192" }],
          },
        ],
      },
    }),
  ].filter(Boolean),
  define: {
    __BUILD_SHA__: JSON.stringify(buildIdentity.sha),
    __BUILD_TIME__: JSON.stringify(buildIdentity.built_at),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  };
});
