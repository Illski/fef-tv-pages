export async function onRequest(context) {
  const url = new URL(context.request.url);
  const contentId = url.searchParams.get("contentId") || "default";

  // Default ad (house/sponsor)
  let adUrl = "https://cdn.flamingelephantfilms.com/ads/sponsorA.mp4";

  // Example: film-specific sponsor
  if (contentId === "47b1e093-8335-45df-8e04-9d491ba4d70b") {
    adUrl = "https://cdn.flamingelephantfilms.com/ads/merryMayhemSponsor.mp4";
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<VAST version="3.0">
  <Ad id="1">
    <InLine>
      <AdSystem version="1.0">FlamingElephantTV</AdSystem>
      <AdTitle>Dynamic Sponsor</AdTitle>
      <Impression><![CDATA[https://fef-tv-pages.pages.dev/track?ad=1]]></Impression>
      <Creatives>
        <Creative sequence="1">
          <Linear>
            <Duration>00:00:15</Duration>
            <MediaFiles>
              <MediaFile delivery="progressive" type="video/mp4" width="1920" height="1080">
                <![CDATA[${adUrl}]]>
              </MediaFile>
            </MediaFiles>
          </Linear>
        </Creative>
      </Creatives>
    </InLine>
  </Ad>
</VAST>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=UTF-8",
      "Cache-Control": "no-store"
    }
  });
}


