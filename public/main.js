(() => {
  console.log('[DEBUG] Main.js initializing...');
  
  const el = {
    form: document.getElementById('researchForm'),
    query: document.getElementById('query'),
    provider: document.getElementById('provider'),
    detail: document.getElementById('detail'),
    maxSources: document.getElementById('maxSources'),
    runBtn: document.getElementById('runBtn'),
    fileForm: document.getElementById('fileForm'),
    fileInput: document.getElementById('fileInput'),
    fileMode: document.getElementById('fileMode'),
    fileCustomWrap: document.getElementById('fileCustomWrap'),
    fileCustom: document.getElementById('fileCustom'),
    fileBtn: document.getElementById('fileBtn'),
    status: document.getElementById('providerStatus'),
    terminal: document.getElementById('terminal'),
    chatForm: document.getElementById('chatForm'),
    chatInput: document.getElementById('chatInput'),
    chatSend: document.getElementById('chatSend'),
    chatClear: document.getElementById('chatClear'),
    chatLog: document.getElementById('chatLog'),
    chatStatus: document.getElementById('chatStatus'),
    offlineToggle: document.getElementById('offlineToggle'),
    codeForm: document.getElementById('codeForm'),
    codePrompt: document.getElementById('codePrompt'),
    codeLanguage: document.getElementById('codeLanguage'),
    codeFramework: document.getElementById('codeFramework'),
    codeTemperature: document.getElementById('codeTemperature'),
    codeRunBtn: document.getElementById('codeRunBtn'),

    previewWrap: document.getElementById('previewWrap'),
    previewFrame: document.getElementById('previewFrame'),
    previewRunBtn: document.getElementById('previewRunBtn'),
    previewOpenBtn: document.getElementById('previewOpenBtn'),
    previewCloseBtn: document.getElementById('previewCloseBtn'),
    previewHint: document.getElementById('previewHint'),
  };

  console.log('[DEBUG] Elements found:', {
    form: !!el.form,
    query: !!el.query,
    provider: !!el.provider,
    terminal: !!el.terminal,
    chatForm: !!el.chatForm,
    codeForm: !!el.codeForm
  });

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function linkifyToHTML(text) {
    const mdRe = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/; // [label](https://...)
    const urlRe = /^(https?:\/\/[^\s<>'"]+|www\.[^\s<>'"]+)/; // bare URL or www.
    const domainRe = /^(?:[a-z][\w-]*\.)+[a-z]{2,}(?:\/[^^\s<>'"]*)?/i; // example.com(/...)
    let html = '';
    let i = 0;
    function stripTrailingPunct(s) {
      // Do not include trailing punctuation in the link (.,;:!?)]}'" )
      let end = s.length;
      while (end > 0 && /[.,;:!?\)\]\}'"”’>]/.test(s[end - 1])) end--;
      return [s.slice(0, end), s.slice(end)];
    }

    while (i < text.length) {
      const rest = text.slice(i);
      let m = mdRe.exec(rest);
      if (m) {
        const label = escapeHtml(m[1]);
        const href = escapeHtml(m[2]);
        html += `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
        i += m[0].length;
        continue;
      }
      m = urlRe.exec(rest);
      if (m) {
        let raw = m[1];
        const [clean, trail] = stripTrailingPunct(raw);
        const href = clean.startsWith('http') ? clean : 'https://' + clean;
        const safeHref = escapeHtml(href);
        const safeDisplay = escapeHtml(clean);
        html += `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${safeDisplay}</a>${escapeHtml(trail)}`;
        i += m[0].length;
        continue;
      }
      // bare domain (avoid emails like user@example.com)
      m = domainRe.exec(rest);
      if (m && !(i > 0 && text[i - 1] === '@')) {
        let raw = m[0];
        const [clean, trail] = stripTrailingPunct(raw);
        const href = 'https://' + clean;
        const safeHref = escapeHtml(href);
        const safeDisplay = escapeHtml(clean);
        html += `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${safeDisplay}</a>${escapeHtml(trail)}`;
        i += raw.length;
        continue;
      }
      // escape single char and advance
      const ch = text[i];
      if (ch === '&') html += '&amp;';
      else if (ch === '<') html += '&lt;';
      else if (ch === '>') html += '&gt;';
      else if (ch === '"') html += '&quot;';
      else if (ch === "'") html += '&#39;';
      else html += ch;
      i++;
    }
    return html;
  }

  function parseCodeBlocks(markdown) {
    const blocks = [];
    const regex = /```([^\n\r]*)\n([\s\S]*?)```/g;
    let lastIndex = 0;
    const proseParts = [];
    if (typeof markdown !== 'string' || !markdown) {
      return { prose: '', blocks: [] };
    }
    let m;
    while ((m = regex.exec(markdown)) !== null) {
      if (m.index > lastIndex) {
        proseParts.push(markdown.slice(lastIndex, m.index));
      }

      const rawTag = (m[1] || '').trim();
      const tag = rawTag ? rawTag.split(/\s+/)[0] : '';
      blocks.push({ lang: tag, code: m[2] || '' });
      lastIndex = regex.lastIndex;
    }
    if (lastIndex < markdown.length) {
      proseParts.push(markdown.slice(lastIndex));
    }
    const prose = proseParts.join('').trim();
    return { prose, blocks };
  }

  function extFromLang(lang) {
    const t = String(lang || '').trim().toLowerCase();
    if (!t) return 'txt';
    if (t.includes('.')) {
      const parts = t.split('.');
      const last = parts[parts.length - 1] || '';
      if (/^[a-z0-9]+$/.test(last)) return last;
    }
    if (t === 'js' || t === 'javascript') return 'js';
    if (t === 'ts' || t === 'typescript') return 'ts';
    if (t === 'html' || t === 'htm') return 'html';
    if (t === 'css') return 'css';
    if (t === 'json') return 'json';
    if (t === 'py' || t === 'python') return 'py';
    if (t === 'sh' || t === 'bash') return 'sh';
    if (t === 'yml' || t === 'yaml') return 'yml';
    if (t === 'md' || t === 'markdown') return 'md';
    return 'txt';
  }

  function filenameFromBlock(block, index) {
    const tag = String(block && block.lang ? block.lang : '').trim();
    const lower = tag.toLowerCase();
    if (tag && /[\\/]/.test(tag)) {
      return tag.replace(/^[\\/]+/, '').split(/[\\/]/).pop() || `code-${index + 1}.txt`;
    }
    if (tag && tag.includes('.') && !/\s/.test(tag)) {
      return tag;
    }

    const ext = extFromLang(lower);
    const base = ext === 'html' ? 'index' : `code-${index + 1}`;
    return `${base}.${ext}`;
  }

  async function copyToClipboard(text) {
    const t = String(text || '');
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(t);
        return true;
      }
    } catch (_) {}

    try {
      const ta = document.createElement('textarea');
      ta.value = t;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return !!ok;
    } catch (_) {
      return false;
    }
  }

  function downloadTextFile(filename, text) {
    const name = String(filename || 'download.txt');
    const blob = new Blob([String(text || '')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2500);
  }

  function hasPreviewEls() {
    return !!(el.previewWrap && el.previewFrame && el.previewRunBtn && el.previewOpenBtn && el.previewCloseBtn && el.previewHint);
  }

  function normalizeWebTag(tag) {
    const t = String(tag || '').trim().toLowerCase();
    if (!t) return '';
    if (t === 'js' || t === 'javascript') return 'js';
    if (t === 'css') return 'css';
    if (t === 'html' || t === 'htm' || t === 'index.html') return 'html';
    if (t.endsWith('.html') || t.endsWith('.htm')) return 'html';
    if (t.endsWith('.css')) return 'css';
    if (t.endsWith('.js') || t.endsWith('.mjs') || t.endsWith('.cjs')) return 'js';
    return t;
  }

  function composePreviewDoc(blocks) {
    const arr = Array.isArray(blocks) ? blocks : [];
    let html = '';
    let css = '';
    let js = '';
    for (const b of arr) {
      const tag = normalizeWebTag(b && b.lang ? b.lang : '');
      const code = String(b && b.code ? b.code : '').trimEnd();
      if (!code) continue;
      if (tag === 'html' && !html) html = code;
      else if (tag === 'css') css += (css ? '\n\n' : '') + code;
      else if (tag === 'js') js += (js ? '\n\n' : '') + code;
    }

    if (!html && !css && !js) return { ok: false, reason: 'Preview is available only for HTML/CSS/JS output.' };

    if (!html) {
      html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Preview</title>
  </head>
  <body>
    <div id="app"></div>
  </body>
</html>`;
    }

    const styleTag = css ? `\n<style>\n${css}\n</style>\n` : '';
    const scriptTag = js
      ? `\n<script>\n(() => {\ntry {\n${js}\n} catch (e) {\nconst pre = document.createElement('pre');\npre.style.whiteSpace = 'pre-wrap';\npre.style.padding = '12px';\npre.textContent = 'Runtime error: ' + (e && e.message ? e.message : String(e));\ndocument.body.appendChild(pre);\n}\n})();\n</script>\n`
      : '';

    let doc = html;
    if (styleTag) {
      if (/(<\/head>)/i.test(doc)) doc = doc.replace(/<\/head>/i, styleTag + '</head>');
      else doc = styleTag + doc;
    }
    if (scriptTag) {
      if (/(<\/body>)/i.test(doc)) doc = doc.replace(/<\/body>/i, scriptTag + '</body>');
      else doc = doc + scriptTag;
    }
    return { ok: true, doc };
  }

  function setPreviewVisible(visible) {
    if (!hasPreviewEls()) return;
    el.previewWrap.hidden = !visible;
  }

  function setPreviewHint(text) {
    if (!hasPreviewEls()) return;
    el.previewHint.textContent = String(text || '');
  }

  function runPreviewDoc(doc) {
    if (!hasPreviewEls()) return;
    el.previewFrame.srcdoc = String(doc || '');
  }

  function openPreviewInTab(doc) {
    const blob = new Blob([String(doc || '')], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 2500);
  }

  function updatePreviewFromBlocks(blocks) {
    if (!hasPreviewEls()) return;
    const composed = composePreviewDoc(blocks);
    if (!composed.ok) {
      setPreviewVisible(false);
      return;
    }
    setPreviewVisible(true);
    setPreviewHint('Sandboxed HTML/CSS/JS preview (client-side only).');
    runPreviewDoc(composed.doc);

    el.previewRunBtn.onclick = () => runPreviewDoc(composed.doc);
    el.previewOpenBtn.onclick = () => openPreviewInTab(composed.doc);
    el.previewCloseBtn.onclick = () => setPreviewVisible(false);
  }

  function scrollToBottom() {
    if (el.terminal) el.terminal.scrollTop = el.terminal.scrollHeight;
    if (el.chatLog) el.chatLog.scrollTop = el.chatLog.scrollHeight;
  }

  function line(text, cls) {
    const div = document.createElement('div');
    div.className = 'line' + (cls ? ' ' + cls : '');
    div.textContent = text;
    el.terminal.appendChild(div);
    scrollToBottom();
    return div;
  }

  function sectionTitle(text) {
    const div = document.createElement('div');
    div.className = 'section';
    div.textContent = text;
    el.terminal.appendChild(div);
    scrollToBottom();
    return div;
  }

  async function typeWriter(text, speed = 12) {
    const pre = document.createElement('pre');
    pre.className = 'typewriter';
    el.terminal.appendChild(pre);
    scrollToBottom();

    // Print character by character
    for (let i = 0; i < text.length; i++) {
      pre.textContent += text[i];
      if (i % 5 === 0) await new Promise(r => setTimeout(r, speed));
      if (i % 64 === 0) scrollToBottom();
    }
    scrollToBottom();
    // After typing finishes, convert URLs to clickable links, move to a normal div for better math layout
    const finalText = pre.textContent;
    const div = document.createElement('div');
    div.className = 'typewriter';
    div.innerHTML = linkifyToHTML(finalText);
    pre.replaceWith(div);
    // Typeset math if MathJax is available
    if (window.MathJax && typeof window.MathJax.typesetPromise === 'function') {
      try { await window.MathJax.typesetPromise([div]); } catch (_) {}
    }
    scrollToBottom();
    return div;
  }

  async function typeIntoElement(element, text, speed = 8) {
    // Type into a temporary <pre> to simulate robotic print, then replace with HTML + MathJax
    const pre = document.createElement('pre');
    pre.className = 'typewriter';
    element.appendChild(pre);
    scrollToBottom();
    for (let i = 0; i < text.length; i++) {
      pre.textContent += text[i];
      if (i % 4 === 0) await new Promise(r => setTimeout(r, speed));
      if (i % 64 === 0) scrollToBottom();
    }
    const finalText = pre.textContent;
    const div = document.createElement('div');
    div.className = 'typewriter';
    div.innerHTML = linkifyToHTML(finalText);
    pre.replaceWith(div);
    if (window.MathJax && typeof window.MathJax.typesetPromise === 'function') {
      try { await window.MathJax.typesetPromise([div]); } catch (_) {}
    }
    scrollToBottom();
    return div;
  }

  // --- Chat UI logic ---
  const chatState = {
    messages: [], // {role, content}
  };

  function renderChatMessage(role, content) {
    const row = document.createElement('div');
    row.className = 'msg-row ' + (role === 'user' ? 'right' : 'left');
    const bubble = document.createElement('div');
    bubble.className = 'msg ' + (role === 'user' ? 'user' : 'assistant');
    if (role === 'user') {
      bubble.textContent = content;
      row.appendChild(bubble);
      el.chatLog.appendChild(row);
      scrollToBottom();
      return { row, bubble };
    }
    // Assistant: we will type into bubble
    row.appendChild(bubble);
    el.chatLog.appendChild(row);
    scrollToBottom();
    return { row, bubble };
  }

  async function sendChat(text) {
    console.log('[DEBUG] sendChat called with text:', text);
    const content = (text || '').trim();
    if (!content) {
      console.log('[DEBUG] No content to send, returning');
      return;
    }
    
    // push user message
    chatState.messages.push({ role: 'user', content });
    console.log('[DEBUG] Added user message to chatState:', chatState.messages);
    renderChatMessage('user', content);
    el.chatInput.value = '';
    el.chatInput.style.height = '';
    el.chatStatus.textContent = 'Sending…';
    el.chatSend.disabled = true;

    try {
      console.log('[DEBUG] Sending chat request to /api/chat');
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: chatState.messages, provider: el.provider.value || undefined })
      });
      console.log('[DEBUG] Chat response received:', res.status, res.statusText);
      
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        console.error('[DEBUG] Chat request failed:', res.status, t);
        throw new Error(`HTTP ${res.status} ${t}`);
      }
      const data = await res.json();
      console.log('[DEBUG] Chat response data:', data);
      const reply = data.reply || '';
      chatState.messages.push({ role: 'assistant', content: reply });
      console.log('[DEBUG] Added assistant reply to chatState:', chatState.messages);
      const { bubble } = renderChatMessage('assistant', '');
      await typeIntoElement(bubble, `BOB: ${reply}`, 8);
      el.chatStatus.textContent = 'Idle';
    } catch (e) {
      console.error('[DEBUG] Chat error:', e);
      const err = `error: ${e.message || String(e)}`;
      const { bubble } = renderChatMessage('assistant', '');
      await typeIntoElement(bubble, `BOB: ${err}`, 12);
      el.chatStatus.textContent = 'Error';
    } finally {
      el.chatSend.disabled = false;
    }
  }

  function resetChat() {
    console.log('[DEBUG] Resetting chat');
    chatState.messages = [];
    el.chatLog.innerHTML = '';
    el.chatStatus.textContent = 'Idle';
  }

  function renderSources(sources) {
    const wrap = document.createElement('div');
    wrap.className = 'sources';
    (sources || []).forEach(s => {
      const row = document.createElement('div');
      row.className = 'source-row';
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = `[${s.id}]`;
      const link = document.createElement('a');
      link.textContent = s.title || s.url;
      const raw = String(s.url || '');
      link.href = raw.startsWith('http') ? raw : 'https://' + raw;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      row.appendChild(badge);
      row.appendChild(link);
      wrap.appendChild(row);
    });
    el.terminal.appendChild(wrap);
    scrollToBottom();
    return wrap;
  }

  async function detectProvider() {
    console.log('[DEBUG] Detecting provider...');
    try {
      const res = await fetch('/api/providers');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      console.log('[DEBUG] Provider detection response:', data);
      const parts = [];
      parts.push(`provider=${data.provider}`);
      if (data.offline) parts.push('offline=on');
      if (data.hasOpenAI) parts.push('openai=on');
      if (data.hasOpenRouter) parts.push('openrouter=on');
      if (data.hasOllama) parts.push('ollama=on');
      if (data.hasSerper) parts.push('serper=on');
      el.status.textContent = 'Ready [' + parts.join(' ') + ']';
      console.log('[DEBUG] Provider status updated:', el.status.textContent);
      if (el.offlineToggle) {
        el.offlineToggle.checked = !!data.offline;
      }
    } catch (e) {
      console.error('[DEBUG] Provider detection failed:', e);
      el.status.textContent = 'Provider detection failed';
    }
  }

  async function runResearch(query, provider, detail, maxSources) {
    console.log('[DEBUG] runResearch called with:', { query, provider, detail, maxSources });
    line(`>> query: ${query}`);
    if (provider) line(`>> provider: ${provider}`);
    if (detail) line(`>> detail: ${detail}`);
    line('>> initializing search…');
    try {
      console.log('[DEBUG] Sending research request to /api/research');
      const res = await fetch('/api/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, provider, detail, maxSources })
      });
      console.log('[DEBUG] Research response received:', res.status, res.statusText);
      
      if (!res.ok) {
        const msg = await res.text().catch(() => '');
        console.error('[DEBUG] Research request failed:', res.status, msg);
        throw new Error(`HTTP ${res.status} ${msg}`);
      }
      const data = await res.json();
      console.log('[DEBUG] Research response data:', data);
      sectionTitle('== sources ==');
      renderSources(data.sources || []);
      sectionTitle('== answer ==');
      await typeWriter(data.answer || '(no answer)');
      line('>> complete.');
    } catch (e) {
      line(`!! error: ${e.message || String(e)}`, 'error');
    }
  }

  async function runCodeGen(prompt, language, framework, temperature, provider) {
    console.log('[DEBUG] runCodeGen called with:', { prompt, language, framework, temperature, provider });
    const trimmed = (prompt || '').trim();
    if (!trimmed) {
      console.log('[DEBUG] No prompt provided, returning');
      return;
    }
    line(`>> code request: ${trimmed.slice(0, 120)}${trimmed.length > 120 ? '…' : ''}`);
    if (language) line(`>> language: ${language}`);
    if (framework) line(`>> framework: ${framework}`);
    if (typeof temperature === 'number') line(`>> temperature: ${temperature}`);
    if (provider) line(`>> provider: ${provider}`);
    line('>> generating code…');
    try {
      const body = { prompt: trimmed };
      if (language) body.language = language;
      if (framework) body.framework = framework;
      if (typeof temperature === 'number' && !Number.isNaN(temperature)) body.temperature = temperature;
      if (provider) body.provider = provider;
      
      console.log('[DEBUG] Sending code generation request to /api/codegen:', body);
      const res = await fetch('/api/codegen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      console.log('[DEBUG] Code generation response received:', res.status, res.statusText);
      
      if (!res.ok) {
        const msg = await res.text().catch(() => '');
        console.error('[DEBUG] Code generation request failed:', res.status, msg);
        throw new Error(`HTTP ${res.status} ${msg}`);
      }
      const data = await res.json();
      console.log('[DEBUG] Code generation response data:', data);
      const text = data.result || '(no code returned)';
      sectionTitle('== generated code ==');
      const parsed = parseCodeBlocks(text);
      if (!parsed.blocks.length) {
        await typeWriter(text);
      } else {
        if (parsed.prose) {
          await typeWriter(parsed.prose);
        }
        const wrap = document.createElement('div');
        wrap.className = 'code-blocks';
        parsed.blocks.forEach((b, idx) => {
          console.log('[DEBUG] Processing code block:', idx, b);
          const card = document.createElement('div');
          card.className = 'code-card';

          const head = document.createElement('div');
          head.className = 'code-card-head';
          const parts = [];
          parts.push(`Code ${idx + 1}`);
          if (b.lang) parts.push(b.lang);

          const headLeft = document.createElement('div');
          headLeft.textContent = parts.join(' • ');

          const actions = document.createElement('div');
          actions.className = 'code-card-actions';

          const copyBtn = document.createElement('button');
          copyBtn.type = 'button';
          copyBtn.className = 'code-action';
          copyBtn.textContent = 'Copy';

          const dlBtn = document.createElement('button');
          dlBtn.type = 'button';
          dlBtn.className = 'code-action';
          dlBtn.textContent = 'Download';

          const codeText = (b.code || '').trimEnd();
          copyBtn.addEventListener('click', async () => {
            const ok = await copyToClipboard(codeText);
            copyBtn.textContent = ok ? 'Copied' : 'Copy';
            setTimeout(() => {
              copyBtn.textContent = 'Copy';
            }, 800);
          });

          dlBtn.addEventListener('click', () => {
            const filename = filenameFromBlock(b, idx);
            downloadTextFile(filename, codeText);
          });

          actions.appendChild(copyBtn);
          actions.appendChild(dlBtn);

          head.appendChild(headLeft);
          head.appendChild(actions);

          const bodyEl = document.createElement('pre');
          bodyEl.className = 'code-card-body';
          const codeEl = document.createElement('code');
          codeEl.textContent = codeText;
          bodyEl.appendChild(codeEl);

          card.appendChild(head);
          card.appendChild(bodyEl);
          wrap.appendChild(card);
        });
        el.terminal.appendChild(wrap);
        scrollToBottom();

        updatePreviewFromBlocks(parsed.blocks);
      }
      line('>> code generation complete.');
    } catch (e) {
      line(`!! error: ${e.message || String(e)}`, 'error');
    }
  }

  async function runFileAnalysis(file, mode, provider) {
    if (!file) return;
    const name = file.name || 'uploaded-file';
    line(`>> file: ${name}`);
    if (mode) line(`>> mode: ${mode}`);
    if (provider) line(`>> provider: ${provider}`);
    line('>> uploading and analyzing…');
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (mode) fd.append('mode', mode);
      if (provider) fd.append('provider', provider);
      const instruction = el.fileCustom && el.fileCustom.value ? el.fileCustom.value.trim() : '';
      if (mode === 'custom' && instruction) fd.append('instruction', instruction);
      const res = await fetch('/api/file-analyze', {
        method: 'POST',
        body: fd
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${msg}`);
      }
      const data = await res.json();
      sectionTitle('== file analysis ==');
      const metaParts = [];
      if (data.filename || name) metaParts.push(`filename: ${data.filename || name}`);
      if (data.mode || mode) metaParts.push(`mode: ${data.mode || mode}`);
      if (data.truncated) {
        metaParts.push(`truncated to ${data.usedCharCount} of ${data.originalCharCount} characters`);
      }
      if (metaParts.length) line(metaParts.join(' | '));
      await typeWriter(data.answer || '(no answer)');
      line('>> file analysis complete.');
    } catch (e) {
      line(`!! error: ${e.message || String(e)}`, 'error');
    }
  }

  function updateFileCustomVisibility() {
    if (!el.fileMode || !el.fileCustomWrap) return;
    const mode = (el.fileMode.value || '').toLowerCase();
    const show = mode === 'custom';
    el.fileCustomWrap.hidden = !show;
    if (!show && el.fileCustom) el.fileCustom.value = '';
  }

  if (el.form && el.query && el.runBtn) {
    el.form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const q = (el.query.value || '').trim();
      if (!q) return;
      el.runBtn.disabled = true;
      try {
        await runResearch(
          q,
          el.provider.value || undefined,
          (el.detail && el.detail.value) || 'deep',
          parseInt((el.maxSources && el.maxSources.value) || '5', 10)
        );
      } finally {
        el.runBtn.disabled = false;
      }
    });
  }

  if (el.codeForm && el.codePrompt && el.codeRunBtn) {
    el.codeForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const prompt = (el.codePrompt.value || '').trim();
      if (!prompt) return;
      el.codeRunBtn.disabled = true;
      try {
        const language = el.codeLanguage && el.codeLanguage.value ? el.codeLanguage.value.trim() : '';
        const framework = el.codeFramework && el.codeFramework.value ? el.codeFramework.value.trim() : '';
        let temperature = 0.2;
        if (el.codeTemperature && el.codeTemperature.value) {
          const parsed = parseFloat(el.codeTemperature.value);
          if (!Number.isNaN(parsed)) temperature = parsed;
        }
        const provider = el.provider && el.provider.value ? el.provider.value : undefined;
        await runCodeGen(prompt, language, framework, temperature, provider);
      } finally {
        el.codeRunBtn.disabled = false;
      }
    });
  }

  // Offline mode toggle
  if (el.offlineToggle && el.status) {
    el.offlineToggle.addEventListener('change', async () => {
      const desired = !!el.offlineToggle.checked;
      try {
        const res = await fetch('/api/offline', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ offline: desired })
        });
        if (!res.ok) {
          el.status.textContent = 'Failed to toggle offline mode';
          return;
        }
        await detectProvider();
      } catch (_) {
        el.status.textContent = 'Failed to toggle offline mode';
      }
    });
  }

  if (el.fileForm && el.fileInput && el.fileBtn) {
    if (el.fileMode) {
      el.fileMode.addEventListener('change', updateFileCustomVisibility);
      updateFileCustomVisibility();
    }
    el.fileForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const files = el.fileInput.files || [];
      const file = files[0];
      if (!file) {
        line('!! please choose a file to analyze.', 'error');
        return;
      }
      el.fileBtn.disabled = true;
      try {
        const mode = (el.fileMode && el.fileMode.value) || 'summary';
        if (String(mode).toLowerCase() === 'custom') {
          const instruction = el.fileCustom && el.fileCustom.value ? el.fileCustom.value.trim() : '';
          if (!instruction) {
            line('!! please enter what you want to do with the file (Custom mode).', 'error');
            return;
          }
        }
        const provider = el.provider && el.provider.value ? el.provider.value : undefined;
        await runFileAnalysis(file, mode, provider);
      } finally {
        el.fileBtn.disabled = false;
      }
    });
  }

  // Wire chat UI only if present on the page
  if (el.chatForm && el.chatInput && el.chatClear) {
    el.chatForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      await sendChat(el.chatInput.value);
    });
    el.chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        el.chatForm.requestSubmit();
      }
    });
    el.chatInput.addEventListener('input', () => {
      el.chatInput.style.height = 'auto';
      el.chatInput.style.height = Math.min(200, el.chatInput.scrollHeight) + 'px';
    });
    el.chatClear.addEventListener('click', () => {
      resetChat();
    });
  }

  detectProvider();
})();

// Open external links in a new tab reliably (works for both pages)
document.addEventListener('click', (e) => {
  const a = e.target && e.target.closest && e.target.closest('a');
  if (!a) return;
  const href = a.getAttribute('href') || '';
  if (!href) return;
  // Skip internal routes and anchors
  if (href.startsWith('/') || href.startsWith('#')) return;
  // Ensure absolute URL
  const absolute = href.startsWith('http') ? href : 'https://' + href;
  if (/^https?:\/\//i.test(absolute)) {
    e.preventDefault();
    try { window.open(absolute, '_blank', 'noopener,noreferrer'); }
    catch (_) { window.location.href = absolute; }
  }
});
