const axios = require('axios');

const VIDROCK_BASE = 'https://vidrock.ru';
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': `${VIDROCK_BASE}/`
};

async function getVidrockStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    console.log(`[Vidrock] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}`);

    try {
        // 1. Build the embed URL based on the documentation
        let embedUrl = `${VIDROCK_BASE}/movie/${tmdbId}`;
        if (mediaType === 'tv') {
            if (!seasonNum || !episodeNum) return [];
            embedUrl = `${VIDROCK_BASE}/tv/${tmdbId}/${seasonNum}/${episodeNum}`;
        }

        console.log(`[Vidrock] Fetching embed page: ${embedUrl}`);
        
        // 2. Fetch the iframe HTML
        const response = await axios.get(embedUrl, { 
            headers: HEADERS, 
            timeout: 12000 
        });
        
        const html = response.data;
        if (!html) {
            console.log('[Vidrock] No HTML returned from embed page.');
            return [];
        }

        // 3. Extract the .m3u8 playlist URL from the HTML
        // Most embed players initialize video.js, JWPlayer, or plyr with a source string
        const m3u8Match = html.match(/(https?:\/\/[^"']+\.m3u8[^"']*)/i);
        
        if (!m3u8Match || !m3u8Match[1]) {
            console.log('[Vidrock] Could not find an .m3u8 stream in the embed HTML. The payload might be obfuscated.');
            return [];
        }

        const streamUrl = m3u8Match[1];
        
        // 4. Return in the unified TMDB-Embed-API format
        const streams = [{
            name: 'Vidrock',
            title: `Vidrock - Auto`,
            url: streamUrl,
            quality: 'Auto', // Let the API's proxy/filters handle quality resolution if needed
            provider: 'Vidrock',
            headers: {
                'Referer': `${VIDROCK_BASE}/`,
                'User-Agent': HEADERS['User-Agent']
            }
        }];

        console.log(`[Vidrock] Successfully extracted stream: ${streamUrl}`);
        return streams;

    } catch (error) {
        console.error(`[Vidrock] Error extracting stream: ${error.message}`);
        return [];
    }
}

module.exports = { getVidrockStreams };
