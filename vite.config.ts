import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";
import { renderPwaSurfaceBootstrap } from "./src/lib/pwaSurface";
import { publicWebPlugin } from "./public-web/vitePlugin";

function resolveBuildSha() {
  const environmentSha = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || process.env.COMMIT_SHA;
  if (environmentSha?.trim()) return environmentSha.trim();
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "local";
  }
}

type BuildIdentity = {
  sha: string;
  built_at: string;
  deployment_id: string;
  deployment_url: string;
  environment: string;
};

function resolveBuildIdentity(): BuildIdentity {
  try {
    const identity = JSON.parse(
      readFileSync(path.resolve(__dirname, "api/_release-identity.generated.json"), "utf8"),
    ) as Partial<BuildIdentity>;
    if (
      identity.sha
      && identity.built_at
      && identity.deployment_id
      && identity.deployment_url
      && identity.environment
      && !Number.isNaN(Date.parse(identity.built_at))
    ) return identity as BuildIdentity;
  } catch {
    // Dev/test config loads do not require the generated deployment identity.
  }
  const sha = resolveBuildSha();
  return {
    sha,
    built_at: new Date().toISOString(),
    deployment_id: process.env.VERCEL_DEPLOYMENT_ID || `local-${sha.slice(0, 12)}`,
    deployment_url: process.env.VERCEL_URL || "localhost",
    environment: process.env.VERCEL_ENV || "development",
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const buildIdentity = resolveBuildIdentity();
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
  const pwaSurfaceHtmlPlugin: Plugin = {
    name: "pickla-pwa-surface-bootstrap",
    transformIndexHtml() {
      return [{
        tag: "script",
        attrs: { id: "pickla-pwa-surface-bootstrap" },
        children: renderPwaSurfaceBootstrap(),
        injectTo: "head-prepend",
      }];
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
    pwaSurfaceHtmlPlugin,
    publicWebPlugin(__dirname),
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
        "pwa-customer-192x192.png",
        "pwa-customer-512x512.png",
        "pwa-customer-maskable-512x512.png",
        "pwa-desk-192x192.png",
        "pwa-desk-512x512.png",
        "pwa-desk-maskable-512x512.png",
        "pwa-admin-192x192.png",
        "pwa-admin-512x512.png",
        "pwa-admin-maskable-512x512.png",
      ],
      manifest: false,
    }),
  ].filter(Boolean),
  define: {
    __BUILD_SHA__: JSON.stringify(buildIdentity.sha),
    __BUILD_TIME__: JSON.stringify(buildIdentity.built_at),
    __BUILD_DEPLOYMENT_ID__: JSON.stringify(buildIdentity.deployment_id),
    __BUILD_DEPLOYMENT_URL__: JSON.stringify(buildIdentity.deployment_url),
    __BUILD_ENVIRONMENT__: JSON.stringify(buildIdentity.environment),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  };
});
