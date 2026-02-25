export async function onRequest(context) {
  const { request } = context;

  // Signature + CORS for EVERY response
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "X-FEF-Func": "mux-beacon",
    "Content-Type": "application/json",
  };

  // Preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  // Only POST
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, reason: "Method Not Allowed", method: request.method }), {
      status: 405,
      headers,
    });
  }

  // Read JSON
  try {
    await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, reason: "Bad JSON" }), {
      status: 400,
      headers,
    });
  }

  // TEMP: succeed so Flutter stops failing
  return new Response(null, { status: 204, headers });
}
