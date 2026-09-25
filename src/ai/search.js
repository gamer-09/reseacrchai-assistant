const { fetch } = require('undici');
const cheerio = require('cheerio');
const { isOffline } = require('../config/runtimeConfig');

async function searchSerper(query, num = 5) {
  if (isOffline()) return null;
  const key = process.env.SERPER_API_KEY;
  if (!key) return null;
  try {
    const resp = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': key,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ q: query, num })
    });
    if (!resp.ok) {
      // If Serper is misconfigured or the key is invalid, just treat it as unavailable
      console.warn('[search] Serper responded with status', resp.status);
      return null;
    }
    const data = await resp.json();
    const organic = data?.organic || [];
    return organic.map((r) => ({
      title: r.title,
      url: r.link,
      snippet: r.snippet || r.description || ''
    }));
  } catch (err) {
    // Network errors from undici (e.g. "fetch failed") should not crash the request
    console.warn('[search] Serper fetch failed:', err && err.message ? err.message : String(err));
    return null;
  }
}

async function searchBingScrape(query, num = 5) {
  if (isOffline()) return [];
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en`;
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    if (!resp.ok) return [];
    const html = await resp.text();
    const $ = cheerio.load(html);
    const results = [];
    $('li.b_algo').each((_, el) => {
      if (results.length >= num) return;
      const a = $(el).find('h2 a');
      const title = a.text().trim();
      const link = a.attr('href');
      const snippet = $(el).find('.b_caption p').first().text().trim();
      if (title && link && /^https?:\/\//.test(link)) {
        results.push({ title, url: link, snippet });
      }
    });
    return results;
  } catch (err) {
    // If Bing is blocked or unreachable, fall back to "no web results" instead of a 500
    console.warn('[search] Bing scrape failed:', err && err.message ? err.message : String(err));
    return [];
  }
}

async function webSearch(query, opts = {}) {
  const num = Math.min(Math.max(parseInt(opts.num || 5, 10) || 5, 1), 10);
  // Prefer Serper if available
  const serper = await searchSerper(query, num);
  if (Array.isArray(serper) && serper.length) return serper.slice(0, num);
  // Fallback to Bing scraping
  const bing = await searchBingScrape(query, num);
  return bing.slice(0, num);
}

module.exports = { webSearch };
