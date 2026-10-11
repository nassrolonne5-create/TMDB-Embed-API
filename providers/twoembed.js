// --- 2EMBED PROVIDER ---
// High-uptime multi-server English streaming provider for movies and TV series

const BASE_URL_CC = 'https://www.2embed.cc';
const BASE_URL_SKIN = 'https://www.2embed.skin';

async function getTwoembedStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    console.log(`[2Embed] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}`);

    const isTv = mediaType === 'tv' || mediaType === 'series';
    const s = seasonNum || 1;
    const ep = episodeNum || 1;

    const urlCC = isTv
        ? `${BASE_URL_CC}/embedtv/${tmdbId}&s=${s}&e=${ep}`
        : `${BASE_URL_CC}/embed/${tmdbId}`;

    const urlSkin = isTv
        ? `${BASE_URL_SKIN}/embedtv/${tmdbId}&s=${s}&e=${ep}`
        : `${BASE_URL_SKIN}/embed/${tmdbId}`;

    return [
        {
            provider: '2Embed',
            name: '2Embed (Primary)',
            title: '2Embed Multi-Server 1080p',
            url: urlCC,
            quality: '1080p',
            type: 'iframe',
            isEmbed: true,
            headers: {
                'Referer': `${BASE_URL_CC}/`
            }
        },
        {
            provider: '2Embed',
            name: '2Embed (Mirror)',
            title: '2Embed Player 1080p',
            url: urlSkin,
            quality: '1080p',
            type: 'iframe',
            isEmbed: true,
            headers: {
                'Referer': `${BASE_URL_SKIN}/`
            }
        }
    ];
}

module.exports = {
    getTwoembedStreams
};
