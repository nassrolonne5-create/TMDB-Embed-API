const { config } = require('./config');

const FALLBACK_TMDB_API_KEY = '4e44d9029b1270a757cddc766a1bcb63';

function getTmdbApiKey() {
  if (config.tmdbApiKeys && config.tmdbApiKeys.length) {
    const idx = Math.floor(Math.random() * config.tmdbApiKeys.length);
    return config.tmdbApiKeys[idx];
  }
  // Fallback legacy single value (config or env) or working default key
  return config.tmdbApiKey || process.env.TMDB_API_KEY || FALLBACK_TMDB_API_KEY;
}

module.exports = { getTmdbApiKey, FALLBACK_TMDB_API_KEY };
