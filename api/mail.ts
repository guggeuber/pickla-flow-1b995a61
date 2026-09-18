const UPSTREAM_ORIGIN = 'https://ptnvhbniiiapzbyofctg.supabase.co/functions/v1';
const MAX_SUBSCRIBE_BODY_BYTES = 4 * 1024;

function noStoreHeaders(contentType = 'application/json; charset=utf-8') {
  return {
    'Cache-Control': 'private, no-store',
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
  };
}

function errorResponse(status: number) {
  return Response.json({ error: 'Communication request failed' }, {
    status,
    headers: noStoreHeaders(),
  });
}

export default {
  async fetch(request: Request) {
    const credential = process.env.PICKLA_MAIL_PROXY_CREDENTIAL || '';
    if (credential.length < 35 || !credential.includes(':')) return errorResponse(503);

    const incomingUrl = new URL(request.url);
    const action = incomingUrl.searchParams.get('action');
    const isSubscribe = action === 'subscribe' && request.method === 'POST';
    const isConfirm = action === 'confirm' && request.method === 'GET';
    if (!isSubscribe && !isConfirm) return errorResponse(404);

    let body: ArrayBuffer | undefined;
    if (isSubscribe) {
      const announcedSize = Number(request.headers.get('content-length') || '0');
      if (announcedSize > MAX_SUBSCRIBE_BODY_BYTES) return errorResponse(413);
      body = await request.arrayBuffer();
      if (body.byteLength > MAX_SUBSCRIBE_BODY_BYTES) return errorResponse(413);
    }

    const upstreamUrl = new URL(`${UPSTREAM_ORIGIN}/api-communications/${action}`);
    if (isConfirm) upstreamUrl.searchParams.set('token', incomingUrl.searchParams.get('token') || '');

    const clientNetwork = request.headers.get('x-forwarded-for')
      || request.headers.get('x-real-ip')
      || '';
    const upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers: {
        ...(isSubscribe ? { 'Content-Type': 'application/json' } : {}),
        'x-pickla-client-network': clientNetwork.split(',')[0].trim(),
        'x-pickla-mail-proxy': credential,
      },
      ...(body ? { body } : {}),
      redirect: 'manual',
    });

    const contentType = upstream.headers.get('content-type') || (isConfirm
      ? 'text/html; charset=utf-8'
      : 'application/json; charset=utf-8');
    return new Response(upstream.body, {
      status: upstream.status,
      headers: noStoreHeaders(contentType),
    });
  },
};
