function parseQuality(qualityString) {
  if (!qualityString || typeof qualityString !== 'string') return 0;
  const q = qualityString.toLowerCase();
  if (q.includes('auto')) return 1080;
  if (q.includes('4k') || q.includes('2160')) return 2160;
  if (q.includes('1440')) return 1440;
  if (q.includes('1080')) return 1080;
  if (q.includes('720')) return 720;
  if (q.includes('576')) return 576;
  if (q.includes('480')) return 480;
  if (q.includes('360')) return 360;
  if (q.includes('240')) return 240;
  const kbps = q.match(/(\d+)k/); if (kbps) return parseInt(kbps[1],10)/1000;
  if (q.includes('hd')) return 720;
  if (q.includes('sd')) return 480;
  if (q.includes('cam')) return 100;
  if (q.includes('ts')) return 200;
  if (q.includes('scr')) return 300;
  if (q.includes('dvdscr')) return 350;
  if (q.includes('r5') || q.includes('r6')) return 400;
  if (q.includes('org')) return 4320;
  return 0;
}
function filterByMinQuality(streams, minQualitySetting) {
  if (!minQualitySetting || minQualitySetting.toLowerCase() === 'all') return streams;
  const minNumeric = parseQuality(minQualitySetting);
  if (minNumeric === 0 && minQualitySetting.toLowerCase() !== 'all') return streams;
  return streams.filter(s => parseQuality(s.quality) >= minNumeric);
}
function filterByCodecs(streams, exclude) {
  if (!exclude || (!exclude.excludeDV && !exclude.excludeHDR)) return streams;
  return streams.filter(s => {
    if (!Array.isArray(s.codecs)) return true;
    if (exclude.excludeDV && s.codecs.includes('DV')) return false;
    if (exclude.excludeHDR && s.codecs.some(c => ['HDR','HDR10','HDR10+'].includes(c))) return false;
    return true;
  });
}
function filterNonPlayableEmbeds(streams) {
  if (!Array.isArray(streams)) return [];
  const playable = streams.filter(s => {
    if (!s || typeof s !== 'object' || !s.url) return false;
    if (s.isEmbed || s.type === 'iframe') return false;
    // Reject HTML embed URLs that cannot be played in native video tag / HLS.js
    if (/\/embed(\/|\?|$)/i.test(s.url) || /\/e\/[a-zA-Z0-9]/i.test(s.url)) return false;
    return true;
  });

  // If direct playable HLS/MP4 streams exist, return them.
  // Otherwise, allow fallback embed players so the API never returns empty.
  if (playable.length > 0) return playable;
  return streams.filter(s => s && typeof s === 'object' && s.url);
}

// Filter out non-English streams and prioritize original English sources
const PURE_NON_ENGLISH_PATTERNS = [
  /\[hindi\]/i,
  /\[tamil\]/i,
  /\[telugu\]/i,
  /\[malayalam\]/i,
  /\[kannada\]/i,
  /\[bengali\]/i,
  /\bhindi\s+dubbed\b/i,
  /\btamil\s+dubbed\b/i,
  /\btelugu\s+dubbed\b/i
];

const DUAL_AUDIO_PATTERNS = [
  /\[hindi[^\]]*\+[^\]]*english/i,
  /\[english[^\]]*\+[^\]]*hindi/i,
  /dual[\s\-_]*audio/i,
  /multi[\s\-_]*audio/i
];

function filterAndSortByLanguage(streams) {
  if (!Array.isArray(streams) || streams.length === 0) return streams;

  const pureEnglish = [];
  const dualAudio = [];
  const nonEnglish = [];

  for (const s of streams) {
    if (!s || !s.url) continue;
    const text = `${s.name || ''} ${s.title || ''} ${s.url || ''}`;

    if (PURE_NON_ENGLISH_PATTERNS.some(p => p.test(text))) {
      nonEnglish.push(s);
    } else if (DUAL_AUDIO_PATTERNS.some(p => p.test(text))) {
      dualAudio.push(s);
    } else {
      pureEnglish.push(s);
    }
  }

  // If pure English streams exist, drop non-English dubs and put English first
  if (pureEnglish.length > 0 || dualAudio.length > 0) {
    return [...pureEnglish, ...dualAudio];
  }

  return streams;
}

function applyFilters(streams, providerName, minQualitiesConfig, excludeCodecsConfig) {
  let minQuality = null;
  if (minQualitiesConfig) {
    if (typeof minQualitiesConfig === 'string') minQuality = minQualitiesConfig;
    else if (minQualitiesConfig.default) minQuality = minQualitiesConfig.default;
  }
  let filtered = filterNonPlayableEmbeds(streams);
  filtered = filterByMinQuality(filtered, minQuality);
  filtered = filterByCodecs(filtered, excludeCodecsConfig);
  filtered = filterAndSortByLanguage(filtered);
  return filtered;
}
module.exports = { applyFilters };