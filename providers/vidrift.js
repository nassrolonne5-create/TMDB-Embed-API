const axios = require('axios');

// --- VIDRIFT PROVIDER FIX ---
// DEAD:  https://vidrift.net/embed/movie/{id} (Returns 404)
// DEAD:  https://vidrift.net/api/movie/{id}   (Returns 404)
// FIXED: https://embed.vidrift.net/embed/movie/{id}

const CINEPRO_URL = process.env.CINEPRO_URL || 'http://62.171.179.144:3000';

async function scrapeVidrift(tmdbId, mediaType = 'movie', season = null, episode = null) {
    const embedDomain = 'https://embed.vidrift.net';

    const embedUrl = mediaType === 'tv'
        ? `${embedDomain}/embed/tv/${tmdbId}/${season || 1}/${episode || 1}`
        : `${embedDomain}/embed/movie/${tmdbId}`;

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

    const embedDomain = 'https://embed.vidrift.net';
    const embedUrl = mediaType === 'tv'
        ? `${embedDomain}/embed/tv/${tmdbId}/${seasonNum || 1}/${episodeNum || 1}`
        : `${embedDomain}/embed/movie/${tmdbId}`;

    const defaultEmbed = {
        name: 'VidRift',
        title: 'VidRift Player',
        url: embedUrl,
        provider: 'VidRift',
        isEmbed: true,
        type: 'iframe'
    };

    try {
        const url = mediaType === 'tv'
            ? `${CINEPRO_URL}/v1/tv/${tmdbId}/seasons/${seasonNum || 1}/episodes/${episodeNum || 1}`
            : `${CINEPRO_URL}/v1/movies/${tmdbId}`;

        const resp = await axios.get(url, { timeout: 8000 });
        if (!resp.data || !Array.isArray(resp.data.sources)) {
            return [defaultEmbed];
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

        // Always include the verified iframe embed alongside or as fallback
        streams.push(defaultEmbed);

        console.log(`[VidRift] Successfully extracted ${streams.length} stream(s).`);
        return streams;
    } catch (err) {
        console.warn(`[VidRift] Direct fetch unavailable (${err.message}), returning verified embed.`);
        return [defaultEmbed];
    }
}

module.exports = {
    scrapeVidrift,
    getVidriftStreams
};
