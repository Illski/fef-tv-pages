// functions/ads/vast.xml.js
// Reads your config.json and picks the right ad (film sponsor → sponsor → house ad cycle)

export async function onRequest(context) {
  const url = new URL(context.request.url);

  const contentId  = url.searchParams.get('contentId') || 'unknown';
  const breakType  = url.searchParams.get('break')     || 'preroll';
  const posSeconds = parseInt(url.searchParams.get('pos') || '0', 10);

  // Load config from root (after you moved it)
  const configMod = await import('../../config.json', { with: { type: 'json' } });
  const config = configMod.default || configMod;

  const now = new Date().toISOString().split('T')[0];

  function isActive(ad) {
    if (!ad.start || !ad.end) return true;
    return now >= ad.start && now <= ad.end;
  }

  let selectedAd = null;

  // 1. Per-film sponsor (highest priority)
  if (config.filmSponsors && config.filmSponsors[contentId]) {
    const filmAds = config.filmSponsors[contentId].filter(isActive);
    if (filmAds.length > 0) {
      selectedAd = filmAds.sort((a, b) => (b.priority || 0) - (a.priority || 0))[0];
    }
  }

  // 2. Global sponsors (70% chance)
  if (!selectedAd && config.sponsorAds) {
    const activeSponsors = config.sponsorAds.filter(isActive);
    if (activeSponsors.length > 0) {
      const fill = (config.defaults?.sponsorFillPercent || 70) / 100;
      if (Math.random() < fill) {
        selectedAd = activeSponsors.sort((a, b) => (b.priority || 0) - (a.priority || 0))[0];
      }
    }
  }

  // 3. Cycle through your 10 house ads
  if (!selectedAd && config.houseAds && config.houseAds.length > 0) {
    const houseAds = config.houseAds;
    let seed = 0;
    const key = `${contentId}-${breakType}-${Math.floor(posSeconds / 900)}`;
    for (let i = 0; i < key.length; i++) {
      seed = (seed * 31 + key.charCodeAt(i)) | 0;
    }
    const index = Math.abs(seed) % houseAds.length;
    selectedAd = houseAds[index];
  }

  if (!selectedAd && config.houseAds?.length) selectedAd = config.houseAds[0];

  const adUrl = selectedAd?.url || '';
  const duration = selectedAd?.durationSeconds || (config.defaults?.durationSeconds || 15);

  const vastXml = `<?xml version="1.0" encoding="UTF-8"?>
<VAST version="3.0">
  <Ad id="FEF-${selectedAd?.id || 'house'}">
    <InLine>
      <AdSystem version="1.0">FlamingElephantTV</AdSystem>
      <AdTitle>${selectedAd?.id || 'House Ad'}</AdTitle>

      <Error><![CDATA[https://fef-tv-pages.pages.dev/ads/pixel]]></Error>
      <Impression><![CDATA[https://fef-tv-pages.pages.dev/ads/pixel]]></Impression>

      <Creatives>
        <Creative sequence="1">
          <Linear>
            <Duration>00:00:${duration.toString().padStart(2, '0')}</Duration>

            <TrackingEvents>
              <Tracking event="start"><![CDATA[https://fef-tv-pages.pages.dev/ads/pixel]]></Tracking>
              <Tracking event="firstQuartile"><![CDATA[https://fef-tv-pages.pages.dev/ads/pixel]]></Tracking>
              <Tracking event="midpoint"><![CDATA[https://fef-tv-pages.pages.dev/ads/pixel]]></Tracking>
              <Tracking event="thirdQuartile"><![CDATA[https://fef-tv-pages.pages.dev/ads/pixel]]></Tracking>
              <Tracking event="complete"><![CDATA[https://fef-tv-pages.pages.dev/ads/pixel]]></Tracking>
            </TrackingEvents>

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

  return new Response(vastXml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'no-store, no-cache'
    }
  });
}
