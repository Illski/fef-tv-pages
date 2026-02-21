export async function onRequest(context) {
  const reqUrl = new URL(context.request.url);

  const contentId = reqUrl.searchParams.get("contentId") || "default";
  const rida = reqUrl.searchParams.get("rida") || "anon";

  // Load config.json from the same Pages origin (your deployed site)
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

  // 1-minute bucket for testing rotation
  const bucket = Math.floor(Date.now() / (1 * 60 * 1000));

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
  if (!chosen) {
    return vastEmpty();
  }

  // ---- MEDIA SELECTION ----
  // Support BOTH legacy configs and fixed configs:
  // Legacy: chosen.url might be mp4 OR might be m3u8 (if user duplicated keys)
  // New: chosen.mp4 / chosen.hls fields.
  const rawUrl = (chosen.url || "").toString().trim();
  const mp4 = (chosen.mp4 || "").toString().trim();
  const hls = (chosen.hls || "").toString().trim();

  // Decide mediaUrl + mime
  let mediaUrl = "";
  let mimeType = "";
  let delivery = "";

  // Prefer explicit mp4/hls fields if present
  if (mp4) {
    mediaUrl = mp4;
    mimeType = "video/mp4";
    delivery = "progressive";
  } else if (hls) {
    mediaUrl = hls;
    mimeType = "application/x-mpegURL";
    delivery = "streaming";
  } else if (rawUrl.endsWith(".mp4")) {
    mediaUrl = rawUrl;
    mimeType = "video/mp4";
    delivery = "progressive";
  } else if (rawUrl.endsWith(".m3u8")) {
    mediaUrl = rawUrl;
    mimeType = "application/x-mpegURL";
    delivery = "streaming";
  } else {
    // If it’s neither, fail-open
    return vastEmpty();
  }

  const durationFallback = cfg?.defaults?.durationSeconds || 15;
  const durationSeconds = Number(chosen.durationSeconds ?? chosen.durationSeconds ?? durationFallback);
  const hh = String(Math.floor(durationSeconds / 3600)).padStart(2, "0");
  const mm = String(Math.floor((durationSeconds % 3600) / 60)).padStart(2, "0");
  const ss = String(durationSeconds % 60).padStart(2, "0");
  const duration = `${hh}:${mm}:${ss}`;

  const adId = escapeXml(chosen.id || "ad");
  const adTitle = escapeXml(chosen.id || "Ad");

  // Minimal VAST (no tracking) to keep RAF stable
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
              <MediaFile delivery="${delivery}" type="${mimeType}" width="1920" height="1080"><![CDATA[${mediaUrl}]]></MediaFile>
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

function vastEmpty() {
  const empty = `<?xml version="1.0" encoding="UTF-8"?><VAST version="3.0"></VAST>`;
  return new Response(empty, {
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
