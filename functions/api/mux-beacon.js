export async function onRequest(context) {
  const { request } = context;

  // CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  // Only allow POST (this stops 405 issues)
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // Read the JSON body (so we know we received it)
  let payload = null;
  try {
    payload = await request.json();
  } catch (e) {
    return new Response("Bad JSON", { status: 400 });
  }

  // TEMP: return success immediately so your Flutter app stops failing.
  // (We can add forwarding to Mux after this is stable.)
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json",
    },
  });
}
