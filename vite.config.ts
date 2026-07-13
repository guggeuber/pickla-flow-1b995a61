import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const appName = "Pickla";
  const icon192 = "/pwa-192x192.png";
  const icon512 = "/pwa-512x512.png";
  const themeColor = "#F8FAFC";

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
    __BUILD_TIME__: JSON.stringify(new Date().toISOString().slice(0, 16)),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  };
});
