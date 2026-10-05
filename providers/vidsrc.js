const axios = require('axios');

const CINEPRO_URL = process.env.CINEPRO_URL || 'http://62.171.179.144:3000';
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://vsembed.ru/'
};

async function getVidsrcStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    console.log(`[VidSrc] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}`);

    // Method 1: Query OMSS backend
    try {
        const url = mediaType === 'tv'
            ? `${CINEPRO_URL}/v1/tv/${tmdbId}/seasons/${seasonNum || 1}/episodes/${episodeNum || 1}`
            : `${CINEPRO_URL}/v1/movies/${tmdbId}`;

        const resp = await axios.get(url, { timeout: 8000 });
        if (resp.data && Array.isArray(resp.data.sources)) {
            const vsSources = resp.data.sources.filter(s =>
                s.provider && (s.provider.id === 'vidsrc' || s.provider.name.toLowerCase().includes('vidsrc'))
            );
            if (vsSources.length > 0) {
                return vsSources.map(s => ({
                    name: 'VidSrc',
                    title: `VidSrc - ${s.quality || 'Auto'}`,
                    url: s.url,
                    quality: s.quality || 'Auto',
                    provider: 'VidSrc',
                    headers: { 'Referer': 'https://vidsrc.to/' }
                }));
            }
        }
    } catch {
        // Fallback to direct scraping
    }

    // Method 2: Direct source resolution from vsembed.ru API
    try {
        const param = mediaType === 'tv'
            ? `type=tv&id=${tmdbId}&s=${seasonNum || 1}&e=${episodeNum || 1}`
            : `type=movie&id=${tmdbId}`;

        const vsSrcResp = await axios.get(`https://vsembed.ru/vs_src.php?${param}`, {
            headers: HEADERS,
            timeout: 6000
        });

        if (vsSrcResp.data && vsSrcResp.data.src) {
            // Note: cloudorchestranova embeds are subject to Cloudflare Turnstile protection
            return [{
                name: 'VidSrc (Embed)',
                title: 'VidSrc - Embed Stream',
                url: vsSrcResp.data.src,
                quality: 'Auto',
                provider: 'VidSrc',
                headers: { 'Referer': 'https://vsembed.ru/' }
            }];
        }
    } catch (err) {
        console.warn(`[VidSrc] Scraping unavailable: ${err.message}`);
    }

    return [];
}

module.exports = { getVidsrcStreams };
