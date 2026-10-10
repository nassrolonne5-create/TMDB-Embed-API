const crypto = require('crypto');
const axios = require('axios');

// --- VIDROCK PROVIDER FIX ---
const VIDROCK_DOMAINS = [
    'https://vidrock.to',
    'https://vidrock.net',
    'https://vidrock.ru'
];

const VIDROCK_API_PRIMARY = 'https://vidrock.net/api';
const VIDROCK_API_FALLBACK = 'https://vidrock.to/api';
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
    'Referer': 'https://vidrock.to/',
    'Origin': 'https://vidrock.to'
};

const VIDROCK_KEY_HEX = '7f3e9c2a8b5d1f4e6a9c3b7d2e5f8a1c4b6d9e2f5a8c1b4d7e9f2a5c8b1d4e7f';
const AES_KEY = Buffer.from(VIDROCK_KEY_HEX, 'hex');

function decryptVidrockUrl(encStr) {
    if (!encStr || typeof encStr !== 'string') return null;
    try {
        let b64 = encStr.replace(/-/g, '+').replace(/_/g, '/');
        while (b64.length % 4) b64 += '=';
        const buf = Buffer.from(b64, 'base64');
        if (buf.length < 28) return null; // 12 bytes IV + at least 16 bytes auth tag
        const iv = buf.subarray(0, 12);
        const tag = buf.subarray(buf.length - 16);
        const data = buf.subarray(12, buf.length - 16);
        const decipher = crypto.createDecipheriv('aes-256-gcm', AES_KEY, iv);
        decipher.setAuthTag(tag);
        return decipher.update(data, null, 'utf8') + decipher.final('utf8');
    } catch {
        return null;
    }
}

async function fetchSources(path) {
    for (const base of [VIDROCK_API_PRIMARY, VIDROCK_API_FALLBACK]) {
        try {
            const resp = await axios.get(`${base}/${path}`, {
                headers: HEADERS,
                timeout: 8000
            });
            if (resp.status === 200 && resp.data && typeof resp.data === 'object') {
                return resp.data;
            }
        } catch {
            // try next base
        }
    }
    return null;
}

async function scrapeVidrock(tmdbId, mediaType = 'movie', season = null, episode = null) {
    return getVidrockStreams(tmdbId, mediaType, season, episode);
}

async function getVidrockStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    console.log(`[Vidrock] Fetching direct HLS streams for TMDB ID: ${tmdbId}, Type: ${mediaType}`);

    try {
        const path = mediaType === 'tv'
            ? `tv/${tmdbId}/${seasonNum || 1}/${episodeNum || 1}`
            : `movie/${tmdbId}`;

        const data = await fetchSources(path);
        const streams = [];

        if (data) {
            for (const [serverName, serverInfo] of Object.entries(data)) {
                if (!serverInfo || typeof serverInfo !== 'object' || !serverInfo.url) continue;

                const decryptedUrl = decryptVidrockUrl(serverInfo.url);
                if (!decryptedUrl || !decryptedUrl.includes('.m3u8')) continue;

                // Probe stream to ensure it is not Cloudflare-blocked (403) or an HTML error page
                try {
                    const probe = await axios.get(decryptedUrl, {
                        headers: {
                            'Referer': 'https://vidrock.to/',
                            'User-Agent': HEADERS['User-Agent'],
                            'Range': 'bytes=0-100'
                        },
                        timeout: 2500,
                        responseType: 'text',
                        validateStatus: (s) => (s >= 200 && s < 400) || s === 206
                    });
                    const ct = (probe.headers['content-type'] || '').toLowerCase();
                    if (ct.includes('text/html') || probe.status >= 400) {
                        console.log(`[Vidrock] Skipping ${serverName}: returned HTTP ${probe.status} / HTML block page.`);
                        continue;
                    }
                } catch (err) {
                    console.log(`[Vidrock] Skipping ${serverName}: stream unreachable (${err.message}).`);
                    continue;
                }

                streams.push({
                    provider: 'Vidrock',
                    name: `Vidrock (${serverName})`,
                    title: `Vidrock 1080p`,
                    url: decryptedUrl,
                    quality: '1080p',
                    type: 'hls',
                    headers: {
                        'Referer': 'https://vidrock.to/',
                        'User-Agent': HEADERS['User-Agent']
                    }
                });
            }
        }

        console.log(`[Vidrock] Successfully extracted ${streams.length} direct HLS stream(s).`);
        return streams;
    } catch (error) {
        console.error(`[Vidrock] Error extracting stream: ${error.message}`);
        return [];
    }
}

module.exports = {
    VIDROCK_DOMAINS,
    extractVidrock: scrapeVidrock,
    scrapeVidrock,
    getVidrockStreams
};
