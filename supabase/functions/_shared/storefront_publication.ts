export const STOREFRONT_MEDIA_CACHE_HEADERS = {
  'Cache-Control': 'private, no-store, no-cache, must-revalidate, max-age=0',
  'CDN-Cache-Control': 'no-store',
  'Vercel-CDN-Cache-Control': 'no-store',
  'Surrogate-Control': 'no-store',
  'Vary': 'Authorization, Accept-Encoding',
} as const;

export function storefrontProductIsPublicForLocale(
  productId: string,
  productsWithPresentation: ReadonlySet<string>,
  publishedPresentationProductIdsForLocale: ReadonlySet<string>,
) {
  return !productsWithPresentation.has(productId)
    || publishedPresentationProductIdsForLocale.has(productId);
}
