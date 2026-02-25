export async function onRequest(context) {
  const { request } = context;

  const headersBase = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "X-FEF-Signature": "mux-beacon-v1" // <-- signature header (temporary)
  };

  // CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: headersBase });
  }

  // Only allow POST
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: headersBase });
  }

  // Read the JSON body
  try {
    await request.json();
  } catch (e) {
    return new Response("Bad JSON", { status: 400, headers: headersBase });
  }

  // TEMP: success immediately
  return new Response(null, { status: 204, headers: headersBase });
}
