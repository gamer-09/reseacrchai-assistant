const { fetch } = require('undici');
const cheerio = require('cheerio');

function cleanText(s) {
  return (s || '')
    .replace(/\s+/g, ' ')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .trim();
}

async function fetchAndExtract(url) {
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'uiy_31-research-bot/1.0 (+https://example.local)'
      },
      // avoid following endless redirects in some cases
      redirect: 'follow'
    });
    if (!resp.ok) {
      return { url, title: '', text: '', length: 0, error: `HTTP ${resp.status}` };
    }
    const html = await resp.text();
    const $ = cheerio.load(html);

    $('script, style, noscript, iframe, svg, canvas').remove();

    const title = cleanText($('title').first().text());
    const metaDesc = cleanText($('meta[name="description"]').attr('content'));

    // Prefer main content selection if available
    let main = $('main');
    if (!main.length) main = $('#main, #content, article');
    const body = main.length ? main : $('body');

    const parts = [];
    const selectors = 'h1,h2,h3,p,li';
    body.find(selectors).each((_, el) => {
      const t = cleanText($(el).text());
      if (t && t.length > 30) parts.push(t);
      if (parts.length > 400) return false; // cap elements
    });

    const combined = cleanText([metaDesc, ...parts].filter(Boolean).join('\n'));
    const text = combined.slice(0, 12000); // cap to 12k chars to stay reasonable

    return { url, title, text, length: text.length };
  } catch (err) {
    return { url, title: '', text: '', length: 0, error: String(err && err.message || err) };
  }
}

module.exports = { fetchAndExtract };
