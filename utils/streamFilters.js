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

// Comprehensive patterns for non-English (dubbed / foreign audio) streams
const PURE_NON_ENGLISH_PATTERNS = [
  /\[hindi\]/i,
  /\[tamil\]/i,
  /\[telugu\]/i,
  /\[malayalam\]/i,
  /\[kannada\]/i,
  /\[bengali\]/i,
  /\[marathi\]/i,
  /\[punjabi\]/i,
  /\[urdu\]/i,
  /\[nepali\]/i,
  /\[french\]/i,
  /\[german\]/i,
  /\[spanish\]/i,
  /\[italian\]/i,
  /\[russian\]/i,
  /\b(hindi|tamil|telugu|malayalam|kannada|bengali|marathi|punjabi|urdu|nepali)\s+(dub|dubbed|org|audio)\b/i,
  /\b(telugu|hindi|tamil|malayalam|kannada)\s+org\b/i,
  /\borg\s+(nf\s+)?(hindi|tamil|telugu)\b/i,
  /\b(vff|vfq|vostfr)\b/i,
  /\b(french|german|deutsch|spanish|espanol|castellano|latino|italian|italiano|russian)\s+(dub|dubbed|audio)\b/i,
  /\b(hindi|tamil|telugu|nepali)\s+dubbed\b/i,
  /\|\s*hotstar\b/i
];

const DUAL_AUDIO_PATTERNS = [
  /\[\s*hindi[^\]]*\+[^\]]*english/i,
  /\[\s*english[^\]]*\+[^\]]*hindi/i,
  /\[\s*tamil[^\]]*\+[^\]]*english/i,
  /\[\s*telugu[^\]]*\+[^\]]*english/i,
  /\bhindi[^+\n]*\+[^+\n]*english\b/i,
  /\benglish[^+\n]*\+[^+\n]*hindi\b/i,
  /\btamil[^+\n]*\+[^+\n]*english\b/i,
  /\btelugu[^+\n]*\+[^+\n]*english\b/i,
  /\bdual[\s\-_]*audio\b/i,
  /\bmulti[\s\-_]*audio\b/i,
  /\bmulti\s+audio\b/i,
  /\|\s*multi\s*audio\s*\|/i
];

function classifyStreamLanguage(s) {
  if (!s) return 'unknown';

  if (s.isDubbed === true) {
    if (s.language && /dual|multi/i.test(s.language)) return 'dual';
    return 'non_english';
  }

  // Strip subtitle tokens to avoid false positives (e.g. "English ESubs" on Telugu audio)
  const textWithoutSubs = `${s.name || ''} ${s.title || ''} ${s.url || ''}`
    .replace(/\b(eng(?:lish)?[\s._-]*(?:esub|esubs|sub|subs|subtitle|subtitles))\b/gi, '')
    .replace(/\b(esub|esubs|multisub|nosub)\b/gi, '');

  if (PURE_NON_ENGLISH_PATTERNS.some(p => p.test(textWithoutSubs))) {
    return 'non_english';
  }

  if (DUAL_AUDIO_PATTERNS.some(p => p.test(textWithoutSubs))) {
    return 'dual';
  }

  if (s.language === 'English' && !s.isDubbed) {
    return 'english';
  }

  return 'english';
}

function filterAndSortByLanguage(streams, options = {}) {
  if (!Array.isArray(streams) || streams.length === 0) return streams;

  const preferEnglish = options.preferEnglish !== false;
  const excludeDubbed = Boolean(options.excludeDubbed);

  if (!preferEnglish && !excludeDubbed) return streams;

  const pureEnglish = [];
  const dualAudio = [];
  const nonEnglish = [];

  for (const s of streams) {
    if (!s || !s.url) continue;
    const cat = classifyStreamLanguage(s);
    if (cat === 'non_english') {
      nonEnglish.push(s);
    } else if (cat === 'dual') {
      dualAudio.push(s);
    } else {
      pureEnglish.push(s);
    }
  }

  // When excludeDubbed is requested, only return pure English sources if available
  if (excludeDubbed) {
    if (pureEnglish.length > 0) return pureEnglish;
    if (dualAudio.length > 0) return dualAudio;
    return streams;
  }

  // When pure English streams exist:
  // Drop pure non-English dubs completely.
  // Prioritize pure English first. Only append a small set of dual-audio streams at the end if English is scarce.
  if (pureEnglish.length > 0) {
    if (pureEnglish.length >= 6) {
      // Abundant pure English: cap dual audio to 2 streams at bottom
      return [...pureEnglish, ...dualAudio.slice(0, 2)];
    }
    return [...pureEnglish, ...dualAudio];
  }

  if (dualAudio.length > 0) {
    return [...dualAudio, ...nonEnglish];
  }

  return streams;
}

function applyFilters(streams, providerName, minQualitiesConfig, excludeCodecsConfig, languageOptions = {}) {
  let minQuality = null;
  if (minQualitiesConfig) {
    if (typeof minQualitiesConfig === 'string') minQuality = minQualitiesConfig;
    else if (minQualitiesConfig.default) minQuality = minQualitiesConfig.default;
  }
  let filtered = filterNonPlayableEmbeds(streams);
  filtered = filterByMinQuality(filtered, minQuality);
  filtered = filterByCodecs(filtered, excludeCodecsConfig);
  filtered = filterAndSortByLanguage(filtered, languageOptions);
  return filtered;
}
module.exports = { applyFilters };