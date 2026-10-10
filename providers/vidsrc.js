const axios = require('axios');

// --- VIDSRC DOMAIN UPDATE ---
// BLOCKED: https://vixsrc.to (Cloudflare 403)
// DEAD:    https://vidsrc.net, https://vidsrc.xyz
// ACTIVE:  https://vidsrc.to, https://vidsrc.me, https://vidsrc.pm

const VIDSRC_DOMAINS = [
    'https://vidsrc.to',
    'https://vidsrc.me',
    'https://vidsrc.pm'
];

function getVidSrcEmbedUrl(tmdbId, mediaType = 'movie', season = null, episode = null, baseDomain = 'https://vidsrc.to') {
    if (baseDomain.includes('vidsrc.me')) {
        return mediaType === 'tv'
            ? `${baseDomain}/embed/tv?tmdb=${tmdbId}&season=${season || 1}&episode=${episode || 1}`
            : `${baseDomain}/embed/movie?tmdb=${tmdbId}`;
    }
    if (mediaType === 'tv') {
        return `${baseDomain}/embed/tv/${tmdbId}/${season || 1}/${episode || 1}`;
    }
    return `${baseDomain}/embed/movie/${tmdbId}`;
}

const CINEPRO_URL = process.env.CINEPRO_URL || 'http://62.171.179.144:3000';
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://vsembed.ru/'
};

async function getVidsrcStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    console.log(`[VidSrc] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}`);

    const streams = [];

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
            for (const s of vsSources) {
                streams.push({
                    name: 'VidSrc',
                    title: `VidSrc - ${s.quality || 'Auto'}`,
                    url: s.url,
                    quality: s.quality || 'Auto',
                    provider: 'VidSrc',
                    headers: { 'Referer': 'https://vidsrc.to/' }
                });
            }
        }
    } catch {
        // Fallback to direct resolution
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
            streams.push({
                name: 'VidSrc (Embed)',
                title: 'VidSrc - Direct Stream',
                url: vsSrcResp.data.src,
                quality: 'Auto',
                provider: 'VidSrc',
                headers: { 'Referer': 'https://vsembed.ru/' }
            });
        }
    } catch (err) {
        console.warn(`[VidSrc] Scraping unavailable: ${err.message}`);
    }

    // Method 3: Active mirrors (vidsrc.to, vidsrc.me, vidsrc.pm) as embed players
    const activeMirrors = [
        { name: 'VidSrc (to)', url: getVidSrcEmbedUrl(tmdbId, mediaType, seasonNum, episodeNum, 'https://vidsrc.to') },
        { name: 'VidSrc (me)', url: getVidSrcEmbedUrl(tmdbId, mediaType, seasonNum, episodeNum, 'https://vidsrc.me') },
        { name: 'VidSrc (pm)', url: getVidSrcEmbedUrl(tmdbId, mediaType, seasonNum, episodeNum, 'https://vidsrc.pm') }
    ];

    for (const mirror of activeMirrors) {
        streams.push({
            name: mirror.name,
            title: `${mirror.name} Player`,
            url: mirror.url,
            quality: '1080p',
            provider: 'VidSrc',
            isEmbed: true,
            type: 'iframe'
        });
    }

    return streams;
}

module.exports = {
    VIDSRC_DOMAINS,
    getVidSrcEmbedUrl,
    getVidsrcStreams
};
