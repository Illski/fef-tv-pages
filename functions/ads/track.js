export async function onRequest() {
  return new Response("", {
    status: 204,
    headers: { "Cache-Control": "no-store" }
  });
}
