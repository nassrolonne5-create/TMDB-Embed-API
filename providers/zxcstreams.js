const CryptoJS = require('crypto-js');
const { getDetails, resolveImdbId } = require('../utils/tmdb');

const ZXC_BASE = 'https://player.zxcprime.xyz';
const SERVERS = ['berkas'];
const AES_KEY = '7f4c9e2a81d63b05c4f7a9e8126d3b50e1a8c7f23d9465ab0c6e9f1d4a7b832c';

const F = {
    id: 'a7f39c821d604e5b9c71f36e1547b',
    fToken: 'e83c4b719a52d3136052479c1635a',
    ts: '61d9a5274c8e3b29afd6384c291e6',
    token: 'c492f7a183d6502b1e7436c538a716d',
    title: '5e28c9147a306d1e829f3674b392a1',
    year: 'b731e6c94f08269d725f8341c306e',
    season: 'd8427b59ce30684a2f957c3613e85b',
    episode: '91c6e4a728503d1f785c92346b713d',
    imdbId: 'f35a8c19d674b3265e871c4933a725f',
    path: '6b491e7253ad84d392e7561a9384c',
    mediaType: 'c285f91ab306d28147a35632e816b',
    date: 'e164932c50216a39e5814b3027'
};

const COMMON_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Origin': ZXC_BASE
};

function decryptLink(cipherText) {
    if (!cipherText) return null;
    try {
        const decrypted = CryptoJS.AES.decrypt(cipherText, AES_KEY).toString(CryptoJS.enc.Utf8);
        return decrypted && decrypted.startsWith('http') ? decrypted : null;
    } catch {
        return null;
    }
}

async function fetchServer(server, meta, type, season, episode) {
    const referer = `${ZXC_BASE}/player/${type}/${meta.tmdbId}${season != null ? `/${season}/${episode}` : ''}`;
    const headers = {
        ...COMMON_HEADERS,
        Referer: referer
    };

    try {
        const gaguRes = await fetch(`${ZXC_BASE}/backend/gagu`, {
            method: 'POST',
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                [F.id]: meta.tmdbId,
                [F.mediaType]: type,
                [F.path]: server,
                ...(type === 'tv' ? { [F.season]: season, [F.episode]: episode } : {})
            }),
            signal: AbortSignal.timeout(6000)
        });

        if (!gaguRes.ok) return [];
        const gaguData = await gaguRes.json();
        if (!gaguData || !gaguData.token) return [];

        const params = new URLSearchParams({
            [F.id]: meta.tmdbId,
            [F.path]: server,
            [F.mediaType]: type,
            [F.ts]: String(gaguData.ts),
            [F.token]: gaguData.token,
            [F.title]: meta.title,
            [F.year]: meta.year,
            [F.date]: meta.releaseDate
        });
        if (type === 'tv' && season != null && episode != null) {
            params.set(F.season, String(season));
            params.set(F.episode, String(episode));
        }
        if (meta.imdbId) {
            params.set(F.imdbId, meta.imdbId);
        }

        const srcRes = await fetch(`${ZXC_BASE}/backend_/sources/${server}?${params.toString()}`, {
            headers,
            signal: AbortSignal.timeout(6000)
        });

        if (!srcRes.ok) return [];
        const srcData = await srcRes.json();
        if (!srcData || !Array.isArray(srcData.links)) return [];

        const result = [];
        for (const l of srcData.links) {
            const rawUrl = l.link;
            const decryptedUrl = decryptLink(rawUrl) || rawUrl;
            if (decryptedUrl && decryptedUrl.startsWith('http')) {
                result.push({
                    server,
                    type: l.type || (decryptedUrl.includes('.m3u8') ? 'hls' : 'mp4'),
                    resolution: l.resolution || 'Auto',
                    url: decryptedUrl,
                    requestHeaders: headers
                });
            }
        }
        return result;
    } catch {
        return [];
    }
}

async function getAllStreams(type, meta, season, episode) {
    const results = await Promise.allSettled(
        SERVERS.map((s) => fetchServer(s, meta, type, season, episode))
    );
    const streams = [];
    for (const r of results) {
        if (r.status === 'fulfilled' && Array.isArray(r.value)) {
            streams.push(...r.value);
        }
    }
    return streams;
}

async function getZxcstreamsStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    console.log(`[ZXCStreams] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}`);

    try {
        const type = mediaType === 'tv' ? 'tv' : 'movie';
        const tmdbType = mediaType === 'tv' ? 'tv' : 'movie';
        const details = await getDetails(tmdbType, tmdbId);
        const title = (details && (details.title || details.name)) || '';
        if (!title) {
            console.log(`[ZXCStreams] No TMDB title resolved for ${tmdbId}`);
            return [];
        }
        const releaseDate = (details && (details.release_date || details.first_air_date || '').slice(0, 10)) || '';
        const year = (details && (details.release_date || details.first_air_date || '').slice(0, 4)) || '';
        const imdbId = await resolveImdbId(tmdbType, tmdbId);

        const meta = {
            tmdbId: String(tmdbId),
            title,
            year,
            releaseDate,
            imdbId: imdbId || ''
        };

        const links = await getAllStreams(type, meta, seasonNum, episodeNum);
        if (!links.length) {
            console.log(`[ZXCStreams] No streams found for "${title}"`);
            return [];
        }

        const streams = [];
        for (const l of links) {
            const serverName = l.server === 'icarus' ? 'Icarus' : 'Berkas';
            const kind = l.type === 'hls' ? 'HLS' : 'MP4';
            const quality = typeof l.resolution === 'number' ? `${l.resolution}p` : String(l.resolution || 'Auto');
            streams.push({
                name: `ZXCStreams (${serverName})`,
                title: `ZXCStreams - ${serverName} • ${quality} • ${kind}`,
                url: l.url,
                quality,
                provider: 'ZXCStreams',
                headers: {
                    'Referer': l.requestHeaders.Referer,
                    'Origin': l.requestHeaders.Origin,
                    'User-Agent': l.requestHeaders['User-Agent']
                }
            });
        }

        console.log(`[ZXCStreams] Got ${streams.length} stream(s) for "${title}"`);
        return streams;
    } catch (err) {
        console.error(`[ZXCStreams] Error: ${err.message}`);
        return [];
    }
}

module.exports = { getZxcstreamsStreams };