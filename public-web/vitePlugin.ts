import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";
import { loadAcquisitionData } from "./acquisitionData";
import { renderPublicWebPage } from "./renderPage";
import { PUBLIC_WEB_ROUTES, renderPublicWebSitemap } from "./registry";

const LOGO_FILE = "public-web/pickla-logo.svg";
const VENUE_PHOTO_FILE = "public-web/pickla-venue.jpg";

export function publicWebPlugin(rootDirectory: string): Plugin {
  return {
    name: "pickla-public-web",
    async buildStart() {
      const [logo, venuePhoto] = await Promise.all([
        readFile(path.resolve(rootDirectory, "src/assets/pickla-logo.svg")),
        readFile(path.resolve(rootDirectory, "src/assets/pickla-hero-photo.jpg")),
      ]);
      this.emitFile({ type: "asset", fileName: LOGO_FILE, source: logo });
      this.emitFile({ type: "asset", fileName: VENUE_PHOTO_FILE, source: venuePhoto });
    },
    async generateBundle() {
      for (const route of PUBLIC_WEB_ROUTES) {
        const facts = await loadAcquisitionData(route);
        const html = renderPublicWebPage({
          route,
          facts,
          assets: {
            logo: `/${LOGO_FILE}`,
            venuePhoto: `/${VENUE_PHOTO_FILE}`,
          },
        });
        this.emitFile({ type: "asset", fileName: route.outputFile, source: html });
        this.emitFile({
          type: "asset",
          fileName: `public-web/${route.id}.build-facts.json`,
          source: `${JSON.stringify({
            schema_version: 1,
            route: route.pathname,
            canonical: route.canonical,
            generated_at: new Date().toISOString(),
            venue: facts.venue,
            indoor_pickleball_court_count: facts.indoorPickleballCourtCount,
            starting_court_price_sek: facts.startingCourtPriceSek,
            first_visit: facts.firstVisit,
            provenance: facts.provenance,
          }, null, 2)}\n`,
        });
      }
      this.emitFile({ type: "asset", fileName: "sitemap.xml", source: renderPublicWebSitemap() });
    },
  };
}
