const axios = require('axios');

// --- VIDSRC PROVIDER (DIRECT HLS RESOLVER) ---
// Frontend Architecture: Native HTML5 Video Player (<video> + HLS.js)
// CRITICAL: NEVER return HTML embed URLs. Return ONLY direct .m3u8 master playlists.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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
    console.log(`[VidSrc] Fetching direct HLS streams for TMDB ID: ${tmdbId}, Type: ${mediaType}`);

    const isTv = mediaType === 'tv';
    const s = seasonNum || 1;
    const ep = episodeNum || 1;

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
            timeout: 6000
        });

        if (!vsSrcResp.data || !vsSrcResp.data.src) {
            console.log('[VidSrc] No gateway src returned from vs_src.php');
            return [];
        }

        const gatewayUrl = vsSrcResp.data.src;
        const host = new URL(gatewayUrl).origin;

        // Step 2: Retrieve internal player configuration from gateway URL
        const gwResp = await axios.get(gatewayUrl, {
            headers: {
                'User-Agent': UA,
                'Referer': 'https://vsembed.ru/'
            },
            timeout: 6000,
            responseType: 'text'
        });

        const cfgMatch = gwResp.data.match(/window\.CFG\s*=\s*(\{.*?\});/);
        if (!cfgMatch) {
            console.log('[VidSrc] window.CFG not found in gateway page');
            return [];
        }

        const cfg = JSON.parse(cfgMatch[1]);
        if (!cfg.playerUrl) {
            console.log('[VidSrc] No playerUrl in window.CFG');
            return [];
        }

        const playerUrl = `${host}${cfg.playerUrl}`;

        // Step 3: Fetch player page to extract CONFIG and single-use apiToken
        const pResp = await axios.get(playerUrl, {
            headers: {
                'User-Agent': UA,
                'Referer': gatewayUrl
            },
            timeout: 6000,
            responseType: 'text'
        });

        const confMatch = pResp.data.match(/window\.CONFIG\s*=\s*(\{.*?\});/);
        if (!confMatch) {
            console.log('[VidSrc] window.CONFIG not found in player page');
            return [];
        }

        const conf = JSON.parse(confMatch[1]);
        if (!conf.api || !conf.apiToken) {
            console.log('[VidSrc] Missing api or apiToken in CONFIG');
            return [];
        }

        // Step 4: Call stream_urls API with the single-use api_token
        const streamApiUrl = conf.api + (conf.api.includes('?') ? '&' : '?') + 'api_token=' + encodeURIComponent(conf.apiToken);
        const sResp = await axios.get(streamApiUrl, {
            headers: {
                'User-Agent': UA,
                'Referer': playerUrl,
                'Origin': host
            },
            timeout: 8000
        });

        const sData = sResp.data;
        if (!sData || (sData.status_code && sData.status_code !== '200' && sData.status_code !== 200)) {
            console.log('[VidSrc] Stream API returned non-200:', sData?.error || sData);
            return [];
        }

        let rawUrls = [];
        if (sData.vs && typeof sData.data?.stream_urls === 'string') {
            rawUrls = await decryptStreamUrls(sData.vs, sData.data.stream_urls);
        } else if (Array.isArray(sData.data?.stream_urls)) {
            rawUrls = sData.data.stream_urls;
        }

        if (rawUrls.length === 0) {
            console.log('[VidSrc] No stream URLs unpacked');
            return [];
        }

        // Step 5: For each raw stream URL, fetch its host token and construct the final direct .m3u8
        const streams = [];
        for (let i = 0; i < rawUrls.length; i++) {
            const rawUrl = rawUrls[i];
            if (!rawUrl.includes('.m3u8')) continue;

            const streamOrigin = new URL(rawUrl).origin;
            const token = await fetchHostToken(streamOrigin, host + '/');
            const finalM3u8Url = applyToken(rawUrl, token);

            // Probe stream to ensure validity
            try {
                const probe = await axios.get(finalM3u8Url, {
                    headers: {
                        'User-Agent': UA,
                        'Referer': host + '/'
                    },
                    timeout: 3000,
                    responseType: 'text',
                    validateStatus: (st) => st === 200 || st === 206
                });

                if (probe.status !== 200 && probe.status !== 206) continue;
                if (!String(probe.data).includes('#EXTM3U')) continue;
            } catch {
                continue;
            }

            streams.push({
                provider: 'VidSrc',
                name: i === 0 ? 'VidSrc (Primary)' : `VidSrc (Server ${i + 1})`,
                title: 'VidSrc 1080p',
                url: finalM3u8Url,
                quality: '1080p',
                type: 'hls',
                headers: {
                    'Referer': host + '/',
                    'Origin': host,
                    'User-Agent': UA
                }
            });
        }

        console.log(`[VidSrc] Successfully unpacked ${streams.length} direct HLS stream(s)`);
        return streams;
    } catch (err) {
        console.error(`[VidSrc Scraper Error tmdb:${tmdbId}]:`, err.message);
        return [];
    }
}

module.exports = {
    extractVidSrc: scrapeVidSrc,
    scrapeVidSrc,
    getVidsrcStreams
};
