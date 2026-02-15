export async function onRequest(context) {
  const reqUrl = new URL(context.request.url);

  const contentId = reqUrl.searchParams.get("contentId") || "default";
  const rida = reqUrl.searchParams.get("rida") || "anon";

  // Load config.json from your Pages site (same project)
  const configUrl = new URL("/ads/config.json", reqUrl.origin);
  const cfgRes = await fetch(configUrl.toString(), {
    // keep it simple; no caching tricks yet
    headers: { "Cache-Control": "no-cache" }
  });

  let cfg = null;
  try {
    cfg = await cfgRes.json();
  } catch (e) {
    // If config fails, fail-open to house-style fallback
    cfg = null;
  }

  const now = new Date();
  const today = now.toISOString().slice(0, 10); // YYYY-MM-DD

  function isActive(ad) {
    const start = ad.start || "1900-01-01";
    const end = ad.end || "2999-12-31";
    return start <= today && today <= end;
  }

  function pickRotation(list, seedStr) {
    if (!Array.isArray(list) || list.length === 0) return null;

    // Deterministic rotation per device per 10-minute bucket (no server state)
    const bucket = Math.floor(Date.now() / (10 * 60 * 1000)); // 10 min
    const seed = `${seedStr}|${bucket}|${list.length}`;

    let h = 0;
    for (let i = 0; i < seed.length; i++) {
      h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    }
    const idx = h % list.length;
    return list[idx];
  }

  function pickHighestPriority(activeList, seedStr) {
    if (!Array.isArray(activeList) || activeList.length === 0) return null;

    // Sort by priority desc, then rotate among same-priority
    const sorted = [...activeList].sort((a, b) => (b.priority || 0) - (a.priority || 0));
    const topPri = sorted[0].priority || 0;
    const top = sorted.filter(x => (x.priority || 0) === topPri);

    return pickRotation(top, seedStr) || top[0];
  }

  // 1) Film-specific sponsor override (if present + active)
  let chosen = null;
  const filmList = cfg?.filmSponsors?.[contentId];
  if (Array.isArray(filmList)) {
    const activeFilm = filmList.filter(isActive);
    chosen = pickHighestPriority(activeFilm, `film|${contentId}|${rida}`);
  }

  // 2) Global sponsor ads (active + priority)
  if (!chosen) {
    const activeSponsors = (cfg?.sponsorAds || []).filter(isActive);
    chosen = pickHighestPriority(activeSponsors, `sponsor|${contentId}|${rida}`);
  }

  // 3) House ads rotation fallback
  if (!chosen) {
    chosen = pickRotation(cfg?.houseAds || [], `house|${contentId}|${rida}`);
  }

  // Absolute fail-open: if no config or no ads, return empty VAST (Roku will just play content)
  if (!chosen || !chosen.url) {
    const empty = `<?xml version="1.0" encoding="UTF-8"?>
<VAST version="3.0"></VAST>`;
    return new Response(empty, {
      headers: {
        "Content-Type": "application/xml; charset=UTF-8",
        "Cache-Control": "no-store"
      }
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
    headers: {
      "Content-Type": "application/xml; charset=UTF-8",
      "Cache-Control": "no-store"
    }
  });
}
