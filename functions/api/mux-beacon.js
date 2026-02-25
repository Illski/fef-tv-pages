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
        "X-FEF-Signature": "mux-beacon-v2",
      },
    });
  }

  if (request.method !== "POST") {
    return new Response(
      JSON.stringify({ ok: false, reason: "Method Not Allowed", method: request.method }),
      {
        status: 405,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
          "X-FEF-Signature": "mux-beacon-v2",
        },
      }
    );
  }

  // Read JSON body
  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, reason: "Bad JSON" }), {
      status: 400,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
        "X-FEF-Signature": "mux-beacon-v2",
      },
    });
  }

  // === Forward to Mux collector ===
  // NOTE: If this endpoint is wrong for your Mux product/config, it will fail.
  const muxUrl = "https://img.litix.io/api/v1/beacon";

  let forwardStatus = 0;
  let forwardOk = false;
  let forwardErr = "";

  try {
    const resp = await fetch(muxUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Adding a UA sometimes helps with edge filters
        "User-Agent": "FlamingElephantTV/1.0 (CloudflareWorker)",
      },
      body: JSON.stringify(payload),
    });

    forwardStatus = resp.status;
    forwardOk = resp.ok;

    // Don’t return the whole body (can be large / noisy), but keep short info
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      forwardErr = (txt || "").slice(0, 200);
    }
  } catch (e) {
    forwardErr = String(e);
  }

  // Return 204 to Flutter (so your app doesn’t fail),
  // but include forwarding status headers so we can debug.
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json",
      "X-FEF-Signature": "mux-beacon-v2",
      "X-Mux-Forward-Status": String(forwardStatus),
      "X-Mux-Forward-Ok": String(forwardOk),
      "X-Mux-Forward-Error": forwardErr ? encodeURIComponent(forwardErr) : "",
    },
  });
}
