// --- SMASHYSTREAM PROVIDER ---
// Universal, easy-to-embed English streaming provider for movies and TV series

const BASE_URL = 'https://embed.smashystream.com/playere.php';

async function getSmashystreamStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    console.log(`[SmashyStream] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}`);

    const isTv = mediaType === 'tv' || mediaType === 'series';
    const s = seasonNum || 1;
    const ep = episodeNum || 1;

    const embedUrl = isTv
        ? `${BASE_URL}?tmdb=${tmdbId}&season=${s}&episode=${ep}`
        : `${BASE_URL}?tmdb=${tmdbId}`;

    return [
        {
            provider: 'SmashyStream',
            name: 'SmashyStream (Server 1)',
            title: 'SmashyStream Player 1080p',
            url: embedUrl,
            quality: '1080p',
            type: 'iframe',
            isEmbed: true,
            headers: {
                'Referer': 'https://embed.smashystream.com/'
            }
        }
    ];
}

module.exports = {
    getSmashystreamStreams
};
