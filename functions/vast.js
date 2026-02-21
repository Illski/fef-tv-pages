// functions/vast.js
export async function onRequest(context) {
  const reqUrl = new URL(context.request.url);

  const contentId = reqUrl.searchParams.get("contentId") || "default";
  const rida = reqUrl.searchParams.get("rida") || "anon";

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

  const defaults = cfg?.defaults || {};
  const durationFallback = Number(defaults.durationSeconds ?? 15);

  // ✅ Master switch (server-side) — flip in config.json anytime
  const serveSponsors = Boolean(defaults.serveSponsors ?? false);

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

  // 1-minute bucket for testing (change later if you want)
  const bucket = Math.floor(Date.now() / (60 * 1000));

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

  // ✅ Sponsors are supported, but only served when serveSponsors=true
  if (serveSponsors) {
    // A) Film-specific sponsor override
    const filmList = cfg?.filmSponsors?.[contentId];
    if (Array.isArray(filmList)) {
      const activeFilm = filmList.filter(isActive);
      chosen = pickHighestPriority(activeFilm, `film|${contentId}|${rida}`);
    }

    // B) Otherwise: sponsorFillPercent vs houseAds
    if (!chosen) {
      const activeSponsors = (cfg?.sponsorAds || []).filter(isActive);
      const houseAds = (cfg?.houseAds || []).filter(isActive);

      const fill = Number(defaults.sponsorFillPercent ?? 70);
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
  }

  // ✅ If sponsors are OFF (or no sponsor chosen), always serve HOUSE ads
  if (!chosen) {
    const houseAds = (cfg?.houseAds || []).filter(isActive);
    chosen = pickRotation(houseAds, `house|${contentId}|${rida}`);
  }

  // Fail-open (no ad)
  if (!chosen || !chosen.url) {
    const empty = `<?xml version="1.0" encoding="UTF-8"?><VAST version="3.0"></VAST>`;
    return new Response(empty, {
      headers: {
        "Content-Type": "application/xml; charset=UTF-8",
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        "Pragma": "no-cache"
      }
    });
  }

  const durationSeconds = Number(chosen.durationSeconds ?? durationFallback);
  const hh = String(Math.floor(durationSeconds / 3600)).padStart(2, "0");
  const mm = String(Math.floor((durationSeconds % 3600) / 60)).padStart(2, "0");
  const ss = String(durationSeconds % 60).padStart(2, "0");
  const duration = `${hh}:${mm}:${ss}`;

  const adId = escapeXml(chosen.id || "ad");
  const adTitle = escapeXml(chosen.id || "Ad");
  const mp4Url = String(chosen.url).trim();

  // ✅ MINIMAL VAST (NO tracking tags) — prevents Roku RAF crashes/skips
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<VAST version="3.0">
  <Ad id="${adId}">
    <InLine>
      <AdSystem version="1.0">FlamingElephantTV</AdSystem>
      <AdTitle>${adTitle}</AdTitle>
      <Creatives>
        <Creative sequence="1" id="${adId}">
          <Linear>
            <Duration>${duration}</Duration>
            <MediaFiles>
              <MediaFile delivery="progressive" type="video/mp4" width="1920" height="1080"><![CDATA[${mp4Url}]]></MediaFile>
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
      "Pragma": "no-cache"
    }
  });
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
