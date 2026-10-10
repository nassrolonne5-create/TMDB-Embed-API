const axios = require('axios');

// --- VIDRIFT PROVIDER (DIRECT HLS RESOLVER) ---
// Frontend Architecture: Native HTML5 Video Player (<video> + HLS.js)
// CRITICAL: NEVER return HTML embed URLs. Return ONLY direct .m3u8 master playlists.

const CINEPRO_URL = process.env.CINEPRO_URL || 'http://62.171.179.144:3000';

async function scrapeVidrift(tmdbId, mediaType = 'movie', season = null, episode = null) {
    return getVidriftStreams(tmdbId, mediaType, season, episode);
}

async function getVidriftStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    console.log(`[VidRift] Fetching direct HLS streams for TMDB ID: ${tmdbId}, Type: ${mediaType}`);

    try {
        const url = mediaType === 'tv'
            ? `${CINEPRO_URL}/v1/tv/${tmdbId}/seasons/${seasonNum || 1}/episodes/${episodeNum || 1}`
            : `${CINEPRO_URL}/v1/movies/${tmdbId}`;

        const resp = await axios.get(url, { timeout: 8000 });
        if (!resp.data || !Array.isArray(resp.data.sources)) {
            return [];
        }

        const vrSources = resp.data.sources.filter(s =>
            s.provider && (s.provider.id === 'vidrift' || s.provider.name.toLowerCase().includes('vidrift'))
        );

        const streams = [];
        for (const s of vrSources) {
            if (!s.url || !s.url.includes('.m3u8')) continue;

            // Probe stream to ensure it is alive and returns valid m3u8 playlist
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
                headers: {
                    'Referer': 'https://vidrift.in/',
                    'Origin': 'https://vidrift.in',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0'
                }
            });
        }

        console.log(`[VidRift] Successfully extracted ${streams.length} direct HLS stream(s).`);
        return streams;
    } catch (err) {
        console.warn(`[VidRift] Direct fetch unavailable: ${err.message}`);
        return [];
    }
}

module.exports = {
    extractVidRift: scrapeVidrift,
    scrapeVidrift,
    getVidriftStreams
};
