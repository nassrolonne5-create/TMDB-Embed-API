const axios = require('axios');

const CINEPRO_URL = process.env.CINEPRO_URL || 'http://62.171.179.144:3000';

async function getVidfastStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    console.log(`[VidFast] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}`);

    try {
        const url = mediaType === 'tv'
            ? `${CINEPRO_URL}/v1/tv/${tmdbId}/seasons/${seasonNum || 1}/episodes/${episodeNum || 1}`
            : `${CINEPRO_URL}/v1/movies/${tmdbId}`;

        const resp = await axios.get(url, { timeout: 8000 });
        if (!resp.data || !Array.isArray(resp.data.sources)) {
            return [];
        }

        const vfSources = resp.data.sources.filter(s =>
            s.provider && (s.provider.id === 'vidfast' || s.provider.name.toLowerCase().includes('vidfast'))
        );

        const streams = [];
        for (const s of vfSources) {
            if (!s.url) continue;

            // Probe stream to ensure it is alive
            try {
                const probe = await axios.get(s.url, {
                    headers: { 'Referer': 'https://vidfast.pro/' },
                    timeout: 3000,
                    validateStatus: (status) => status === 200 || status === 206
                });
                if (probe.status !== 200 && probe.status !== 206) continue;
            } catch {
                continue;
            }

            streams.push({
                name: 'VidFast',
                title: `VidFast - ${s.quality || 'Auto'}`,
                url: s.url,
                quality: s.quality || 'Auto',
                provider: 'VidFast',
                headers: {
                    'Referer': 'https://vidfast.pro/',
                    'Origin': 'https://vidfast.pro'
                }
            });
        }

        console.log(`[VidFast] Extracted ${streams.length} stream(s).`);
        return streams;
    } catch (err) {
        console.warn(`[VidFast] Fetch unavailable: ${err.message}`);
        return [];
    }
}

module.exports = { getVidfastStreams };
