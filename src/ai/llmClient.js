const { fetch } = require('undici');
const { isOffline } = require('../config/runtimeConfig');

function getProvider() {
  // In OFFLINE_MODE, only ever use local Ollama (no cloud LLMs)
  if (isOffline()) {
    if (process.env.OLLAMA_BASE_URL || process.env.OLLAMA_MODEL) return 'ollama';
    return 'none';
  }

  // First, try explicit provider if set and configured
  const explicit = process.env.LLM_PROVIDER && process.env.LLM_PROVIDER.toLowerCase();
  if (explicit) {
    if (explicit === 'openai' && process.env.OPENAI_API_KEY) return 'openai';
    if (explicit === 'openrouter' && process.env.OPENROUTER_API_KEY) return 'openrouter';
    if (explicit === 'ollama' && (process.env.OLLAMA_BASE_URL || process.env.OLLAMA_MODEL)) return 'ollama';
  }
  // Fallback: auto-detect based on available keys
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.OPENROUTER_API_KEY) return 'openrouter';
  if (process.env.OLLAMA_BASE_URL || process.env.OLLAMA_MODEL) return 'ollama';
  return 'none';
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryableNetworkError(err) {
  const msg = String((err && err.message) || err || '').toLowerCase();
  return (
    err?.name === 'AbortError' ||
    /timeout|timed out|socket|reset|hang up|incomplete envelope|network|tls|ssl|closed by the remote host|wsarecv/.test(msg)
  );
}

async function requestJson(url, fetchOptions, { retries = 2, timeoutMs = 30000, name = 'request' } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, { ...(fetchOptions || {}), signal: controller.signal });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        const e = new Error(`${name} error ${resp.status}: ${text}`);
        e.status = resp.status;
        e.body = text;
        throw e;
      }
      return await resp.json();
    } catch (e) {
      lastErr = e;
      if (attempt < retries && isRetryableNetworkError(e)) {
        await sleep(500 * (attempt + 1));
        continue;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

function buildNoProviderFallback(messages) {
  const userMessages = Array.isArray(messages)
    ? messages.filter((m) => m && m.role === 'user' && typeof m.content === 'string')
    : [];
  const lastUser = userMessages.length ? userMessages[userMessages.length - 1] : null;
  const prompt = lastUser ? lastUser.content.trim() : '';

  const intro = 'No LLM provider is configured or reachable right now.';
  const details =
    'The server could not connect to OpenAI, OpenRouter, or a local Ollama instance. ' +
    'To enable AI-generated answers, configure at least one provider in the .env file ' +
    '(OPENAI_API_KEY, OPENROUTER_API_KEY, or OLLAMA_BASE_URL).';

  if (!prompt) {
    return `${intro}\n\n${details}`;
  }

  return `${intro}\n\nYou asked:\n${prompt}\n\n${details}`;
}

async function chat(messages, options = {}) {
  let provider = (options.provider || getProvider()).toLowerCase();
  const temperature = options.temperature ?? 0.2;

  // Helper to attempt a provider and fall back
  async function attempt(p) {
    if (p === 'openai') {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error('OPENAI_API_KEY not set');
      const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
      const data = await requestJson(
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ model, messages, temperature })
        },
        { retries: 2, timeoutMs: 30000, name: 'OpenAI' }
      );
      return data.choices?.[0]?.message?.content || '';
    }

    if (p === 'openrouter') {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');
      const model = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
      const data = await requestJson(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ model, messages, temperature })
        },
        { retries: 2, timeoutMs: 30000, name: 'OpenRouter' }
      );
      return data.choices?.[0]?.message?.content || '';
    }

    if (p === 'ollama') {
      const base = (process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/$/, '');
      const model = process.env.OLLAMA_MODEL || 'llama3.1';
      const data = await requestJson(
        `${base}/api/chat`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages, stream: false, options: { temperature } })
        },
        { retries: 2, timeoutMs: 45000, name: 'Ollama' }
      );
      if (data?.message?.content) return data.message.content;
      if (typeof data?.response === 'string') return data.response;
      return '';
    }

    throw new Error(`Unknown provider: ${p}`);
  }

  const order = [];
  if (provider && provider !== 'none') {
    // In OFFLINE_MODE, ignore cloud providers even if explicitly requested
    if (!isOffline() || provider === 'ollama') {
      order.push(provider);
    }
  }
  if (isOffline()) {
    // Strict offline: only local Ollama is allowed
    if (!order.includes('ollama')) {
      order.push('ollama');
    }
  } else {
    for (const p of ['openai', 'openrouter', 'ollama']) {
      if (p && !order.includes(p)) {
        order.push(p);
      }
    }
  }

  const tried = [];
  for (const p of order) {
    try {
      return await attempt(p);
    } catch (e) {
      console.warn(`[LLM] Provider ${p} not usable: ${e.message}`);
      tried.push(p);
    }
  }

  console.warn('[LLM] No usable LLM providers found; returning a fallback explanation instead of throwing. Tried:', tried);
  return buildNoProviderFallback(messages);
}

module.exports = { chat, getProvider };
