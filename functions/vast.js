export async function onRequest(context) {
  const reqUrl = new URL(context.request.url);

  const contentId = reqUrl.searchParams.get("contentId") || "default";
  const rida = reqUrl.searchParams.get("rida") || "anon";

  // Load config.json from your Pages site
  const configUrl = new URL("/ads/config.json", reqUrl.origin);

  let cfg = null;
  try {
    const cfgRes = await fetch(configUrl.toString(), {
      headers: { "Cache-Control": "no-cache" }
    });
    cfg = await cfgRes.json();
  } catch (e) {
    cfg = null;
  }

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  function isActive(ad) {
    const start = ad.start || "1900-01-01";
    const end = ad.end || "2999-12-31";
    return start <= today && today <= end;
  }

  function hash32(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = (h * 31 + str.charCodeAt(i)) >>> 0;
    }
    return h >>> 0;
  }

  // Faster rotation for testing (1-min bucket)
  const bucket = Math.floor(Date.now() / (1 * 60 * 1000)); // 1-minute bucket

  function pickRotation(list, seedStr) {
    if (!Array.isArray(list) || list.length === 0) return null;
    const h = hash32(`${seedStr}|${bucket}|${list.length}`);
    return list[h % list.length];
  }

  function pickHighestPriority(activeList, seedStr) {
    if (!Array.isArray(activeList) || activeList.length === 0) return null;
    const sorted = [...activeList].sort((a, b) => (b.priority || 0) - (a.priority || 0));
    const topPri = sorted[0].priority || 0;
    const top = sorted.filter(x => (x.priority || 0) === topPri);
    return pickRotation(top, seedStr) || top[0];
  }

  let chosen = null;

  // 1) Film-specific sponsor override
  const filmList = cfg?.filmSponsors?.[contentId];
  if (Array.isArray(filmList)) {
    const activeFilm = filmList.filter(isActive);
    chosen = pickHighestPriority(activeFilm, `film|${contentId}|${rida}`);
  }

  // 2) Otherwise: sponsorFillPercent vs houseAds
  if (!chosen) {
    const activeSponsors = (cfg?.sponsorAds || []).filter(isActive);
    const houseAds = (cfg?.houseAds || []).filter(isActive);

    const fill = Number(cfg?.defaults?.sponsorFillPercent ?? 70); // 0..100
    const roll = hash32(`fill|${contentId}|${rida}|${bucket}`) % 100;
    const chooseSponsor = (roll < fill);

    if (chooseSponsor && activeSponsors.length > 0) {
      chosen = pickHighestPriority(activeSponsors, `sponsor|${contentId}|${rida}`);
    } else if (houseAds.length > 0) {
      chosen = pickRotation(houseAds, `house|${contentId}|${rida}`);
    } else if (activeSponsors.length > 0) {
      chosen = pickHighestPriority(activeSponsors, `sponsor|${contentId}|${rida}`);
    }
  }

  // Fail-open (no ad)
  if (!chosen || !chosen.url) {
    const empty = `<?xml version="1.0" encoding="UTF-8"?><VAST version="3.0"></VAST>`;
    return new Response(empty, {
      headers: {
        "Content-Type": "application/xml; charset=UTF-8",
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        "CDN-Cache-Control": "no-store",
        "Pragma": "no-cache"
      }
    });
  }

  const durationSeconds = chosen.durationSeconds || cfg?.defaults?.durationSeconds || 15;
  const hh = String(Math.floor(durationSeconds / 3600)).padStart(2, "0");
  const mm = String(Math.floor((durationSeconds % 3600) / 60)).padStart(2, "0");
  const ss = String(durationSeconds % 60).padStart(2, "0");
  const duration = `${hh}:${mm}:${ss}`;

  // Build tracking base URL (simple endpoint on your Pages site)
  // You can make this a no-op handler if you want; RAF mainly wants the nodes to exist.
  const trackBase = new URL("/ads/track", reqUrl.origin);

  // Cache buster / deterministic id
  const cb = `${Date.now()}-${bucket}-${hash32(`${contentId}|${rida}|${chosen.id || "1"}`)}`;

  const qs = (event) =>
    `${trackBase.toString()}?e=${encodeURIComponent(event)}&contentId=${encodeURIComponent(contentId)}&adId=${encodeURIComponent(chosen.id || "1")}&rida=${encodeURIComponent(rida)}&cb=${encodeURIComponent(cb)}`;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<VAST version="3.0">
  <Ad id="${escapeXml(chosen.id || "1")}">
    <InLine>
      <AdSystem version="1.0">FlamingElephantTV</AdSystem>
      <AdTitle>${escapeXml(chosen.id || "Ad")}</AdTitle>

      <Error><![CDATA[${qs("error")}]]></Error>

      <Impression><![CDATA[${qs("impression")}]]></Impression>

      <Creatives>
        <Creative sequence="1" id="${escapeXml(chosen.id || "1")}">
          <Linear>
            <Duration>${duration}</Duration>

            <TrackingEvents>
              <Tracking event="start"><![CDATA[${qs("start")}]]></Tracking>
              <Tracking event="firstQuartile"><![CDATA[${qs("firstQuartile")}]]></Tracking>
              <Tracking event="midpoint"><![CDATA[${qs("midpoint")}]]></Tracking>
              <Tracking event="thirdQuartile"><![CDATA[${qs("thirdQuartile")}]]></Tracking>
              <Tracking event="complete"><![CDATA[${qs("complete")}]]></Tracking>
            </TrackingEvents>

            <MediaFiles>
              <MediaFile
                delivery="progressive"
                type="video/mp4"
                width="1920"
                height="1080"
                scalable="true"
                maintainAspectRatio="true"
              ><![CDATA[${chosen.url}]]></MediaFile>
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
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "CDN-Cache-Control": "no-store",
      "Pragma": "no-cache"
    }
  });
}

// Small helper to keep XML valid
function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
