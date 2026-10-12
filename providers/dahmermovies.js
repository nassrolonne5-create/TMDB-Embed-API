const axios = require('axios');
const { getTmdbApiKey } = require('../utils/tmdbKey');

const DAHMER_MOVIES_API = 'https://a.111477.xyz';
const DAHMER_WORKER_API = 'https://p.111477.xyz/bulk?u=';

const REQUEST_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Referer': `${DAHMER_MOVIES_API}/`
};

function parseLinks(html) {
    const links = [];
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let match;
    while ((match = rowRegex.exec(html)) !== null) {
        const rowContent = match[1];
        const linkMatch = rowContent.match(/<a[^>]*href=["']([^"']*)["'][^>]*>([^<]*)<\/a>/i);
        const sizeMatch = rowContent.match(/<td[^>]*>(\d+(?:\.\d+)?\s?[KMGT]B)<\/td>/i);
        if (linkMatch) {
            const href = linkMatch[1];
            const text = linkMatch[2].trim();
            const size = sizeMatch ? sizeMatch[1].trim() : 'N/A';
            if (text && href !== '../' && /\.(mkv|mp4|avi|webm|m3u8)$/i.test(text)) {
                links.push({ text, href, size });
            }
        }
    }
    return links;
}

async function fetchDirectory(title, year, season) {
    const cleanTitle = title.replace(/:/g, '');
    const variants = season !== null ? [
        `/tvs/${encodeURIComponent(cleanTitle)}/Season%20${season < 10 ? '0' + season : season}/`,
        `/tvs/${encodeURIComponent(cleanTitle)}/Season%20${season}/`
    ] : [
        `/movies/${encodeURIComponent(`${cleanTitle} (${year})`)}/`
    ];

    for (const variant of variants) {
        try {
            const res = await axios.get(DAHMER_MOVIES_API + variant, {
                headers: REQUEST_HEADERS,
                timeout: 10000,
                responseType: 'text'
            });
            if (res.data) return { html: res.data, dirUrl: DAHMER_MOVIES_API + variant };
        } catch {
            // try next variant
        }
    }
    return null;
}

function classifyFileAudio(fileName, title) {
    // 1. Strip subtitle tokens to prevent "English ESubs" on Telugu/Hindi files from triggering English audio
    const textWithoutSubs = fileName
        .replace(/\b(eng(?:lish)?[\s._-]*(?:esub|esubs|sub|subs|subtitle|subtitles))\b/gi, '')
        .replace(/\b(esub|esubs|multisub|nosub)\b/gi, '');

    // 2. Check for explicit foreign audio / dub markers
    const foreignAudioRegex = /\b(telugu|tamil|hindi|kannada|malayalam|bengali|marathi|bhojpuri|punjabi|urdu|vff|vfq|vostfr|french|deutsch|german|espanol|castellano|latino|italiano|russian|hin|tam|tel|mal|kan|ben)\b/i;
    const isForeignAudio = foreignAudioRegex.test(textWithoutSubs);

    // 3. Check for dual/multi audio markers
    const isMultiAudio = /\b(multi[\s._-]*audio|dual[\s._-]*audio|multi|dual|dubbed|dub)\b/i.test(textWithoutSubs);

    // 4. Check for genuine English audio markers
    const hasEngAudio = /\b(eng|english)\b/i.test(textWithoutSubs);
    const isStandardEnglishTitle = /^[a-zA-Z0-9\s?!\-:'",.]+$/.test(title);

    if (isForeignAudio && hasEngAudio) {
        return { language: 'Dual Audio', isDubbed: true, isPureEnglish: false };
    }
    if (isForeignAudio && !hasEngAudio) {
        return { language: 'Dubbed', isDubbed: true, isPureEnglish: false };
    }
    if (isMultiAudio) {
        return { language: 'Multi Audio', isDubbed: true, isPureEnglish: false };
    }
    if (hasEngAudio || isStandardEnglishTitle) {
        return { language: 'English', isDubbed: false, isPureEnglish: true };
    }
    return { language: 'Original', isDubbed: false, isPureEnglish: true };
}

async function getDahmermoviesStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    console.log(`[DahmerMovies] Searching for ${mediaType} ${tmdbId}`);

    const tmdbKey = getTmdbApiKey();
    if (!tmdbKey) {
        console.error('[DahmerMovies] No TMDB API key configured.');
        return [];
    }

    let title, year;
    try {
        const type = mediaType === 'tv' ? 'tv' : 'movie';
        const { data } = await axios.get(
            `https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${tmdbKey}`,
            { timeout: 8000 }
        );
        title = data.title || data.name || '';
        year = (data.release_date || data.first_air_date || '').substring(0, 4);
    } catch (err) {
        console.error(`[DahmerMovies] TMDB lookup failed: ${err.message}`);
        return [];
    }

    if (!title) return [];

    const dir = await fetchDirectory(title, year, seasonNum);
    if (!dir) {
        console.log(`[DahmerMovies] Directory not found for "${title}"`);
        return [];
    }

    let paths = parseLinks(dir.html);

    // For TV, filter to the specific episode when possible
    if (seasonNum !== null && episodeNum !== null) {
        const epStr = String(episodeNum).padStart(2, '0');
        const seStr = String(seasonNum).padStart(2, '0');
        const epFiltered = paths.filter(p => {
            const name = p.text.toLowerCase();
            return name.includes(`s${seStr}e${epStr}`) || name.includes(`e${epStr}`);
        });
        if (epFiltered.length > 0) paths = epFiltered;
    }

    // Classify paths by audio language and resolution quality
    const classified = paths.map(p => {
        const audioInfo = classifyFileAudio(p.text, title);
        const is4K = /2160p|4k/i.test(p.text);
        const is1080 = /1080p/i.test(p.text);
        const is720 = /720p/i.test(p.text);
        const qualityRank = is4K ? 3 : (is1080 ? 2 : (is720 ? 1 : 0));
        return { ...p, ...audioInfo, qualityRank };
    });

    // Partition: prioritize pure English / Original audio releases
    const pureEnglishPaths = classified.filter(p => p.isPureEnglish);
    const dualAudioPaths = classified.filter(p => p.language === 'Dual Audio');
    const otherPaths = classified.filter(p => !p.isPureEnglish && p.language !== 'Dual Audio');

    const sortFn = (a, b) => b.qualityRank - a.qualityRank;
    pureEnglishPaths.sort(sortFn);
    dualAudioPaths.sort(sortFn);
    otherPaths.sort(sortFn);

    let selectedPaths = [];
    if (pureEnglishPaths.length >= 5) {
        selectedPaths = pureEnglishPaths.slice(0, 5);
    } else if (pureEnglishPaths.length > 0) {
        selectedPaths = [...pureEnglishPaths, ...dualAudioPaths].slice(0, 5);
    } else {
        selectedPaths = [...dualAudioPaths, ...otherPaths].slice(0, 5);
    }

    const streams = [];
    for (const path of selectedPaths) {
        let directUrl;
        if (path.href.startsWith('http')) {
            directUrl = path.href;
        } else if (path.href.includes('/movies/') || path.href.includes('/tvs/')) {
            directUrl = DAHMER_MOVIES_API + (path.href.startsWith('/') ? '' : '/') + path.href;
        } else {
            directUrl = dir.dirUrl + path.href;
        }
        directUrl = decodeURI(directUrl.replace(/([^:]\/)\/+/g, '$1'));

        const fileName = path.text;
        const formatMatch = fileName.match(/\.(mkv|mp4|m3u8|avi|webm)$/i);
        const fileFormat = formatMatch ? formatMatch[1].toUpperCase() : 'LINK';
        const resolution = fileName.match(/\b(2160p|1080p|720p|4[Kk])\b/)?.[0] || '1080p';

        const info = fileName
            .replace(/\.(mkv|mp4|avi|webm|m3u8)$/i, '')
            .replace(/[[\]()._-]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        streams.push({
            name: 'DahmerMovies',
            title: `${resolution} | ${path.language} | ${path.size} | ${fileFormat} | ${info}`,
            url: DAHMER_WORKER_API + encodeURI(directUrl),
            quality: resolution,
            provider: 'DahmerMovies',
            language: path.language,
            isDubbed: path.isDubbed,
            headers: {
                'User-Agent': REQUEST_HEADERS['User-Agent'],
                'Referer': `${DAHMER_MOVIES_API}/`,
                'Accept': '*/*',
                'Range': 'bytes=0-'
            }
        });
    }

    console.log(`[DahmerMovies] Total results found: ${streams.length}`);
    return streams;
}

module.exports = { getDahmermoviesStreams };
