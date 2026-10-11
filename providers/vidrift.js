const axios = require('axios');

// --- VIDRIFT PROVIDER FIX ---
// DEAD:  https://vidrift.net/embed/movie/{id} (Returns 404)
// DEAD:  https://vidrift.net/api/movie/{id}   (Returns 404)
// FIXED: https://embed.vidrift.net/embed/movie/{id}

const VIDRIFT_EMBED_DOMAIN = 'https://embed.vidrift.net';
const CINEPRO_URL = process.env.CINEPRO_URL || 'http://62.171.179.144:3005';

function getVidriftEmbedUrl(tmdbId, mediaType = 'movie', season = null, episode = null) {
    const isTv = mediaType === 'tv' || mediaType === 'series';
    return isTv
        ? `${VIDRIFT_EMBED_DOMAIN}/embed/tv/${tmdbId}/${season || 1}/${episode || 1}`
        : `${VIDRIFT_EMBED_DOMAIN}/embed/movie/${tmdbId}`;
}

async function scrapeVidrift(tmdbId, mediaType = 'movie', season = null, episode = null) {
    const embedDomain = 'https://embed.vidrift.net';

    const embedUrl = (mediaType === 'tv' || mediaType === 'series')
        ? `${embedDomain}/embed/tv/${tmdbId}/${season || 1}/${episode || 1}`
        : `${embedDomain}/embed/movie/${tmdbId}`;

    // First attempt to resolve direct HLS stream if backend is available
    try {
        const directStreams = await getVidriftStreams(tmdbId, mediaType, season, episode);
        if (directStreams && directStreams.length > 0) {
            return directStreams;
        }
    } catch {
        // Fall back to iframe embed
    }

    return [{
        name: 'VidRift',
        title: 'VidRift Player',
        url: embedUrl,
        provider: 'VidRift',
        isEmbed: true,
        type: 'iframe'
    }];
}

async function getVidriftStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    console.log(`[VidRift] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}`);

    try {
        const url = (mediaType === 'tv' || mediaType === 'series')
            ? `${CINEPRO_URL}/v1/tv/${tmdbId}/seasons/${seasonNum || 1}/episodes/${episodeNum || 1}`
            : `${CINEPRO_URL}/v1/movies/${tmdbId}`;

        const resp = await axios.get(url, { timeout: 4000 });
        if (resp.data && Array.isArray(resp.data.sources)) {
            const vrSources = resp.data.sources.filter(s =>
                s.provider && (s.provider.id === 'vidrift' || s.provider.name.toLowerCase().includes('vidrift'))
            );

            const streams = [];
            for (const s of vrSources) {
                if (!s.url || !s.url.includes('.m3u8')) continue;

                // Probe stream
                try {
                    const probe = await axios.get(s.url, {
                        headers: {
                            'Referer': 'https://vidrift.in/',
                            'Origin': 'https://vidrift.in',
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0'
                        },
                        timeout: 3000,
                        validateStatus: (status) => status === 200 || status === 206
                    });
                    if (probe.status !== 200 && probe.status !== 206) continue;
                } catch {
                    continue;
                }

                streams.push({
                    provider: 'VidRift',
                    name: 'VidRift (Master)',
                    title: 'VidRift 1080p',
                    url: s.url,
                    quality: '1080p',
                    type: 'hls',
                    isM3U8: true,
                    headers: {
                        'Referer': 'https://vidrift.in/',
                        'Origin': 'https://vidrift.in',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0'
                    }
                });
            }

            if (streams.length > 0) {
                console.log(`[VidRift] Successfully extracted ${streams.length} direct HLS stream(s).`);
                return streams;
            }
        }
    } catch (err) {
        console.warn(`[VidRift] Direct fetch notice: ${err.message}`);
    }

    // Embed fallback if no direct HLS stream returned
    const embedUrl = getVidriftEmbedUrl(tmdbId, mediaType, seasonNum, episodeNum);
    return [{
        name: 'VidRift',
        title: 'VidRift Player',
        url: embedUrl,
        provider: 'VidRift',
        isEmbed: true,
        type: 'iframe'
    }];
}

module.exports = {
    VIDRIFT_EMBED_DOMAIN,
    getVidriftEmbedUrl,
    extractVidRift: scrapeVidrift,
    scrapeVidrift,
    getVidriftStreams
};
