export async function onRequest(context) {
  const reqUrl = new URL(context.request.url);

  const contentId = reqUrl.searchParams.get("contentId") || "default";
  const rida = reqUrl.searchParams.get("rida") || "anon";

  // Load config.json from same Pages site
  const configUrl = new URL("/ads/config.json", reqUrl.origin);
  const cfgRes = await fetch(configUrl.toString(), {
    headers: { "Cache-Control": "no-cache" }
  });

  let cfg = null;
  try {
    cfg = await cfgRes.json();
  } catch (e) {
    cfg = null;
  }

  const now = new Date();
  const today = now.toISOString().slice(0, 10); // YYYY-MM-DD

  function isActive(ad) {
    const start = ad.start || "1900-01-01";
    const end = ad.end || "2999-12-31";
    return start <= today && today <= end;
  }

  // Deterministic hash 0..99 (so "rotation" is stable per device per 10-min bucket)
  function hashPercent(seedStr) {
    const bucket = Math.floor(Date.now() / (10 * 60 * 1000)); // 10 min
    const seed = `${seedStr}|${bucket}`;
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    return h % 100;
  }

  function pickRotation(list, seedStr) {
    if (!Array.isArray(list) || list.length === 0) return null;
    const bucket = Math.floor(Date.now() / (10 * 60 * 1000));
    const seed = `${seedStr}|${bucket}|${list.length}`;
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    return list[h % list.length];
  }

  function pickHighestPriority(activeList, seedStr) {
    if (!Array.isArray(activeList) || activeList.length === 0) return null;
    const sorted = [...activeList].sort((a, b) => (b.priority || 0) - (a.priority || 0));
    const topPri = sorted[0].priority || 0;
    const top = sorted.filter(x => (x.priority || 0) === topPri);
    return pickRotation(top, seedStr) || top[0];
  }

  // 1) Film-specific sponsor override (if present + active) ALWAYS wins
  let chosen = null;
  const filmList = cfg?.filmSponsors?.[contentId];
  if (Array.isArray(filmList)) {
    const activeFilm = filmList.filter(isActive);
    chosen = pickHighestPriority(activeFilm, `film|${contentId}|${rida}`);
  }

  // 2) Otherwise: MIX sponsor vs house using sponsorFillPercent
  if (!chosen) {
    const activeSponsors = (cfg?.sponsorAds || []).filter(isActive);
    const houseAds = (cfg?.houseAds || []).filter(isActive);

    const sponsorFill = cfg?.defaults?.sponsorFillPercent ?? 100; // default 100% sponsor
    const p = hashPercent(`mix|${contentId}|${rida}`);

    const shouldUseSponsor = (activeSponsors.length > 0) && (p < sponsorFill);

    if (shouldUseSponsor) {
      chosen = pickHighestPriority(activeSponsors, `sponsor|${contentId}|${rida}`);
    } else if (houseAds.length > 0) {
      chosen = pickRotation(houseAds, `house|${contentId}|${rida}`);
    } else if (activeSponsors.length > 0) {
      // if house is empty, fall back to sponsor
      chosen = pickHighestPriority(activeSponsors, `sponsor|${contentId}|${rida}`);
    }
  }

  // Absolute fail-open: return empty VAST (Roku plays content)
  if (!chosen || !chosen.url) {
    const empty = `<?xml version="1.0" encoding="UTF-8"?>
<VAST version="3.0"></VAST>`;
    return new Response(empty, {
      headers: { "Content-Type": "application/xml; charset=UTF-8", "Cache-Control": "no-store" }
    });
  }

  const durationSeconds = chosen.durationSeconds || cfg?.defaults?.durationSeconds || 15;
  const hh = String(Math.floor(durationSeconds / 3600)).padStart(2, "0");
  const mm = String(Math.floor((durationSeconds % 3600) / 60)).padStart(2, "0");
  const ss = String(durationSeconds % 60).padStart(2, "0");
  const duration = `${hh}:${mm}:${ss}`;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<VAST version="3.0">
  <Ad id="${chosen.id || "1"}">
    <InLine>
      <AdSystem version="1.0">FlamingElephantTV</AdSystem>
      <AdTitle>${chosen.id || "Ad"}</AdTitle>
      <Creatives>
        <Creative sequence="1">
          <Linear>
            <Duration>${duration}</Duration>
            <MediaFiles>
              <MediaFile delivery="progressive" type="video/mp4" width="1920" height="1080">
                <![CDATA[${chosen.url}]]>
              </MediaFile>
            </MediaFiles>
          </Linear>
        </Creative>
      </Creatives>
    </InLine>
  </Ad>
</VAST>`;

  return new Response(xml, {
    headers: { "Content-Type": "application/xml; charset=UTF-8", "Cache-Control": "no-store" }
  });
}
