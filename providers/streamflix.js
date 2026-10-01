const axios = require('axios');

const API_BASE = 'https://api.streamflix.app';

const DATA_TTL = 30 * 60 * 1000;
const CONFIG_TTL = 5 * 60 * 1000;

let dataCache = null;
let configCache = null;

const REQUEST_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    'Accept': 'application/json, */*',
    'Accept-Language': 'en-US,en;q=0.9'
};

async function getData() {
    if (dataCache && Date.now() - dataCache.ts < DATA_TTL) return dataCache.items;
    console.log('[StreamFlix] fetching data.json');
    const res = await axios.get(`${API_BASE}/data.json`, { headers: REQUEST_HEADERS, timeout: 20000 });
    const items = (res.data && res.data.data) || [];
    dataCache = { items, ts: Date.now() };
    console.log(`[StreamFlix] data.json cached (${items.length} items)`);
    return items;
}

async function getConfig() {
    if (configCache && Date.now() - configCache.ts < CONFIG_TTL) return configCache.config;
    const res = await axios.get(`${API_BASE}/config/config-streamflixapp.json`, { headers: REQUEST_HEADERS, timeout: 8000 });
    configCache = { config: res.data, ts: Date.now() };
    return res.data;
}

function downloadBases(config) {
    const seen = new Set();
    const out = [];
    for (const url of config.download || []) {
        if (url && !seen.has(url)) {
            seen.add(url);
            out.push(url);
        }
    }
    return out;
}

function subtitleHint(filename) {
    const f = (filename || '').toLowerCase();
    if (f.includes('esub') || f.includes('.srt') || f.includes('.ass') || f.includes('sub')) {
        return ' [Embedded Subs]';
    }
    return '';
}

async function getStreamflixStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    if (mediaType !== 'movie') {
        // StreamFlix public database only provides movies; series require private Firebase auth
        return [];
    }
    console.log(`[StreamFlix] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}`);

    try {
        const [items, config] = await Promise.all([getData(), getConfig()]);

        const match = items.find((item) => item.tmdb === String(tmdbId));
        if (!match) {
            console.log(`[StreamFlix] No match found for TMDB ID ${tmdbId}`);
            return [];
        }

        const bases = downloadBases(config);
        if (bases.length === 0) {
            console.log(`[StreamFlix] No download CDN bases in config`);
            return [];
        }

        if (!match.movielink) return [];
        const subs = subtitleHint(match.movielink);
        return bases.map((base, i) => ({
            name: 'StreamFlix',
            title: `StreamFlix${i > 0 ? ` Mirror ${i}` : ''}${subs} | ${match.moviename}`,
            url: `${base}${match.movielink}`,
            quality: 'Auto',
            provider: 'StreamFlix',
            headers: { 'User-Agent': REQUEST_HEADERS['User-Agent'] }
        }));
    } catch (err) {
        console.warn(`[StreamFlix] Error: ${err.message}`);
        return [];
    }
}

module.exports = { getStreamflixStreams };