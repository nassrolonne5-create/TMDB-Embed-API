const axios = require('axios');

const CINEPRO_URL = process.env.CINEPRO_URL || 'http://62.171.179.144:3000';

async function getVidriftStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    console.log(`[VidRift] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}`);

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
            if (!s.url) continue;

            // Probe stream to ensure it is alive and returns valid m3u8
            try {
                const probe = await axios.get(s.url, {
                    headers: { 'Referer': 'https://vidrift.in/' },
                    timeout: 3000,
                    validateStatus: (status) => status === 200 || status === 206
                });
                if (probe.status !== 200 && probe.status !== 206) continue;
            } catch {
                continue;
            }

            streams.push({
                name: 'VidRift',
                title: `VidRift - ${s.quality || 'Auto'}`,
                url: s.url,
                quality: s.quality || 'Auto',
                provider: 'VidRift',
                headers: {
                    'Referer': 'https://vidrift.in/',
                    'Origin': 'https://vidrift.in'
                }
            });
        }

        console.log(`[VidRift] Successfully extracted ${streams.length} stream(s).`);
        return streams;
    } catch (err) {
        console.warn(`[VidRift] Fetch unavailable: ${err.message}`);
        return [];
    }
}

module.exports = { getVidriftStreams };
