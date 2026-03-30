import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { url } = await req.json();
    if (!url || typeof url !== "string") {
      return new Response(JSON.stringify({ error: "url required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch the URL with a timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; LinkPreviewBot/1.0)",
        Accept: "text/html",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timeout);

    const html = await res.text();

    // Extract og/meta tags
    const getMetaContent = (property: string): string | null => {
      // Try og:property
      const ogMatch = html.match(
        new RegExp(`<meta[^>]*property=["']og:${property}["'][^>]*content=["']([^"']*)["']`, "i")
      );
      if (ogMatch) return ogMatch[1];

      // Try reversed attribute order
      const ogMatch2 = html.match(
        new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:${property}["']`, "i")
      );
      if (ogMatch2) return ogMatch2[1];

      // Try name= fallback (for description)
      if (property === "description") {
        const nameMatch = html.match(
          /meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i
        );
        if (nameMatch) return nameMatch[1];
      }

      return null;
    };

    // Extract title from <title> tag as fallback
    const titleTag = html.match(/<title[^>]*>([^<]*)<\/title>/i);

    const preview = {
      title: getMetaContent("title") || titleTag?.[1]?.trim() || null,
      description: getMetaContent("description") || null,
      image: getMetaContent("image") || null,
      site_name: getMetaContent("site_name") || null,
      url,
    };

    return new Response(JSON.stringify(preview), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Could not fetch preview" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
