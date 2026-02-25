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
        "X-FEF-Signature": "mux-beacon-v1",
      },
    });
  }

  // Only allow POST
  if (request.method !== "POST") {
    return new Response(
      JSON.stringify({ ok: false, reason: "Method Not Allowed", method: request.method }),
      {
        status: 405,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
          "X-FEF-Signature": "mux-beacon-v1",
        },
      }
    );
  }

  // Read JSON body
  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return new Response("Bad JSON", {
      status: 400,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "X-FEF-Signature": "mux-beacon-v1",
      },
    });
  }

  // Forward to Mux collector
  // NOTE: This is the missing piece. Without this forward, Mux will never show anything.
  const muxUrl = "https://img.mux.com"; // collector domain

  try {
    const muxResp = await fetch(muxUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    // Return success to client regardless; you can tighten later
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "X-FEF-Signature": "mux-beacon-v1",
        "X-Mux-Forward-Status": String(muxResp.status),
      },
    });
  } catch (e) {
    // If forwarding fails, still return 204 so app doesn't break (for now),
    // but expose failure in a header.
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "X-FEF-Signature": "mux-beacon-v1",
        "X-Mux-Forward-Status": "forward_failed",
      },
    });
  }
}
