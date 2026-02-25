export async function onRequest(context) {
  const { request } = context;

  // Mux Roku docs show mux_base_url example as https://img.litix.io
  // Use that as the upstream collector base.
  const MUX_COLLECTOR_BASE = "https://img.litix.io";

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

  // (Optional) quick health check in browser
  if (request.method === "GET") {
    return new Response("ok", {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "X-FEF-Signature": "mux-beacon-v1",
        "Content-Type": "text/plain",
      },
    });
  }

  // Only allow POST
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "X-FEF-Signature": "mux-beacon-v1",
      },
    });
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
  let muxStatus = 0;
  let muxOk = false;

  try {
    const upstream = await fetch(MUX_COLLECTOR_BASE + "/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json,text/plain,*/*",
        // Helps some CDNs/WAFs that dislike "empty" UA
        "User-Agent": "Flaming-Elephant-TV/1.0 (CloudflarePagesFunction)",
      },
      body: JSON.stringify(payload),
    });

    muxStatus = upstream.status;
    muxOk = upstream.ok;
  } catch (e) {
    muxStatus = 0;
    muxOk = false;
  }

  // Always return 204 to the app (so playback never fails),
  // but expose forwarding result via headers.
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json",
      "X-FEF-Signature": "mux-beacon-v1",
      "X-Mux-Forward-Status": String(muxStatus),
      "X-Mux-Forward-Ok": muxOk ? "true" : "false",
    },
  });
}
