const axios = require('axios');

// --- VIDSRC PROVIDER FIX ---
// BLOCKED: https://vixsrc.to (Cloudflare 403)
// DEAD:    https://vidsrc.net, https://vidsrc.xyz
// ACTIVE:  https://vidsrc.to, https://vidsrc.me, https://vidsrc.pm

const VIDSRC_DOMAINS = [
    'https://vidsrc.to',
    'https://vidsrc.me',
    'https://vidsrc.pm'
];

const REMOTE_SCRAPER_URL = process.env.REMOTE_SCRAPER_URL || 'http://62.171.179.144:3005';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function getVidSrcEmbedUrl(tmdbId, mediaType = 'movie', season = null, episode = null) {
    const isTv = mediaType === 'tv' || mediaType === 'series';
    if (isTv) {
        return `https://vidsrc.to/embed/tv/${tmdbId}/${season || 1}/${episode || 1}`;
    }
    return `https://vidsrc.to/embed/movie/${tmdbId}`;
}

async function fetchHostToken(origin, referer) {
    try {
        const resp = await axios.get(`${origin}/generate.php`, {
            headers: {
                'User-Agent': UA,
                'Referer': referer
            },
            timeout: 5000,
            responseType: 'text'
        });
        const text = String(resp.data || '').trim();
        if (text.startsWith('{') || text.startsWith('[')) {
            try {
                const j = JSON.parse(text);
                return (j && (j.token || j.data || j.string || j.result)) || text;
            } catch {
                return text;
            }
        }
        return text;
    } catch {
        return '';
    }
}

function applyToken(url, token) {
    if (!token) return url;
    if (url.includes('__TOKEN__')) return url.split('__TOKEN__').join(token);
    return url + (url.includes('?') ? '&' : '?') + 'token=' + token;
}

async function decryptStreamUrls(wasmSource, encryptedB64) {
    try {
        const wasmBuf = wasmSource.wasm_url
            ? Buffer.from(await (await axios.get(wasmSource.wasm_url, { responseType: 'arraybuffer', timeout: 5000 })).data)
            : Buffer.from(wasmSource.wasm, 'base64');

        const mod = await WebAssembly.compile(wasmBuf);
        const inst = await WebAssembly.instantiate(mod, {});
        const ex = inst.exports;
        const enc = Buffer.from(encryptedB64, 'base64');
        const ptr = ex.alloc(enc.length);
        new Uint8Array(ex.memory.buffer, ptr, enc.length).set(enc);
        const outLen = ex.decrypt(ptr, enc.length);
        const decryptedTxt = new TextDecoder().decode(new Uint8Array(ex.memory.buffer, ptr + 12, outLen));
        return decryptedTxt.split('\n').filter(Boolean);
    } catch (err) {
        console.error('[VidSrc] WASM decryption failed:', err.message);
        return [];
    }
}

async function scrapeVidSrc(tmdbId, mediaType = 'movie', season = null, episode = null) {
    return getVidsrcStreams(tmdbId, mediaType, season, episode);
}

async function getVidsrcStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    console.log(`[VidSrc] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}`);

    const isTv = mediaType === 'tv' || mediaType === 'series';
    const s = seasonNum || 1;
    const ep = episodeNum || 1;

    // Step 0: Try remote scraper backend (which has full direct extraction)
    try {
        const remotePath = isTv
            ? `${REMOTE_SCRAPER_URL}/api/streams/vidsrc/tv/${tmdbId}?season=${s}&episode=${ep}`
            : `${REMOTE_SCRAPER_URL}/api/streams/vidsrc/movie/${tmdbId}`;

        const remoteResp = await axios.get(remotePath, { timeout: 4500 });
        if (remoteResp.data && Array.isArray(remoteResp.data.streams) && remoteResp.data.streams.length > 0) {
            console.log(`[VidSrc] Resolved ${remoteResp.data.streams.length} stream(s) via remote scraper`);
            const directStreams = remoteResp.data.streams.map(stream => ({
                provider: 'VidSrc',
                name: stream.name || 'VidSrc (Primary)',
                title: stream.title || 'VidSrc 1080p',
                url: stream.url,
                quality: stream.quality || '1080p',
                type: stream.type || 'hls',
                isM3U8: true,
                headers: stream.headers || {
                    'Referer': 'https://vidsrc.to/',
                    'Origin': 'https://vidsrc.to',
                    'User-Agent': UA
                }
            }));

            // Also attach active mirror embed so browsers without proxy can play instantly
            const altMirror = isTv
                ? `https://vidsrc.me/embed/tv?tmdb=${tmdbId}&season=${s}&episode=${ep}`
                : `https://vidsrc.me/embed/movie?tmdb=${tmdbId}`;

            directStreams.push({
                provider: 'VidSrc',
                name: 'VidSrc (Mirror)',
                title: 'VidSrc Player 1080p',
                url: altMirror,
                quality: '1080p',
                isEmbed: true,
                type: 'iframe',
                headers: {
                    'Referer': 'https://vidsrc.me/',
                    'Origin': 'https://vidsrc.me',
                    'User-Agent': UA
                }
            });

            return directStreams;
        }
    } catch (err) {
        // Continue to local decryption pipeline
    }

    try {
        // Step 1: Request signed gateway API token from vsembed.ru
        const queryParam = isTv
            ? `type=tv&id=${tmdbId}&s=${s}&e=${ep}`
            : `type=movie&id=${tmdbId}`;

        const vsSrcResp = await axios.get(`https://vsembed.ru/vs_src.php?${queryParam}`, {
            headers: {
                'User-Agent': UA,
                'Referer': isTv
                    ? `https://vsembed.ru/embed/tv/${tmdbId}/${s}/${ep}`
                    : `https://vsembed.ru/embed/movie/${tmdbId}/`
            },
            timeout: 5000
        });

        if (vsSrcResp.data && vsSrcResp.data.src) {
            const gatewayUrl = vsSrcResp.data.src;
            const host = new URL(gatewayUrl).origin;

            // Step 2: Retrieve internal player configuration from gateway URL
            const gwResp = await axios.get(gatewayUrl, {
                headers: {
                    'User-Agent': UA,
                    'Referer': 'https://vsembed.ru/'
                },
                timeout: 5000,
                responseType: 'text'
            });

            const cfgMatch = gwResp.data.match(/window\.CFG\s*=\s*(\{.*?\});/);
            if (cfgMatch) {
                const cfg = JSON.parse(cfgMatch[1]);
                if (cfg.playerUrl) {
                    const playerUrl = `${host}${cfg.playerUrl}`;

                    // Step 3: Fetch player page to extract CONFIG and single-use apiToken
                    const pResp = await axios.get(playerUrl, {
                        headers: {
                            'User-Agent': UA,
                            'Referer': gatewayUrl
                        },
                        timeout: 5000,
                        responseType: 'text'
                    });

                    const confMatch = pResp.data.match(/window\.CONFIG\s*=\s*(\{.*?\});/);
                    if (confMatch) {
                        const conf = JSON.parse(confMatch[1]);
                        if (conf.api && conf.apiToken) {
                            // Step 4: Call stream_urls API with the single-use api_token
                            const streamApiUrl = conf.api + (conf.api.includes('?') ? '&' : '?') + 'api_token=' + encodeURIComponent(conf.apiToken);
                            const sResp = await axios.get(streamApiUrl, {
                                headers: {
                                    'User-Agent': UA,
                                    'Referer': playerUrl,
                                    'Origin': host
                                },
                                timeout: 6000
                            });

                            const sData = sResp.data;
                            let rawUrls = [];
                            if (sData?.vs && typeof sData?.data?.stream_urls === 'string') {
                                rawUrls = await decryptStreamUrls(sData.vs, sData.data.stream_urls);
                            } else if (Array.isArray(sData?.data?.stream_urls)) {
                                rawUrls = sData.data.stream_urls;
                            }

                            if (rawUrls.length > 0) {
                                const streams = [];
                                for (let i = 0; i < rawUrls.length; i++) {
                                    const rawUrl = rawUrls[i];
                                    if (!rawUrl.includes('.m3u8')) continue;

                                    const streamOrigin = new URL(rawUrl).origin;
                                    const token = await fetchHostToken(streamOrigin, host + '/');
                                    const finalM3u8Url = applyToken(rawUrl, token);

                                    streams.push({
                                        provider: 'VidSrc',
                                        name: i === 0 ? 'VidSrc (Primary)' : `VidSrc (Server ${i + 1})`,
                                        title: 'VidSrc 1080p',
                                        url: finalM3u8Url,
                                        quality: '1080p',
                                        type: 'hls',
                                        isM3U8: true,
                                        headers: {
                                            'Referer': host + '/',
                                            'Origin': host,
                                            'User-Agent': UA
                                        }
                                    });
                                }

                                if (streams.length > 0) {
                                    console.log(`[VidSrc] Successfully unpacked ${streams.length} direct HLS stream(s)`);
                                    return streams;
                                }
                            }
                        }
                    }
                }
            }
        }
    } catch (err) {
        console.warn(`[VidSrc] Direct decryption notice: ${err.message}`);
    }

    // Embed fallback if direct HLS extraction blocked
    const embedUrl = getVidSrcEmbedUrl(tmdbId, mediaType, seasonNum, episodeNum);
    const altMirror = isTv
        ? `https://vidsrc.me/embed/tv?tmdb=${tmdbId}&season=${s}&episode=${ep}`
        : `https://vidsrc.me/embed/movie?tmdb=${tmdbId}`;

    return [
        {
            provider: 'VidSrc',
            name: 'VidSrc (to)',
            title: 'VidSrc Player (vidsrc.to)',
            url: embedUrl,
            quality: '1080p',
            isEmbed: true,
            type: 'iframe',
            headers: {
                'Referer': 'https://vidsrc.to/',
                'Origin': 'https://vidsrc.to',
                'User-Agent': UA
            }
        },
        {
            provider: 'VidSrc',
            name: 'VidSrc (me)',
            title: 'VidSrc Player (vidsrc.me)',
            url: altMirror,
            quality: '1080p',
            isEmbed: true,
            type: 'iframe',
            headers: {
                'Referer': 'https://vidsrc.me/',
                'Origin': 'https://vidsrc.me',
                'User-Agent': UA
            }
        }
    ];
}

module.exports = {
    VIDSRC_DOMAINS,
    getVidSrcEmbedUrl,
    extractVidSrc: scrapeVidSrc,
    scrapeVidSrc,
    getVidsrcStreams
};
