const { fetch } = require('undici');
const { isOffline } = require('../config/runtimeConfig');

async function extractTextFromImage(buffer, mime) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    throw new Error('Invalid image buffer for OCR');
  }
  if (isOffline()) {
    throw new Error('Image OCR is disabled in OFFLINE_MODE. Please upload text-based files instead of images.');
  }
  const apiKey = process.env.OCR_SPACE_API_KEY;
  if (!apiKey) {
    throw new Error('OCR_SPACE_API_KEY is not set. Configure it in your .env to enable image OCR.');
  }

  const contentType = typeof mime === 'string' && mime.trim() ? mime.trim() : 'image/png';
  const base64 = buffer.toString('base64');

  const params = new URLSearchParams();
  params.append('apikey', apiKey);
  params.append('language', 'eng');
  params.append('isOverlayRequired', 'false');
  params.append('OCREngine', '2');
  params.append('base64Image', `data:${contentType};base64,${base64}`);

  const resp = await fetch('https://api.ocr.space/parse/image', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`OCR HTTP error ${resp.status}: ${text}`);
  }

  const data = await resp.json();
  if (!data || data.IsErroredOnProcessing) {
    const msg = Array.isArray(data?.ErrorMessage) ? data.ErrorMessage.join('; ') : data?.ErrorMessage || 'Unknown OCR error';
    throw new Error(`OCR processing error: ${msg}`);
  }

  const result = Array.isArray(data.ParsedResults) && data.ParsedResults[0] && data.ParsedResults[0].ParsedText;
  const text = (result || '').trim();
  return text;
}

module.exports = { extractTextFromImage };
