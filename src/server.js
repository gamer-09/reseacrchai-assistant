const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');
const { webSearch } = require('./ai/search');
const { fetchAndExtract } = require('./ai/fetchPage');
const notesStore = require('./ai/notesStore');
const { chat, getProvider } = require('./ai/llmClient');
const { extractTextFromImage } = require('./ai/ocr');
const { fetch, FormData } = require('undici');
const multer = require('multer');
const { isOffline, setOffline, OFFLINE_DEFAULT } = require('./config/runtimeConfig');

// Debug: log provider and API key presence
console.log('[DEBUG] dotenv path:', path.join(__dirname, '..', '.env'));
console.log('[DEBUG] LLM_PROVIDER:', process.env.LLM_PROVIDER);
console.log('[DEBUG] Detected provider:', getProvider());
console.log('[DEBUG] OPENROUTER_API_KEY present:', !!process.env.OPENROUTER_API_KEY);
console.log('[DEBUG] OPENROUTER_API_KEY value (first 10 chars):', process.env.OPENROUTER_API_KEY ? process.env.OPENROUTER_API_KEY.slice(0, 10) + '...' : 'undefined');
console.log('[DEBUG] OPENAI_API_KEY present:', !!process.env.OPENAI_API_KEY);
console.log('[DEBUG] OPENAI_API_KEY value (first 10 chars):', process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.slice(0, 10) + '...' : 'undefined');

const app = express();
const port = process.env.PORT || 3009;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.get(/^\/chat(\/.*)?$/, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'chat.html'));
});

app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

async function probeLocalOllama(timeoutMs = 600) {
  const base = (process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/$/, '');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(`${base}/api/tags`, { method: 'GET', signal: ctrl.signal });
    return resp.ok;
  } catch (_) {
    return false;
  } finally {
    clearTimeout(t);
  }
}

app.get('/api/providers', async (req, res) => {
  const prov = (process.env.LLM_PROVIDER || '').toLowerCase() || getProvider();
  const hasOllamaLocal = await probeLocalOllama(500);
  const offline = isOffline();
  res.json({
    provider: prov,
    offline,
    hasOpenAI: !offline && !!process.env.OPENAI_API_KEY,
    hasOpenRouter: !offline && !!process.env.OPENROUTER_API_KEY,
    hasOllama: !!(process.env.OLLAMA_BASE_URL || process.env.OLLAMA_MODEL),
    hasOllamaLocal,
    hasSerper: !offline && !!process.env.SERPER_API_KEY
  });
});

app.get('/api/offline', (req, res) => {
  res.json({ offline: isOffline(), default: OFFLINE_DEFAULT });
});

app.post('/api/offline', (req, res) => {
  try {
    const body = req.body || {};
    const raw = body.offline;
    const value = typeof raw === 'boolean' ? raw : String(raw).toLowerCase() === 'true';
    setOffline(value);
    res.json({ offline: isOffline() });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.post('/api/codegen', async (req, res) => {
  try {
    const body = req.body || {};
    const prompt = (body.prompt || '').toString().trim();
    if (!prompt) {
      res.status(400).json({ error: 'prompt is required' });
      return;
    }

    const language = (body.language || '').toString().trim();
    const framework = (body.framework || '').toString().trim();
    const style = (body.style || '').toString().trim();

    let usedProvider = (body.provider || getProvider()).toString().toLowerCase();
    if (!usedProvider || usedProvider === 'none') {
      if (await probeLocalOllama(600)) {
        usedProvider = 'ollama';
      }
    }

    let temperature = 0.2;
    if (typeof body.temperature === 'number') {
      if (!Number.isNaN(body.temperature) && body.temperature >= 0 && body.temperature <= 1) {
        temperature = body.temperature;
      }
    }

    const systemContent = `You are a senior software engineer and code generation assistant.
- Generate high-quality, secure, and maintainable code.
- Refuse to create malware, exploits, credential stealers, or any code that is clearly abusive or illegal.
- Prefer clear structure and readability.
- Always return **complete, runnable code** for each file you output: include imports, exports, entrypoints, and any required helper functions. Do not leave "..." placeholders or comments like "you can fill in the rest".
- If the full implementation would be very large, produce the **smallest fully working version** instead of a long but incomplete snippet.
- If the request is ambiguous, make reasonable assumptions and state them briefly.
- When the solution naturally involves multiple files or pieces (for example backend + frontend, or several modules), produce multiple markdown code blocks, one per file or major part.
- After the code blocks, include a short explanation of how the pieces fit together and how to run or use them.`;

    let extraContext = '';
    if (language) extraContext += `\nTarget language: ${language}.`;
    if (framework) extraContext += `\nPreferred frameworks/libraries: ${framework}.`;
    if (style) extraContext += `\nStyle or constraints: ${style}.`;

    const userContent = `User request:\n${prompt}${extraContext}\n\nIf the request would clearly create malware or abusive/illegal functionality, explain why you cannot provide that code instead of generating it.`;

    const messages = [
      { role: 'system', content: systemContent },
      { role: 'user', content: userContent }
    ];

    const result = await chat(messages, { provider: usedProvider, temperature });

    res.json({
      prompt,
      providerUsed: usedProvider,
      result
    });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.get('/api/notes', async (req, res) => {
  try {
    const notes = await notesStore.list();
    res.json({ notes });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.post('/api/realtime/offer', async (req, res) => {
  try {
    if (isOffline()) {
      res.status(400).json({ error: 'Realtime is disabled in OFFLINE_MODE.' });
      return;
    }
    const apiKey = process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      res.status(400).json({ error: 'Realtime requires OPENAI_API_KEY (or OPENROUTER_API_KEY not supported here).' });
      return;
    }
    const sdp = (req.body && req.body.sdp) || '';
    const model = (req.body && req.body.model) || process.env.REALTIME_MODEL || 'gpt-realtime';
    if (!sdp) {
      res.status(400).json({ error: 'Missing sdp' });
      return;
    }
    const form = new FormData();
    form.append('sdp', sdp);
    form.append('session', JSON.stringify({ type: 'realtime', model }));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    const resp = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      res.status(resp.status).send(txt || 'Upstream error');
      return;
    }
    const answerSdp = await resp.text();
    res.json({ sdp: answerSdp });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.post('/api/notes', async (req, res) => {
  try {
    const text = (req.body && req.body.text) || '';
    const note = await notesStore.add(text);
    res.status(201).json(note);
  } catch (e) {
    res.status(400).json({ error: e.message || String(e) });
  }
});

app.post('/api/research', async (req, res) => {
  try {
    const body = req.body || {};
    const query = (body.query || '').toString().trim();
    if (!query) {
      res.status(400).json({ error: 'query is required' });
      return;
    }
    const detail = (body.detail || 'deep').toString().toLowerCase();
    let usedProvider = (body.provider || getProvider()).toString().toLowerCase();
    if (!usedProvider || usedProvider === 'none') {
      // Auto-fallback to local Ollama if reachable
      if (await probeLocalOllama(600)) {
        usedProvider = 'ollama';
      }
    }
    let maxSources = Math.min(Math.max(parseInt(body.maxSources || 5, 10) || 5, 1), 8);
    if (detail === 'deep' && maxSources < 7) maxSources = Math.min(8, maxSources + 2);
    if (detail === 'brief' && maxSources > 4) maxSources = Math.max(2, maxSources - 2);

    let results = await webSearch(query, { num: maxSources });
    if (!Array.isArray(results)) results = [];
    results = results.slice(0, maxSources);

    const pages = await Promise.all(results.map((r) => fetchAndExtract(r.url)));
    const sources = pages
      .map((p, idx) => ({
        id: idx + 1,
        url: p.url,
        title: p.title || (results[idx] && results[idx].title) || p.url,
        length: p.length || 0,
        snippet: (p.text || '').slice(0, 500)
      }))
      .filter((s) => s.length > 50);

    const notes = await notesStore.list();
    const recentNotes = notes.slice(0, 5);

    const sourcesText = sources
      .map((s) => ` [${s.id}] ${s.title} - ${s.url}\n   Excerpt: ${s.snippet}`)
      .join('\n');
    const notesText = recentNotes.map((n, i) => ` (${i + 1}) ${n.text}`).join('\n');

    const systemContent = `You are an expert research analyst with deep reasoning capabilities. Your task:
- Synthesize Web Sources and Local Notes into a coherent, evidence-based answer.
- Think step-by-step: identify the core question, evaluate evidence quality, resolve conflicts, and draw logical conclusions.
- Cite sources inline like [1], [2]. Always indicate confidence levels and any assumptions.
- If evidence is weak or conflicting, explicitly state limitations and suggest what additional evidence would strengthen conclusions.
- Never invent sources or extrapolate beyond the provided data.
- Use structured formatting (sections, bullet points) and LaTeX for formulas where appropriate.`;
    let detailInstr = '';
    switch (detail) {
      case 'brief':
        detailInstr = 'Output: 3-4 tightly focused bullet points with key evidence, plus a one-sentence takeaway. Include confidence level (high/medium/low).';
        break;
      case 'standard':
        detailInstr = 'Output: 6-8 bullet points, a 2-3 paragraph synthesis, and any relevant formulas. Highlight uncertainties and suggest further research if needed.';
        break;
      default:
        detailInstr = 'Output: A comprehensive brief with sections: Executive Summary, Background, Evidence (with key numbers/dates), Analysis/Mechanisms, Counterpoints/Limitations, Implications/Recommendations, and References. Provide 10-14 bullet points, 3-4 paragraphs of synthesis, and confidence assessments. Use LaTeX for formulas. End with actionable next steps or open questions.';
        break;
    }
    const userContent = `Query: ${query}\n\nDetail: ${detail}\n\nLocal Notes:\n${notesText || 'None'}\n\nWeb Sources:\n${sourcesText || 'None available'}\n\nWrite an evidence-based answer with citations [n]. ${detailInstr}`;

    const messages = [
      { role: 'system', content: systemContent },
      { role: 'user', content: userContent }
    ];

    const temperature = detail === 'brief' ? 0.15 : detail === 'deep' ? 0.3 : 0.25;
    const answer = await chat(messages, { provider: usedProvider, temperature });

    res.json({
      query,
      providerUsed: usedProvider,
      sources: sources.map(({ id, title, url }) => ({ id, title, url })),
      answer
    });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.post('/api/file-analyze', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file || !file.buffer) {
      res.status(400).json({ error: 'file is required' });
      return;
    }

    const originalName = file.originalname || 'uploaded-file';
    const mime = file.mimetype || 'application/octet-stream';
    const buf = file.buffer;

    let text = '';
    let extractionSource = 'raw-text';

    try {
      if (mime.startsWith('image/')) {
        // Use OCR for images so screenshots/pictures of questions can be solved.
        extractionSource = 'ocr-image';
        text = await extractTextFromImage(buf, mime);
      } else {
        text = buf.toString('utf8');
      }
    } catch (e) {
      res.status(400).json({ error: `Failed to extract text from file: ${e.message || String(e)}` });
      return;
    }

    if (!text || !text.trim()) {
      res.status(400).json({ error: 'Could not extract any text from the file.' });
      return;
    }

    const originalCharCount = text.length;
    const maxChars = 16000;
    let truncated = false;
    if (text.length > maxChars) {
      text = text.slice(0, maxChars);
      truncated = true;
    }

    const rawMode = (req.body && req.body.mode) || 'summary';
    const modeValue = String(rawMode).toLowerCase();
    let mode;
    if (modeValue === 'analysis') {
      mode = 'analysis';
    } else if (modeValue === 'solve' || modeValue === 'solver' || modeValue === 'qa' || modeValue === 'question') {
      mode = 'solve';
    } else if (modeValue === 'custom') {
      mode = 'custom';
    } else {
      mode = 'summary';
    }

    const rawInstruction = (req.body && req.body.instruction) || '';
    const instruction = String(rawInstruction || '').trim();
    if (mode === 'custom') {
      if (!instruction) {
        res.status(400).json({ error: 'instruction is required for custom mode' });
        return;
      }
      if (instruction.length > 800) {
        res.status(400).json({ error: 'instruction is too long (max 800 characters)' });
        return;
      }
    }

    let usedProvider = (req.body && req.body.provider) || getProvider();
    usedProvider = (usedProvider || '').toString().toLowerCase();
    if (!usedProvider || usedProvider === 'none') {
      if (await probeLocalOllama(600)) {
        usedProvider = 'ollama';
      }
    }

    let systemContent;
    if (mode === 'solve') {
      systemContent =
        `You are an expert problem solver with deep reasoning capabilities. You receive the raw text of a file containing questions, exercises, or problems.
- Identify every explicit question and solve it step-by-step.
- If a question is ambiguous, state assumptions clearly before solving.
- Show reasoning, calculations, and mark final answers clearly with "Answer:".
- For multi-part questions, address each part separately.
- If no clear questions exist, explain why and briefly summarize the document's purpose.
- Use structured formatting (lists, headings) for clarity.`;
    } else if (mode === 'custom') {
      systemContent =
        `You are an expert document analyst. You will follow the user's instruction to process the provided document text.
- Follow the instruction exactly as requested, as long as it is safe and legal.
- If the instruction is ambiguous, ask a brief clarifying question and then provide your best-effort output with stated assumptions.
- If the instruction cannot be fully satisfied from the document content, explain what is missing.
- Use clear formatting (sections, bullet points) for readability.`;
    } else {
      systemContent =
        `You are an expert document analyst with advanced comprehension. You receive the raw text of a file.
- Provide a structured response based on the requested mode (summary or analysis).
- For summaries: distill key ideas, context, and implications.
- For analysis: evaluate structure, arguments, data quality, and significance.
- Note any ambiguities, gaps, or limitations in the provided text.
- Use clear formatting (sections, bullet points) for readability.`;
    }

    let detailInstr;
    if (mode === 'summary') {
      detailInstr =
        'Provide a concise yet comprehensive summary: 6-10 bullet points highlighting core ideas, context, and implications, plus a 2-3 paragraph synthesis. Note any limitations in the source text.';
    } else if (mode === 'analysis') {
      detailInstr =
        'Deliver an in-depth analysis with sections: Executive Summary, Context/Background, Structure/Arguments, Data/Evidence Evaluation, Critical Assessment, Implications/Recommendations, and Limitations. Use 10-14 bullet points and 3-4 paragraphs of synthesis. Include confidence levels for key claims.';
    } else if (mode === 'custom') {
      detailInstr = `User instruction: ${instruction}`;
    } else {
      detailInstr =
        'Solve every identifiable question step-by-step: (1) restate the question clearly, (2) outline approach/assumptions, (3) show detailed reasoning or calculations, (4) provide a clearly marked "Answer:" for each part. For multi-part questions, address each sub-part. If no clear questions exist, explain why and briefly summarize the document’s apparent purpose.';
    }

    const userContent =
      `Mode: ${mode}\n` +
      `Filename: ${originalName}\n` +
      `MIME type: ${mime}\n` +
      `Extraction source: ${extractionSource}\n` +
      (truncated
        ? `Note: The document text has been truncated to the first ${maxChars} characters for processing.\n`
        : '') +
      `\nDocument text:\n` +
      text;

    const messages = [
      { role: 'system', content: systemContent },
      { role: 'user', content: `${detailInstr}\n\n${userContent}` }
    ];

    const temperature = mode === 'summary' ? 0.2 : mode === 'analysis' ? 0.3 : 0.25;
    const answer = await chat(messages, { provider: usedProvider, temperature });

    res.json({
      filename: originalName,
      mode,
      providerUsed: usedProvider,
      truncated,
      originalCharCount,
      usedCharCount: text.length,
      answer
    });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.post('/api/chat', async (req, res) => {
  try {
    const body = req.body || {};
    let messages = Array.isArray(body.messages) ? body.messages : [];
    const userText = typeof body.content === 'string' ? body.content.trim() : '';
    if ((!messages || messages.length === 0) && userText) {
      messages = [{ role: 'user', content: userText }];
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: 'messages[] or content is required' });
      return;
    }
    // sanitize roles/content
    messages = messages
      .filter(m => m && (m.role === 'user' || m.role === 'assistant' || m.role === 'system') && typeof m.content === 'string')
      .map(m => ({ role: m.role, content: m.content }));

    // Insert a smarter system prompt if none provided
    if (!messages.some(m => m.role === 'system')) {
      messages.unshift({
        role: 'system',
        content: `You are a highly capable AI assistant with deep reasoning and broad knowledge. Your goal is to provide clear, accurate, and thoughtful responses.
- Think step-by-step for complex questions.
- When uncertain, state confidence levels and explain reasoning.
- Use structured formatting (lists, headings) for clarity.
- Provide context and background when helpful.
- If a question is ambiguous, ask for clarification.
- For technical topics, include relevant details and caveats.`
      });
    }

    let usedProvider = (body.provider || getProvider()).toString().toLowerCase();
    if (!usedProvider || usedProvider === 'none') {
      if (await probeLocalOllama(600)) usedProvider = 'ollama';
    }
    const temperature = typeof body.temperature === 'number' ? body.temperature : 0.3;

    const reply = await chat(messages, { provider: usedProvider, temperature });
    res.json({ reply, providerUsed: usedProvider });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.post('/api/debate', async (req, res) => {
  console.log('[DEBUG] Debate endpoint called');
  try {
    const { topic, format, provider, detail } = req.body;
    console.log('[DEBUG] Debate request data:', { topic, format, provider, detail });
    
    if (!topic || typeof topic !== 'string') {
      console.log('[DEBUG] Debate validation failed: missing topic');
      return res.status(400).json({ error: 'Topic is required' });
    }

    let usedProvider = (provider || getProvider()).toString().toLowerCase();
    if (!usedProvider || usedProvider === 'none') {
      if (await probeLocalOllama(600)) usedProvider = 'ollama';
    }
    console.log('[DEBUG] Debate using provider:', usedProvider);

    const detailInstructions = {
      brief: 'Provide a concise debate with 2-3 main points per side.',
      standard: 'Provide a well-structured debate with 3-4 main points per side and supporting evidence.',
      deep: 'Provide a comprehensive debate with 4-5 main points per side, detailed evidence, counterarguments, and rebuttals.'
    };

    const formatInstructions = {
      pro_con: 'Structure as a clear Pro vs Con debate with opening statements, main arguments, and conclusions.',
      multiple: 'Include multiple perspectives (at least 3 different viewpoints) with their respective arguments.',
      formal: 'Follow formal debate structure with opening statements, cross-examination, rebuttals, and closing statements.'
    };

    const structureByFormat = {
      pro_con: {
        headings: [
          'MOTION:',
          'PRO - OPENING STATEMENT',
          'CON - OPENING STATEMENT',
          'PRO - MAIN ARGUMENTS',
          'CON - MAIN ARGUMENTS',
          'PRO - REBUTTAL',
          'CON - REBUTTAL',
          'PRO - CLOSING STATEMENT',
          'CON - CLOSING STATEMENT'
        ],
        checklist: [
          'Use clear speaker labels and keep each section focused.',
          'Each side should provide at least 3 arguments in their MAIN ARGUMENTS section.',
          'Rebuttals must directly address the other side\'s arguments (not new unrelated points).'
        ]
      },
      multiple: {
        headings: [
          'MOTION:',
          'PERSPECTIVE 1 (FOR)',
          'PERSPECTIVE 2 (AGAINST)',
          'PERSPECTIVE 3 (NUANCED)',
          'POINTS OF AGREEMENT',
          'KEY DISAGREEMENTS',
          'CONCLUSION'
        ],
        checklist: [
          'Provide at least 3 clearly distinct perspectives.',
          'Each perspective must include a brief position + 2-3 supporting arguments.',
          'Summarize shared ground and key disagreements at the end.'
        ]
      },
      formal: {
        headings: [
          'MOTION:',
          'OPENING STATEMENTS',
          'CROSS-EXAMINATION',
          'REBUTTALS',
          'CLOSING STATEMENTS',
          'JUDGE\'S VERDICT'
        ],
        checklist: [
          'Include both PRO and CON inside each major section (openings, cross-exam, rebuttals, closings).',
          'Cross-examination should be short Q/A exchanges (at least 3 questions per side).',
          'Verdict must justify the decision based on argument quality and evidence.'
        ]
      }
    };

    const systemPrompt = `You are an expert debate moderator and analyst. Generate a balanced, well-structured debate on the given topic. Ensure equal representation of different viewpoints and use logical reasoning with supporting evidence where applicable.`;

    const selectedStructure = structureByFormat[format] || structureByFormat.pro_con;
    const requiredHeadings = selectedStructure.headings.join('\n');
    const requiredChecklist = selectedStructure.checklist.map(c => `- ${c}`).join('\n');

    const userPrompt = `Create a debate for the following motion:
"${topic}"

Detail level:
${detailInstructions[detail] || detailInstructions.standard}

Debate format:
${formatInstructions[format] || formatInstructions.pro_con}

Structure requirements (do not skip any section; do not print this list as bullets):
${requiredHeadings}

Checklist (must satisfy all; do not include the checklist in your output):
${requiredChecklist}

Formatting rules:
- Write each heading exactly as shown above.
- For the MOTION heading, write: "MOTION: <the motion>".
- Use blank lines between paragraphs and between sections.
- Do not use markdown symbols like # or **.
- Do not output bullet lists; write paragraphs under each heading.
`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    console.log('[DEBUG] Debate messages prepared, calling LLM');
    const temperature = 0.3;
    const debate = await chat(messages, { provider: usedProvider, temperature });
    console.log('[DEBUG] Debate generated successfully');

    res.json({ debate, providerUsed: usedProvider });
  } catch (e) {
    console.error('[DEBUG] Debate endpoint error:', e);
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.post('/api/essay', async (req, res) => {
  console.log('[DEBUG] Essay endpoint called');
  try {
    const { topic, essayType, wordCount, academicLevel, provider, tone } = req.body;
    console.log('[DEBUG] Essay request data:', { topic, essayType, wordCount, academicLevel, provider, tone });
    
    if (!topic || typeof topic !== 'string') {
      console.log('[DEBUG] Essay validation failed: missing topic');
      return res.status(400).json({ error: 'Topic is required' });
    }

    let usedProvider = (provider || getProvider()).toString().toLowerCase();
    if (!usedProvider || usedProvider === 'none') {
      if (await probeLocalOllama(600)) usedProvider = 'ollama';
    }
    console.log('[DEBUG] Essay using provider:', usedProvider);

    const typeInstructions = {
      argumentative: 'Present a clear thesis statement and support it with logical reasoning and evidence.',
      expository: 'Provide comprehensive information and explanation on the topic with clear organization.',
      narrative: 'Tell a compelling story or narrative that engages the reader while addressing the topic.',
      descriptive: 'Use vivid descriptions and sensory details to create a clear picture of the topic.',
      formal_letter: 'Write a formal letter with professional tone, clear purpose, and appropriate formatting.',
      informal_letter: 'Write an informal letter with a friendly tone, natural phrasing, and appropriate formatting.',
      compare_contrast: 'Compare and contrast different aspects of the topic with clear similarities and differences.',
      cause_effect: 'Analyze the causes and effects related to the topic with clear causal relationships.'
    };

    const structureInstructions = {
      argumentative: {
        headings: [
          'INTRODUCTION (THESIS)',
          'ARGUMENT 1',
          'ARGUMENT 2',
          'COUNTERARGUMENT AND REBUTTAL',
          'CONCLUSION'
        ],
        checklist: [
          'State a clear, specific thesis in the introduction.',
          'Use evidence/examples in each argument.',
          'Include at least one counterargument and a direct rebuttal.',
          'End with a conclusion that restates the thesis and summarizes the arguments.'
        ]
      },
      expository: {
        headings: [
          'INTRODUCTION',
          'EXPLANATION',
          'EXAMPLES',
          'CONCLUSION'
        ],
        checklist: [
          'Define key terms and provide clear explanations.',
          'Use organized paragraphs with topic sentences.',
          'Include concrete examples or evidence.',
          'Conclude by summarizing the main explanation.'
        ]
      },
      narrative: {
        headings: [
          'INTRODUCTION',
          'SETTING AND CHARACTERS',
          'CONFLICT',
          'CLIMAX',
          'RESOLUTION',
          'REFLECTION'
        ],
        checklist: [
          'Keep a clear plot arc (conflict → climax → resolution).',
          'Use descriptive details and character actions/dialogue.',
          'End with a brief reflection that ties back to the topic.'
        ]
      },
      descriptive: {
        headings: [
          'INTRODUCTION',
          'DESCRIPTION',
          'KEY DETAILS',
          'CONCLUSION'
        ],
        checklist: [
          'Use sensory details (sight, sound, smell, touch, taste where relevant).',
          'Organize details logically (spatially or by importance).',
          'Conclude with an overall impression/summary.'
        ]
      },
      compare_contrast: {
        headings: [
          'INTRODUCTION',
          'SIMILARITIES',
          'DIFFERENCES',
          'CONCLUSION'
        ],
        checklist: [
          'Include at least 2-3 meaningful similarities and differences.',
          'Use clear transitions (however, similarly, in contrast).',
          'Conclude with what the comparison shows/means.'
        ]
      },
      cause_effect: {
        headings: [
          'INTRODUCTION',
          'CAUSES',
          'EFFECTS',
          'CONCLUSION'
        ],
        checklist: [
          'Explain multiple causes and multiple effects (not just one).',
          'Use clear causal language (leads to, results in, contributes to).',
          'Conclude by summarizing the main causal chain.'
        ]
      }
    };

    const levelInstructions = {
      high_school: 'Use clear, accessible language appropriate for high school level.',
      college: 'Use academic language with proper structure and critical thinking appropriate for college level.',
      university: 'Demonstrate advanced critical thinking, research integration, and sophisticated analysis.',
      graduate: 'Show expert-level analysis, original insights, and comprehensive literature integration.'
    };

    const toneInstructions = {
      formal: 'Maintain a formal, academic tone throughout the essay.',
      informal: 'Use a more conversational and accessible tone while maintaining clarity.',
      persuasive: 'Use persuasive language and rhetorical devices to convince the reader.',
      neutral: 'Maintain an objective, unbiased tone presenting multiple viewpoints.'
    };

    const letterToneInstructions = {
      formal: 'Maintain a formal, professional tone throughout the letter.',
      informal: 'Use a warm, friendly tone throughout the letter.',
      persuasive: 'Use polite but persuasive language appropriate for a letter.',
      neutral: 'Maintain a neutral, respectful tone throughout the letter.'
    };

    const wordCountTarget = parseInt(wordCount) || 500;
    
    const systemPrompt = `You are an expert writer. Generate well-structured writing that matches the requested format (essay or letter) and the specified requirements.`;

    const isLetter = essayType === 'formal_letter' || essayType === 'informal_letter';

    const selectedStructure = structureInstructions[essayType] || structureInstructions.expository;
    const requiredHeadings = (selectedStructure && Array.isArray(selectedStructure.headings))
      ? selectedStructure.headings.join('\n')
      : '';
    const requiredChecklist = (selectedStructure && Array.isArray(selectedStructure.checklist))
      ? selectedStructure.checklist.map(c => `- ${c}`).join('\n')
      : '';

    const userPrompt = isLetter
      ? `Write a ${essayType === 'formal_letter' ? 'formal' : 'informal'} letter about: "${topic}"

Requirements:
- Target length: approximately ${wordCountTarget} words
- Style: ${typeInstructions[essayType]}
- Tone: ${letterToneInstructions[tone] || (essayType === 'formal_letter' ? letterToneInstructions.formal : letterToneInstructions.informal)}

Format the letter with:
${essayType === 'formal_letter'
  ? `- Sender address block (use placeholders if not provided, e.g. "[Your Name]", "[Street Address]", "[City, Postcode]")
- Date line
- Recipient address block (use placeholders if not provided, e.g. "[Recipient Name]", "[Company/School]", "[Street Address]", "[City, Postcode]")
- Subject line (e.g. "Subject: ...")
- Formal greeting (e.g. "Dear ...,")
- Body in multiple paragraphs (use blank lines between paragraphs)
- Formal closing/sign-off (e.g. "Yours sincerely,")
- Signature name (use a generic name like "[Your Name]")`
  : `- Date line
- Greeting (appropriate to the formality)
- Body in multiple paragraphs (use blank lines between paragraphs)
- Closing/sign-off (appropriate to the formality)
- Signature name (use a generic name like "[Your Name]")`}

Do not write an essay structure (no thesis/introduction/conclusion headings).`
      : `Write an ${essayType || 'expository'} essay on the topic: "${topic}"

Requirements:
- Target word count: approximately ${wordCountTarget} words
- Academic level: ${levelInstructions[academicLevel] || levelInstructions.college}
- Essay type: ${typeInstructions[essayType] || typeInstructions.expository}
- Tone: ${toneInstructions[tone] || toneInstructions.formal}

Structure requirements (do not skip any section; do not print this list as bullets):
${requiredHeadings}

Checklist (must satisfy all; do not include the checklist in your output):
${requiredChecklist}

Formatting rules:
- Write each heading on its own line.
- Use blank lines between paragraphs.
- Do not include any meta commentary (only the essay text).
 - Do not output bullet lists; write paragraphs under each heading.

Write the essay following the structure requirements above.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    console.log('[DEBUG] Essay messages prepared, calling LLM');
    const temperature = isLetter ? 0.4 : 0.25;
    const essay = await chat(messages, { provider: usedProvider, temperature });
    console.log('[DEBUG] Essay generated successfully');

    res.json({ essay, providerUsed: usedProvider });
  } catch (e) {
    console.error('[DEBUG] Essay endpoint error:', e);
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.post('/api/voice', async (req, res) => {
  console.log('[DEBUG] Voice endpoint called');
  try {
    const { message, provider, conversation } = req.body;
    console.log('[DEBUG] Voice request data:', { message, provider, conversationLength: conversation?.length });
    
    if (!message || typeof message !== 'string') {
      console.log('[DEBUG] Voice validation failed: missing message');
      return res.status(400).json({ error: 'Message is required' });
    }

    let usedProvider = (provider || getProvider()).toString().toLowerCase();
    if (!usedProvider || usedProvider === 'none') {
      if (await probeLocalOllama(600)) usedProvider = 'ollama';
    }
    console.log('[DEBUG] Voice using provider:', usedProvider);

    // Build conversation context
    let messages = [];
    
    // System prompt for voice assistant
    messages.push({
      role: 'system',
      content: `You are a friendly, natural-sounding conversational partner speaking out loud.

Speak like a real person:
- Use contractions and everyday wording.
- Be warm and relaxed (not formal).
- It’s okay to use a tiny bit of natural filler sometimes (like “yeah”, “gotcha”, “hmm”), but don’t overdo it.

Output rules for voice:
- Keep replies short: usually 1–2 sentences. Only go longer if the user asks.
- No lists, no headings, no markdown, no emojis.
- Don’t say “as an AI” or mention policies.
- Mirror the user's vibe (more upbeat if they’re upbeat, calm if they’re calm).
- If it helps, ask one quick follow-up question.

If the user asks for something long (code/essay/debate), give a brief spoken summary and offer to show the full details on screen.`
    });

    // Add conversation history if provided
    if (Array.isArray(conversation) && conversation.length > 0) {
      messages.push(...conversation);
      console.log('[DEBUG] Voice conversation history added:', conversation.length, 'messages');
    }

    // Add current message
    messages.push({ role: 'user', content: message });

    console.log('[DEBUG] Voice messages prepared, calling LLM');
    const temperature = 0.5;
    const response = await chat(messages, { provider: usedProvider, temperature });
    console.log('[DEBUG] Voice response generated successfully');

    res.json({ response, providerUsed: usedProvider });
  } catch (e) {
    console.error('[DEBUG] Voice endpoint error:', e);
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.listen(port, () => {
  console.log(`uiy_31 listening on http://localhost:${port}`);
});
