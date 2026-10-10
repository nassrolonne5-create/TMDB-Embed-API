/**
 * DIRECT HLS SCRAPER MODULE FOR TMDB EMBED BACKEND
 * Providers: Vidrock (Boomchick/Nova/Atlas), VidSrc (Primary/RCP), VidRift
 */

const axios = require('axios');
const cheerio = require('cheerio');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// -------------------------------------------------------------
// 1. VIDROCK EXTRACTOR (Nova / Atlas / Boomchick)
// -------------------------------------------------------------
/**
 * Resolves Vidrock embed page to direct Boomchick HLS playlist
 * @param {string} tmdbId TMDB Movie or Series ID
 * @param {number|null} season Season number (or null for movie)
 * @param {number|null} episode Episode number (or null for movie)
 */
async function extractVidrock(tmdbId, season = null, episode = null) {
  const streams = [];
  try {
    const isTV = Boolean(season && episode);
    const embedUrl = isTV
      ? `https://vidrock.to/embed/tv/${tmdbId}/${season}/${episode}`
      : `https://vidrock.to/embed/movie/${tmdbId}`;

    const { data: html } = await axios.get(embedUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        Referer: 'https://vidrock.to/',
      },
      timeout: 8000,
    });

    // 1. Look for inline script containing playlist or master URL
    const m3u8Matches = html.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/g) || [];
    const boomchickMatches = html.match(/https?:\/\/[^"'\s]*boomchick[^"'\s]*/g) || [];

    const allMatches = Array.from(new Set([...m3u8Matches, ...boomchickMatches]));

    for (const url of allMatches) {
      const cleanUrl = url.replace(/\\/g, '');
      const isAtlas = cleanUrl.includes('cdn2.boomchick.org');
      const serverVariant = isAtlas ? 'Vidrock (Atlas)' : 'Vidrock (Nova)';

      streams.push({
        provider: 'Vidrock',
        name: serverVariant,
        title: `${serverVariant} 1080p`,
        url: cleanUrl,
        quality: '1080P',
        type: 'hls',
        isM3U8: true,
        headers: {
          Referer: 'https://vidrock.to/',
          'User-Agent': USER_AGENT,
        },
      });
    }

    // 2. Fallback: Parse sources array inside window.playerConfig / setup
    const configMatch = html.match(/sources\s*:\s*(\[[^\]]+\])/);
    if (configMatch && configMatch[1]) {
      try {
        const sources = JSON.parse(configMatch[1].replace(/'/g, '"'));
        for (const s of sources) {
          if (s.file && !streams.some((existing) => existing.url === s.file)) {
            streams.push({
              provider: 'Vidrock',
              name: `Vidrock (${s.label || 'Stream'})`,
              title: `Vidrock ${s.label || '1080p'}`,
              url: s.file,
              quality: s.label || '1080P',
              type: 'hls',
              isM3U8: true,
              headers: {
                Referer: 'https://vidrock.to/',
                'User-Agent': USER_AGENT,
              },
            });
          }
        }
      } catch (_) {
        /* ignore json parse error */
      }
    }
  } catch (err) {
    console.warn('[Scraper] Vidrock embed scraping notice:', err.message);
  }

  // Robust fallback: if embed HTML scraping returned 0 streams, resolve via direct AES API
  if (streams.length === 0) {
    try {
      const { getVidrockStreams } = require('../providers/vidrock');
      const fallbackStreams = await getVidrockStreams(tmdbId, season && episode ? 'tv' : 'movie', season, episode);
      for (const s of fallbackStreams) {
        if (s && s.url && s.url.includes('.m3u8')) {
          streams.push({
            ...s,
            quality: s.quality || '1080P',
            type: 'hls',
            isM3U8: true,
          });
        }
      }
    } catch (_) {
      /* ignore fallback error */
    }
  }

  return streams;
}

// -------------------------------------------------------------
// 2. VIDSRC EXTRACTOR (vidsrc.to / vidsrc.pm / rcp cipher)
// -------------------------------------------------------------
/**
 * Decodes VidSrc obfuscated hash cipher into direct master.m3u8 stream
 * @param {string} tmdbId TMDB ID
 * @param {number|null} season Season number (or null for movie)
 * @param {number|null} episode Episode number (or null for movie)
 */
async function extractVidSrc(tmdbId, season = null, episode = null) {
  const streams = [];
  try {
    const isTV = Boolean(season && episode);
    const embedUrl = isTV
      ? `https://vidsrc.to/embed/tv/${tmdbId}/${season}/${episode}`
      : `https://vidsrc.to/embed/movie/${tmdbId}`;

    // Step 1: Fetch embed HTML
    const embedRes = await axios.get(embedUrl, {
      headers: { 'User-Agent': USER_AGENT },
      timeout: 8000,
    });
    const $ = cheerio.load(embedRes.data);

    // Step 2: Extract rcp/prorcp iframe or data-id hash
    const iframeSrc = $('iframe#player_iframe').attr('src') || $('iframe').attr('src');
    if (iframeSrc) {
      const rcpUrl = iframeSrc.startsWith('//')
        ? `https:${iframeSrc}`
        : iframeSrc.startsWith('http')
        ? iframeSrc
        : `https://vidsrc.to${iframeSrc}`;

      // Step 3: Fetch RCP player page
      const rcpRes = await axios.get(rcpUrl, {
        headers: {
          'User-Agent': USER_AGENT,
          Referer: embedUrl,
        },
        timeout: 8000,
      });

      // Step 4: Extract encrypted source or direct token stream
      const rawRcpHtml = rcpRes.data;

      // Pattern A: Direct stream URL in JS (e.g. liminallabyrinth.space or cdn master.m3u8)
      const directM3u8Match = rawRcpHtml.match(/https?:\/\/[^"'\s]+\/pl\/[^"'\s]+\/master\.m3u8[^"'\s]*/);
      if (directM3u8Match) {
        streams.push({
          provider: 'VidSrc',
          name: 'VidSrc (Primary)',
          title: 'VidSrc 1080p',
          url: directM3u8Match[0],
          quality: '1080P',
          type: 'hls',
          isM3U8: true,
          headers: {
            Referer: rcpUrl,
            'User-Agent': USER_AGENT,
          },
        });
        return streams;
      }

      // Pattern B: Obfuscated source parameter passed to player wrapper
      const fileMatch = rawRcpHtml.match(/file\s*:\s*["']([^"']+)["']/);
      if (fileMatch && fileMatch[1]) {
        let resolvedFile = fileMatch[1];
        // Reverse custom alphabet cipher if encoded
        if (!resolvedFile.startsWith('http')) {
          resolvedFile = decodeVidSrcCipher(resolvedFile);
        }
        if (resolvedFile && resolvedFile.startsWith('http') && resolvedFile.includes('.m3u8')) {
          streams.push({
            provider: 'VidSrc',
            name: 'VidSrc (Primary)',
            title: 'VidSrc 1080p',
            url: resolvedFile,
            quality: '1080P',
            type: 'hls',
            isM3U8: true,
            headers: {
              Referer: rcpUrl,
              'User-Agent': USER_AGENT,
            },
          });
          return streams;
        }
      }
    }
  } catch (err) {
    console.warn('[Scraper] VidSrc RCP extraction notice:', err.message);
  }

  // Robust fallback: if RCP regex returned 0 streams, resolve via direct tokenized gateway
  if (streams.length === 0) {
    try {
      const { getVidsrcStreams } = require('../providers/vidsrc');
      const fallbackStreams = await getVidsrcStreams(tmdbId, season && episode ? 'tv' : 'movie', season, episode);
      for (const s of fallbackStreams) {
        if (s && s.url && s.url.includes('.m3u8')) {
          streams.push({
            ...s,
            quality: s.quality || '1080P',
            type: 'hls',
            isM3U8: true,
          });
        }
      }
    } catch (_) {
      /* ignore fallback error */
    }
  }

  return streams;
}

/**
 * Standard VidSrc cipher reversal
 */
function decodeVidSrcCipher(encoded) {
  try {
    // Reverse base64 / rot13 permutation
    const binary = Buffer.from(encoded, 'base64').toString('binary');
    let decoded = '';
    for (let i = 0; i < binary.length; i++) {
      decoded += String.fromCharCode(binary.charCodeAt(i) ^ 0x3b);
    }
    return decoded;
  } catch (_) {
    return null;
  }
}

// -------------------------------------------------------------
// 3. VIDRIFT EXTRACTOR (vidrift.net / embed.vidrift.in)
// -------------------------------------------------------------
/**
 * Resolves VidRift player payload to direct HLS source
 * @param {string} tmdbId TMDB ID
 * @param {number|null} season Season number (or null for movie)
 * @param {number|null} episode Episode number (or null for movie)
 */
async function extractVidRift(tmdbId, season = null, episode = null) {
  const streams = [];
  try {
    const isTV = Boolean(season && episode);
    const embedUrl = isTV
      ? `https://vidrift.net/embed/tv/${tmdbId}/${season}/${episode}`
      : `https://vidrift.net/embed/movie/${tmdbId}`;

    const { data: html } = await axios.get(embedUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        Referer: 'https://vidrift.net/',
      },
      timeout: 6000,
    });

    // 1. Direct regex match on master.m3u8 or HLS source
    const m3u8Match = html.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/);
    if (m3u8Match) {
      streams.push({
        provider: 'VidRift',
        name: 'VidRift',
        title: 'VidRift 1080p',
        url: m3u8Match[0].replace(/\\/g, ''),
        quality: '1080P',
        type: 'hls',
        isM3U8: true,
        headers: {
          Referer: 'https://vidrift.net/',
          'User-Agent': USER_AGENT,
        },
      });
      return streams;
    }

    // 2. VidRift API Endpoint resolution (e.g. /api/source/{token})
    const apiTokenMatch = html.match(/\/api\/source\/([a-zA-Z0-9_-]+)/);
    if (apiTokenMatch && apiTokenMatch[1]) {
      const apiUrl = `https://vidrift.net/api/source/${apiTokenMatch[1]}`;
      const apiRes = await axios.post(
        apiUrl,
        {},
        {
          headers: {
            'User-Agent': USER_AGENT,
            Referer: embedUrl,
            'X-Requested-With': 'XMLHttpRequest',
          },
          timeout: 6000,
        }
      );

      if (apiRes.data && Array.isArray(apiRes.data.data)) {
        for (const item of apiRes.data.data) {
          if (item.file && item.file.includes('.m3u8')) {
            streams.push({
              provider: 'VidRift',
              name: 'VidRift',
              title: `VidRift ${item.label || '1080p'}`,
              url: item.file,
              quality: item.label || '1080P',
              type: 'hls',
              isM3U8: true,
              headers: {
                Referer: 'https://vidrift.net/',
                'User-Agent': USER_AGENT,
              },
            });
          }
        }
      }
    }
  } catch (err) {
    console.warn('[Scraper] VidRift embed extraction notice:', err.message);
  }

  // Robust fallback: if vidrift.net is down/404, resolve via direct OMSS / CinePro master HLS
  if (streams.length === 0) {
    try {
      const { getVidriftStreams } = require('../providers/vidrift');
      const fallbackStreams = await getVidriftStreams(tmdbId, season && episode ? 'tv' : 'movie', season, episode);
      for (const s of fallbackStreams) {
        if (s && s.url && s.url.includes('.m3u8')) {
          streams.push({
            ...s,
            quality: s.quality || '1080P',
            type: 'hls',
            isM3U8: true,
          });
        }
      }
    } catch (_) {
      /* ignore fallback error */
    }
  }

  return streams;
}

// -------------------------------------------------------------
// 4. COMBINED ROUTE INTEGRATION FOR YOUR EXPRESS SCRAPER
// -------------------------------------------------------------
/**
 * Call this in your scraper router (e.g., /api/streams/movie/:id or /series/:id)
 */
async function getDirectStreams(tmdbId, season = null, episode = null) {
  const [vidrockResults, vidSrcResults, vidRiftResults] = await Promise.allSettled([
    extractVidrock(tmdbId, season, episode),
    extractVidSrc(tmdbId, season, episode),
    extractVidRift(tmdbId, season, episode),
  ]);

  const allStreams = [];
  if (vidrockResults.status === 'fulfilled') allStreams.push(...vidrockResults.value);
  if (vidSrcResults.status === 'fulfilled') allStreams.push(...vidSrcResults.value);
  if (vidRiftResults.status === 'fulfilled') allStreams.push(...vidRiftResults.value);

  return allStreams;
}

module.exports = {
  extractVidrock,
  extractVidSrc,
  extractVidRift,
  decodeVidSrcCipher,
  getDirectStreams,
};
