import http from "node:http";

const port = Number(process.env.FAKE_STRIPE_PORT || 55440);
let sequence = 0;

const server = http.createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
  response.setHeader("content-type", "application/json");

  if (request.method === "POST" && request.url === "/v1/checkout/sessions") {
    if (form.get("customer_email")?.startsWith("fail-")) {
      response.statusCode = 402;
      response.end(JSON.stringify({ error: { message: "Local test payment failure" } }));
      return;
    }
    sequence += 1;
    const id = `cs_test_commerce_r1_${sequence}`;
    const expiresAt = form.get("expires_at") || "";
    response.end(JSON.stringify({ id, url: `http://127.0.0.1:${port}/checkout?session=${id}&expires_at=${expiresAt}` }));
    return;
  }

  if (request.method === "POST" && /^\/v1\/checkout\/sessions\/[^/]+\/expire$/.test(request.url || "")) {
    response.end(JSON.stringify({ id: request.url.split("/")[4], status: "expired" }));
    return;
  }

  if (request.method === "POST" && request.url === "/v1/refunds") {
    sequence += 1;
    response.end(JSON.stringify({ id: `re_test_commerce_r1_${sequence}`, status: "succeeded" }));
    return;
  }

  response.statusCode = 404;
  response.end(JSON.stringify({ error: { message: "Unknown local Stripe test route" } }));
});

server.listen(port, "0.0.0.0", () => {
  process.stdout.write(`fake-stripe-ready:${port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
