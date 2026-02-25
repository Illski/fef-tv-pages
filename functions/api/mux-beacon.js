export async function onRequest(context) {
  const { request } = context;

  // Handle CORS preflight
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

  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return new Response("Bad JSON", { status: 400 });
  }

  try {
    // Forward directly to Mux collector
    const muxResponse = await fetch("https://collector.mux.com/events", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    // Optional: log status for debugging
    console.log("Forwarded to Mux:", muxResponse.status);

    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
    });

  } catch (err) {
    console.error("Mux forwarding error:", err);

    return new Response("Mux forwarding failed", { status: 500 });
  }
}
