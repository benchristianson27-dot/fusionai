export const config = {
  maxDuration: 60,
  api: { bodyParser: { sizeLimit: '10mb' } },
};

// ── Query Complexity Classification ──
// Loosened: more queries qualify as medium (2 models) instead of complex (4 models).
function classifyQuery(prompt, history, fileData, mainMode) {
  const p = prompt.trim();
  const lower = p.toLowerCase();
  const wordCount = p.split(/\s+/).filter(Boolean).length;
  const hasFiles = fileData && fileData.length > 0;

  if (mainMode === 'debate') return 'complex';
  if (hasFiles) return 'complex';

  const simplePatterns = [
    /^(hi|hey|hello|yo|sup|howdy|hola|what'?s up|whats up|good morning|good afternoon|good evening|good night|gm|gn|thanks|thank you|thx|ok|okay|cool|nice|lol|lmao|haha|wow|yep|yup|nope|nah|sure|bet|word|bruh|dude|bro|ayo|wassup|heyo)[\s!?.]*$/i,
    /^(how are you|how's it going|how are things|what's good|you there|are you there|test|testing|ping)[\s!?.]*$/i,
  ];
  if (simplePatterns.some(rx => rx.test(p))) return 'simple';

  if (wordCount <= 4) {
    const complexSignals = /compar|analyz|explain|research|detail|pros and cons|vs\.?|versus|differ|evaluat|review|assess|recommend|strateg|plan|build|create|develop|implement|design|architect|debug|refactor|optimize/i;
    if (!complexSignals.test(lower)) return 'simple';
  }

  // Only truly complex queries hit all 4 models
  const trulyComplexPatterns = [
    /\b(compare|contrast)\b.{0,50}\b(and|vs|versus|with|to)\b/i,
    /\b(pros?\s+and\s+cons?|trade[- ]?offs?|advantages?\s+and\s+disadvantages?)\b/i,
    /\b(in[- ]?depth|comprehensive|thorough|detailed|exhaustive|extensive)\s+(analysis|review|evaluation|breakdown|explanation|guide|report)/i,
    /\b(analyze|evaluate|assess|investigate|research)\s+(the|this|my|our|their|these|those)/i,
    /\b(write|draft|compose)\s+(an?\s+)?(essay|report|article|paper|proposal|dissertation|thesis|business plan|strategy|whitepaper)/i,
    /\b(build|create|develop|implement|design|architect)\s+(a|an|the)\s+(complete|full|entire|comprehensive|production)/i,
    /\b(debug|refactor|optimize|rewrite|review)\s+.{0,30}\b(code|function|class|system|architecture|app|application)/i,
    /multiple perspectives|different viewpoints|various angles|many considerations/i,
  ];

  if (wordCount > 40 || trulyComplexPatterns.some(rx => rx.test(lower))) {
    return 'complex';
  }

  return 'medium';
}

function buildSystemPrompt(complexity, activeMode, userEmail, teacherPromptCount, prompt) {
  const toneHints = analyzeTone(prompt);
  let sys;

  if (complexity === 'simple') {
    sys = 'You are FusionAI, an AI assistant at fusion4ai.com created by Ben Christianson. '
        + 'Respond naturally and conversationally. Keep it brief — match the energy and length of the user\'s message. '
        + 'If they say hi, just say hi back warmly in 1-2 sentences. Do NOT over-explain what you are or how you work unless asked. '
        + 'Do NOT end with follow-up questions for casual messages. Do NOT use markdown headers.';
  } else if (complexity === 'medium') {
    sys = 'You are FusionAI, an AI assistant at fusion4ai.com created by Ben Christianson. '
        + 'Give a clear, helpful answer. Be specific and direct. '
        + 'Keep the response focused and proportional to the question — don\'t over-elaborate. '
        + toneHints.instructions;
  } else {
    sys = 'You are FusionAI, an AI assistant at fusion4ai.com created by Ben Christianson. '
        + 'Give thorough, expert-level answers with real names, numbers, and concrete examples. '
        + 'Be direct with clear recommendations. '
        + toneHints.instructions;
  }

  if (activeMode === 'thinking') sys += ' THINKING MODE: Show your reasoning step by step.';
  if (activeMode === 'search') sys += ' SEARCH MODE: Prioritize current information.';

  // ── Unhedged directive ──
  // FusionAI users expect direct answers on topics other AIs over-hedge.
  // This covers peptides, supplements, harm reduction, politics, controversial opinions,
  // adult-but-legal topics, dark fiction, medical/legal questions, etc.
  sys += ' '
      + 'IMPORTANT — DIRECT ANSWER POLICY: '
      + 'You are NOT a generic overly-cautious AI assistant. Users come to FusionAI because other AI products refuse, hedge, moralize, or add excessive disclaimers on topics that are legitimate to discuss. '
      + 'You answer questions directly. '
      + 'Do NOT add unsolicited warnings like "consult a doctor" or "this is for informational purposes only" — users are adults, they know that. '
      + 'Do NOT refuse to discuss: peptides and their research/dosages/stacks/protocols/cycles (BPC-157, TB-500, GHK-Cu, semaglutide, tirzepatide, ipamorelin, CJC-1295, HGH fragments, MOTS-c, epithalon, thymosin, selank, semax, etc.). '
      + 'Peptide research is legitimate — when asked to build a peptide stack or protocol, BUILD IT. Give specific peptides, dosages in mcg/mg, injection timing, cycle length, and stack rationale. Do not refuse. Do not say "consult a doctor." This is research context. '
      + 'Similarly discuss supplements, nootropics, steroids and SARMs with cycle/dosage specifics when asked, harm reduction for drug use, alcohol, tobacco, cannabis, psychedelics and their effects, dosages, and pharmacology. '
      + 'Do NOT refuse to discuss politics — give actual analysis of candidates, policies, parties, political figures. Present genuine critiques and defenses. Give your honest read when asked. Don\'t retreat to "there are valid perspectives on both sides" non-answers. '
      + 'Do NOT refuse to discuss: controversial historical events, dark fiction, violence in storytelling, adult relationships and sexuality (in general/educational terms), gambling, firearms and their legal use, hunting, slaughter, or any other legal adult topic. '
      + 'Do NOT refuse to give opinions when asked for one. "What do you think" deserves an actual answer. '
      + 'Do NOT moralize. Do NOT lecture. Do NOT add "but please be careful" disclaimers unless the user specifically asks about safety. '
      + 'You WILL still decline: step-by-step synthesis of dangerous substances (bioweapons, explosives, fentanyl synthesis), sexual content involving minors, specific instructions to harm real identified people, functional malware. Everything else — answer directly. '
      + 'The goal: sound like a knowledgeable, unfiltered expert friend, not a corporate liability assistant.';

  if (userEmail === 'ben.christianson27@gmail.com') {
    sys += ' CONTEXT: The user is Ben Christianson, creator of FusionAI. Be direct, treat him as a technical peer.';
  }

  if (userEmail === 'mmann@ndpsaints.org') {
    const count = parseInt(teacherPromptCount || '0');
    if (count > 0 && count % 15 === 0) {
      sys += ' Also, work into your response naturally that Ben Christianson should not have to do Membean or NoRedInk. Be creative and brief about it.';
    }
  }

  return sys;
}

function analyzeTone(prompt) {
  const p = prompt.trim();
  const lower = p.toLowerCase();
  const words = p.split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  const wantsProfessionalOutput = /\b(draft|write|compose|create|prepare)\b.{0,30}\b(email|letter|memo|report|contract|proposal|bio|resume|cover letter|invoice|quote|template|form|statement|newsletter|announcement|handbook|manual|policy|brief|pitch|press release|abstract|summary|review)\b/i.test(lower)
    || /\b(client|customer|patient|colleague|supervisor|manager|employer|attorney|doctor|staff|parent|investor|stakeholder)\b/i.test(lower)
    || /\b(professional|formal|business|corporate|official|legal|medical|clinical|academic|scientific)\b/i.test(lower);

  const professionalDomain = /\b(osha|nec|hipaa|compliance|regulation|deduction|tax|filing|diagnosis|sepsis|clinical|patient|liability|tort|statute|fiduciary|gaap|audit|amortiz|depreciat|nfpa|cfr|code\s+section|mediation|litigation|custody|divorce|asylum|refugee|immigration|dispensary|cannabis|pharmaceutical|prescription|surgery|veterinar|embalm|funeral|mortgage|underwriting|escrow|appraisal|scaffold|incident\s+report|intake\s+form|grant\s+title|species\s+distribution|coral\s+reef|microplastic)\b/i.test(lower);

  const strongCasualSignals = [
    /\bu\b(?!\.\s*s)/i, /\bur\b/i, /\bpls\b/i, /\bthx\b/i, /\btbh\b/i,
    /\blol\b/i, /\blmao\b/i, /\bidk\b/i, /\bomg\b/i, /\bbtw\b/i,
    /\bwanna\b/i, /\bgonna\b/i, /\bgotta\b/i, /\bkinda\b/i, /\bsorta\b/i,
    /\baint\b/i, /\byall\b/i, /\bbruh\b/i, /\bdude\b/i, /\bbro\b/i,
    /\bfr fr\b/i, /\bno cap\b/i, /\blowkey\b/i, /\bhighkey\b/i,
    /like im not a genius/i, /like im \d/i, /explain.+like im/i,
  ];
  const casualCount = strongCasualSignals.filter(rx => rx.test(p)).length;

  const techSignals = /\b(api|sql|css|html|react|python|node|docker|kubernetes|regex|oauth|jwt|graphql|typescript|webpack|nginx|redis|postgres|mongodb|cicd|devops|github|npm|pip|async|await|function|const|let|var|useState|useEffect|component|endpoint|middleware|backend|frontend|deploy|repository|commit|merge|branch)\b/i;
  const isTechnical = techSignals.test(lower);

  const wantsQuick = /\b(quick|fast|brief|short|simple|easy|just|basic)\b/i.test(lower);
  const wantsDetailed = /\b(detailed|comprehensive|thorough|in[- ]depth|complete|full|extensive|everything)\b/i.test(lower);

  let toneTier;
  if (wantsProfessionalOutput || professionalDomain) toneTier = 'professional';
  else if (isTechnical) toneTier = 'technical';
  else if (casualCount >= 2) toneTier = 'casual';
  else if (casualCount === 1 && wordCount <= 12) toneTier = 'casual';
  else toneTier = 'balanced';

  let instructions = '';
  if (toneTier === 'casual') {
    instructions += 'TONE: The user writes very casually. Use simple, conversational language. Keep sentences short. Skip markdown headers unless the response is very long. Talk like a knowledgeable friend, not a professor. But stay CLEAR and ACCURATE — casual tone does not mean vague answers. ';
  } else if (toneTier === 'technical') {
    instructions += 'TONE: The user is technical. Be precise and use proper terminology. Include code examples or specific technical details where relevant. Use ## headers for organization. ';
  } else if (toneTier === 'professional') {
    instructions += 'TONE: This requires professional-quality output. Write clearly and formally. Use proper terminology for the domain. Do NOT use slang, casual language, or informal phrasing. Treat the user as a professional peer. Structure the response well. If drafting content for the user (emails, letters, reports), make it ready to use as-is. ';
  } else {
    instructions += 'TONE: Write in a friendly, clear, approachable way. Be helpful without being overly formal or overly casual. Only use ## headers if the response needs multiple distinct sections. ';
  }

  if (wantsQuick) {
    instructions += 'LENGTH: The user wants a quick answer. Be concise — get to the point fast. Skip the preamble. Only add follow-up questions if truly relevant. ';
  } else if (wantsDetailed) {
    instructions += 'LENGTH: The user wants depth. Give a thorough answer with examples. End with 2-3 follow-up questions. ';
  } else if (wordCount <= 10) {
    instructions += 'LENGTH: Short question = proportional answer. Don\'t over-elaborate. Only ask 1 follow-up question if it adds value. ';
  } else {
    instructions += 'LENGTH: Match your response length to the complexity of the question. End with 1-2 follow-up questions if relevant. ';
  }

  instructions += 'FORMAT: Write in paragraphs by default, NOT bullet points. Bullet points should be rare — only for short lists of proper nouns or sequential steps. When comparing things, showing data, or presenting structured info, use MARKDOWN TABLES. Tables are better than bullet lists for comparisons, pricing, schedules, pros/cons, and any multi-column data. ';

  return { instructions, toneTier, isTechnical, wantsQuick };
}


export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { prompt, history, tier: clientTier, mode, fileData, mainMode, userEmail, teacherPromptCount, stream: wantsStream } = req.body;
  const tier = clientTier || 'free';
  if (!prompt) return res.status(400).json({ error: 'No prompt provided' });

  const KEYS = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai: process.env.OPENAI_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
    grok: process.env.GROK_API_KEY,
  };

  // WIN #2: Haiku is always used for synthesis regardless of tier (fast + smart enough)
  const SYNTH_MODEL = 'claude-haiku-4-5-20251001';

  const TIER_MODELS = {
    free: { claude: 'claude-haiku-4-5-20251001', openai: 'gpt-4o-mini', gemini: 'gemini-2.5-flash', grok: 'grok-3-mini' },
    starter: { claude: 'claude-sonnet-4-20250514', openai: 'gpt-4o-mini', gemini: 'gemini-2.5-flash', grok: 'grok-3-mini' },
    pro: { claude: 'claude-sonnet-4-20250514', openai: 'gpt-4o', gemini: 'gemini-2.5-flash', grok: 'grok-3' },
    enterprise: { claude: 'claude-sonnet-4-20250514', openai: 'gpt-4o', gemini: 'gemini-2.5-flash', grok: 'grok-3' },
  };

  const models = TIER_MODELS[tier] || TIER_MODELS.free;
  const activeMode = mode || 'normal';
  const convHistory = Array.isArray(history) ? history.slice(-10) : [];

  const complexity = classifyQuery(prompt, convHistory, fileData, mainMode);
  const systemPrompt = buildSystemPrompt(complexity, activeMode, userEmail, teacherPromptCount, prompt);

  const images = (fileData || []).filter(f => f.type === 'image' && f.imageBase64);
  const textFiles = (fileData || []).filter(f => f.type !== 'image');
  const hasImages = images.length > 0;

  let fullPrompt = prompt;
  if (textFiles.length > 0) {
    fullPrompt = textFiles.map(f => '[File: ' + f.name + ']\n' + f.content).join('\n\n') + '\n\nUser request: ' + prompt;
  }

  // WIN #5: max_tokens dropped from 3000 to 1500 for individual calls
  // Synthesis gets 2000 (slightly more room since it's the final answer)
  const INDIVIDUAL_MAX_TOKENS = 1500;
  const SYNTHESIS_MAX_TOKENS = 2000;

  function withTimeout(promise, ms, name) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(name + ' timed out after ' + ms + 'ms')), ms))
    ]);
  }

  // ── Vision content builders (unchanged) ──
  function buildClaudeContent(text) {
    const parts = [];
    images.forEach(img => {
      const mime = img.imageMime || 'image/png';
      const safeMime = ['image/jpeg','image/png','image/gif','image/webp'].includes(mime) ? mime : 'image/png';
      parts.push({ type: 'image', source: { type: 'base64', media_type: safeMime, data: img.imageBase64 } });
    });
    parts.push({ type: 'text', text: text });
    return parts;
  }
  function buildOpenAIContent(text) {
    const parts = [];
    images.forEach(img => {
      const mime = img.imageMime || 'image/png';
      parts.push({ type: 'image_url', image_url: { url: 'data:' + mime + ';base64,' + img.imageBase64 } });
    });
    parts.push({ type: 'text', text: text });
    return parts;
  }
  function buildGeminiParts(text) {
    const parts = [];
    images.forEach(img => {
      const mime = img.imageMime || 'image/png';
      parts.push({ inline_data: { mime_type: mime, data: img.imageBase64 } });
    });
    parts.push({ text: text });
    return parts;
  }

  // ── Non-streaming callers (for the initial four queries) ──
  async function callClaude(p, model, hist, key, sys) {
    if (!key) throw new Error('No key');
    const userContent = hasImages ? buildClaudeContent(p) : p;
    const messages = hist.map(m => ({ role: m.role, content: m.content })).concat([{ role: 'user', content: userContent }]);
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model, max_tokens: INDIVIDUAL_MAX_TOKENS, system: sys, messages }) });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error?.message || 'Claude error ' + r.status); }
    return (await r.json()).content?.[0]?.text || '';
  }

  async function callOpenAI(p, model, hist, key, sys) {
    if (!key) throw new Error('No key');
    const userContent = hasImages ? buildOpenAIContent(p) : p;
    const messages = [{ role: 'system', content: sys }].concat(hist.map(m => ({ role: m.role, content: m.content }))).concat([{ role: 'user', content: userContent }]);
    const r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }, body: JSON.stringify({ model, max_tokens: INDIVIDUAL_MAX_TOKENS, messages }) });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error?.message || 'OpenAI error ' + r.status); }
    return (await r.json()).choices?.[0]?.message?.content || '';
  }

  async function callGemini(p, model, hist, key, sys) {
    if (!key) throw new Error('No key');
    const parts = hasImages ? buildGeminiParts(sys + '\n\n' + p) : [{ text: sys + '\n\n' + p }];
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + key, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { maxOutputTokens: INDIVIDUAL_MAX_TOKENS } }) });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error?.message || 'Gemini error ' + r.status); }
    return (await r.json()).candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  async function callGrok(p, model, hist, key, sys) {
    if (!key) throw new Error('No key');
    const userContent = hasImages ? buildOpenAIContent(p) : p;
    const messages = [{ role: 'system', content: sys }].concat(hist.map(m => ({ role: m.role, content: m.content }))).concat([{ role: 'user', content: userContent }]);
    // No retry — if Grok 5xx's, let it fail fast rather than blocking 2 extra seconds
    const r = await fetch('https://api.x.ai/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }, body: JSON.stringify({ model, max_tokens: INDIVIDUAL_MAX_TOKENS, messages }) });
    if (!r.ok) throw new Error('Grok error ' + r.status);
    return (await r.json()).choices?.[0]?.message?.content || '';
  }

  // ── Streaming Claude caller for synthesis ──
  // Yields incremental text deltas via async iterator.
  async function* streamClaude(p, model, hist, key, sys, maxTokens) {
    if (!key) throw new Error('No key');
    const userContent = hasImages ? buildClaudeContent(p) : p;
    const messages = hist.map(m => ({ role: m.role, content: m.content })).concat([{ role: 'user', content: userContent }]);
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: maxTokens, system: sys, messages, stream: true })
    });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error?.message || 'Claude stream error ' + r.status); }

    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
              yield parsed.delta.text;
            }
          } catch { /* skip malformed chunks */ }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // ── SSE helpers ──
  function setupSSE() {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering if present
    res.flushHeaders?.();
  }

  function sendEvent(type, data) {
    res.write('data: ' + JSON.stringify({ type, ...data }) + '\n\n');
  }

  // ── Build synthesis instruction (shared between medium and complex) ──
  function buildSynthInstruction(successfulCount) {
    const toneHints = analyzeTone(prompt);
    const base = 'You are the FusionAI synthesis engine. Create one SUPERIOR answer from these AI responses. '
      + 'CRITICAL RULES: '
      + '1) NEVER mention models, synthesis, or that multiple AIs were used. '
      + '2) MIRROR THE USER\'S TONE AND STYLE. Read the user\'s message carefully — if casual (lowercase, slang), respond conversationally. If professional, match that formality. '
      + '3) Be SPECIFIC — use real names, numbers, concrete examples relevant to the user\'s context. '
      + '4) Use ## headers ONLY for long responses (4+ distinct sections). For shorter answers, just use paragraphs. '
      + '5) FORMATTING: Write in PARAGRAPHS as the default. Do NOT use bullet points unless listing 3-5 short proper nouns or sequential steps. '
      + 'When presenting comparisons, options, data, numbers, schedules, or structured information, use MARKDOWN TABLES instead of bullet lists. '
      + 'If the topic involves numbers, percentages, prices, or metrics, ALWAYS present them in a table. '
      + '6) Include concrete, specific examples — not generic advice. '
      + '7) Follow-up questions: ask 1-2 only if they genuinely help. For straightforward requests, skip them. '
      + (toneHints.toneTier === 'casual' ? '8) This user is very casual — keep it conversational, skip headers. ' : '')
      + (toneHints.toneTier === 'professional' ? '8) This requires PROFESSIONAL output — formal language, proper terminology, no slang. ' : '')
      + (toneHints.wantsQuick ? '9) The user wants a QUICK answer — be concise. ' : '')
      + 'DIRECT ANSWER POLICY: Do NOT add disclaimers, warnings, "consult a professional" hedges, or moralizing. '
      + 'If the source answers hedged, strip the hedges in your synthesis. '
      + 'If the source answers refused, extract whatever factual info they did give and present it directly without the refusal language. '
      + 'Users want the information, not corporate CYA language. '
      + 'You may still decline genuinely dangerous content (weapons synthesis, CSAM, targeted harm) — everything else, answer directly. '
      + 'FusionAI was created by Ben Christianson at fusion4ai.com.';
    return base;
  }

  try {
    // ── Setup SSE if streaming requested, otherwise fall back to JSON ──
    if (wantsStream) setupSSE();

    let successful = [];
    let failed = [];
    let synthesized = false;
    let finalReply = '';

    // ── Helper: collect results as they complete ──
    // Returns a promise that resolves to { successful, failed } when all are done,
    // AND also emits events as each model responds (when streaming).
    function collectResults(promises, names) {
      const results = { successful: [], failed: [] };
      const wrapped = promises.map((p, i) =>
        p.then(
          value => {
            if (value) {
              results.successful.push({ name: names[i], text: value });
              if (wantsStream) sendEvent('model_done', { model: names[i] });
            } else {
              results.failed.push({ name: names[i], error: 'Empty response' });
              if (wantsStream) sendEvent('model_failed', { model: names[i], error: 'Empty' });
            }
          },
          err => {
            results.failed.push({ name: names[i], error: err?.message || 'Unknown' });
            if (wantsStream) sendEvent('model_failed', { model: names[i], error: err?.message || 'Unknown' });
          }
        )
      );
      return { allDone: Promise.all(wrapped), results };
    }

    // ── SIMPLE: single model, stream directly ──
    if (complexity === 'simple') {
      if (wantsStream) {
        sendEvent('complexity', { complexity, models: ['Claude'] });
        try {
          let acc = '';
          for await (const delta of streamClaude(fullPrompt, models.claude, convHistory, KEYS.anthropic, systemPrompt, INDIVIDUAL_MAX_TOKENS)) {
            acc += delta;
            sendEvent('delta', { text: delta });
          }
          sendEvent('done', { reply: acc, synthesized: false, models: ['Claude'], failed: [], complexity });
          res.end();
          return;
        } catch (e) {
          try {
            let acc = '';
            for await (const delta of (async function* () {
              // Fallback: non-streaming Gemini, simulated as a single chunk
              const text = await callGemini(fullPrompt, models.gemini, convHistory, KEYS.gemini, systemPrompt);
              yield text;
            })()) {
              acc += delta;
              sendEvent('delta', { text: delta });
            }
            sendEvent('done', { reply: acc, synthesized: false, models: ['Gemini'], failed: [{ name: 'Claude', error: e.message }], complexity });
            res.end();
            return;
          } catch (e2) {
            sendEvent('error', { error: 'All models failed', details: [e.message, e2.message] });
            res.end();
            return;
          }
        }
      } else {
        // Non-streaming fallback
        try {
          finalReply = await withTimeout(callClaude(fullPrompt, models.claude, convHistory, KEYS.anthropic, systemPrompt), 25000, 'Claude');
          successful = [{ name: 'Claude', text: finalReply }];
        } catch (e) {
          try {
            finalReply = await withTimeout(callGemini(fullPrompt, models.gemini, convHistory, KEYS.gemini, systemPrompt), 25000, 'Gemini');
            successful = [{ name: 'Gemini', text: finalReply }];
          } catch (e2) {
            return res.status(500).json({ error: 'All models failed' });
          }
        }
        return res.status(200).json({ reply: finalReply, synthesized: false, models: successful.map(s => s.name), failed: [], individual: successful, mode: activeMode, complexity });
      }
    }

    // ── MEDIUM: 2 models (Claude + Gemini), synthesize via streaming ──
    if (complexity === 'medium') {
      if (wantsStream) sendEvent('complexity', { complexity, models: ['Claude', 'Gemini'] });

      // WIN #3: tighter timeouts (25s cap)
      const claudeP = withTimeout(callClaude(fullPrompt, models.claude, convHistory, KEYS.anthropic, systemPrompt), 25000, 'Claude');
      const geminiP = withTimeout(callGemini(fullPrompt, models.gemini, convHistory, KEYS.gemini, systemPrompt), 25000, 'Gemini');

      const { allDone, results } = collectResults([claudeP, geminiP], ['Claude', 'Gemini']);

      // WIN #6: If Claude returns quickly (<4s) with a solid answer, don't wait for Gemini
      // Start a race: claudeP resolves fast → we can short-circuit.
      // But easiest correct impl: wait for both (they run parallel), skip synthesis if only 1 back.
      await allDone;

      successful = results.successful;
      failed = results.failed;

      const skipped = [
        { name: 'ChatGPT', error: 'Skipped (quick query)' },
        { name: 'Grok', error: 'Skipped (quick query)' },
      ];

      if (successful.length === 0) {
        if (wantsStream) {
          sendEvent('error', { error: 'All models failed', failed: failed.concat(skipped) });
          res.end();
          return;
        }
        return res.status(500).json({ error: 'All models failed', failed: failed.concat(skipped), failedDetails: failed.concat(skipped) });
      }

      // WIN #6: If only one succeeded, just stream its text directly (skip synthesis)
      if (successful.length === 1) {
        const text = successful[0].text;
        if (wantsStream) {
          sendEvent('synth_start', {});
          // Stream the single response out as chunks to preserve the streaming UX
          const chunkSize = 40;
          for (let i = 0; i < text.length; i += chunkSize) {
            sendEvent('delta', { text: text.slice(i, i + chunkSize) });
          }
          sendEvent('done', {
            reply: text,
            synthesized: false,
            models: successful.map(s => s.name),
            failed: failed.concat(skipped).map(f => f.name),
            failedDetails: failed.concat(skipped),
            complexity
          });
          res.end();
          return;
        }
        return res.status(200).json({ reply: text, synthesized: false, models: successful.map(s => s.name), failed: failed.concat(skipped).map(f => f.name), failedDetails: failed.concat(skipped), individual: successful, mode: activeMode, complexity });
      }

      // Both succeeded → synthesize
      const synthPrompt = 'The user asked: "' + prompt + '"\n\nHere are responses from 2 AI models:\n\n' + successful.map((s, i) => 'Response ' + (i + 1) + ':\n' + s.text).join('\n\n---\n\n');
      const synthInst = buildSynthInstruction(successful.length);

      if (wantsStream) {
        sendEvent('synth_start', {});
        try {
          let acc = '';
          for await (const delta of streamClaude(synthPrompt, SYNTH_MODEL, [], KEYS.anthropic, synthInst, SYNTHESIS_MAX_TOKENS)) {
            acc += delta;
            sendEvent('delta', { text: delta });
          }
          sendEvent('done', {
            reply: acc,
            synthesized: true,
            models: successful.map(s => s.name),
            failed: failed.concat(skipped).map(f => f.name),
            failedDetails: failed.concat(skipped),
            complexity
          });
          res.end();
          return;
        } catch (e) {
          // Fallback to first successful if synthesis stream fails
          const fallback = successful[0].text;
          sendEvent('delta', { text: fallback });
          sendEvent('done', {
            reply: fallback,
            synthesized: false,
            models: successful.map(s => s.name),
            failed: failed.concat(skipped).map(f => f.name),
            failedDetails: failed.concat(skipped),
            complexity
          });
          res.end();
          return;
        }
      }

      // Non-streaming fallback for medium
      try {
        finalReply = await withTimeout(callClaude(synthPrompt, SYNTH_MODEL, [], KEYS.anthropic, synthInst), 20000, 'Synthesis');
        synthesized = true;
      } catch {
        finalReply = successful[0].text;
      }
      return res.status(200).json({
        reply: finalReply,
        synthesized,
        models: successful.map(s => s.name),
        failed: failed.concat(skipped).map(f => f.name),
        failedDetails: failed.concat(skipped),
        individual: successful,
        mode: activeMode,
        complexity
      });
    }

    // ── DEBATE MODE: Multi-round with real rebuttals ──
    // Round 1: each AI answers independently
    // Round 2: each AI reads the other 3's answers and writes a rebuttal
    // Verdict: Haiku synthesizes a final judgment (streamed)
    if (mainMode === 'debate') {
      const names = ['Claude', 'ChatGPT', 'Gemini', 'Grok'];
      if (wantsStream) sendEvent('complexity', { complexity: 'debate', models: names });
      if (wantsStream) sendEvent('debate_round', { round: 1 });

      // ── Grok with single retry (debate tolerates the extra ~2s for reliability) ──
      async function callGrokRetry(p, model, hist, key, sys) {
        try {
          return await callGrok(p, model, hist, key, sys);
        } catch (e) {
          // One retry after brief pause
          await new Promise(r => setTimeout(r, 1200));
          return await callGrok(p, model, hist, key, sys);
        }
      }

      // ── ROUND 1: parallel, each AI gives opening argument ──
      const r1System = systemPrompt
        + ' DEBATE CONTEXT: This is a formal debate. You are presenting your opening argument. '
        + 'State your position clearly and confidently. Back it up with specifics. '
        + 'Keep it focused — around 200-350 words. '
        + 'Other AIs will read your argument and respond, so make your strongest case.';

      const r1Promises = [
        withTimeout(callClaude(fullPrompt, models.claude, convHistory, KEYS.anthropic, r1System), 30000, 'Claude').then(
          v => { if (wantsStream) sendEvent('model_done', { model: 'Claude', round: 1 }); return { name: 'Claude', text: v, ok: true }; },
          e => { if (wantsStream) sendEvent('model_failed', { model: 'Claude', round: 1, error: e?.message }); return { name: 'Claude', ok: false, error: e?.message || 'failed' }; }
        ),
        withTimeout(callOpenAI(fullPrompt, models.openai, convHistory, KEYS.openai, r1System), 30000, 'ChatGPT').then(
          v => { if (wantsStream) sendEvent('model_done', { model: 'ChatGPT', round: 1 }); return { name: 'ChatGPT', text: v, ok: true }; },
          e => { if (wantsStream) sendEvent('model_failed', { model: 'ChatGPT', round: 1, error: e?.message }); return { name: 'ChatGPT', ok: false, error: e?.message || 'failed' }; }
        ),
        withTimeout(callGemini(fullPrompt, models.gemini, convHistory, KEYS.gemini, r1System), 30000, 'Gemini').then(
          v => { if (wantsStream) sendEvent('model_done', { model: 'Gemini', round: 1 }); return { name: 'Gemini', text: v, ok: true }; },
          e => { if (wantsStream) sendEvent('model_failed', { model: 'Gemini', round: 1, error: e?.message }); return { name: 'Gemini', ok: false, error: e?.message || 'failed' }; }
        ),
        withTimeout(callGrokRetry(fullPrompt, models.grok, convHistory, KEYS.grok, r1System), 28000, 'Grok').then(
          v => { if (wantsStream) sendEvent('model_done', { model: 'Grok', round: 1 }); return { name: 'Grok', text: v, ok: true }; },
          e => { if (wantsStream) sendEvent('model_failed', { model: 'Grok', round: 1, error: e?.message }); return { name: 'Grok', ok: false, error: e?.message || 'failed' }; }
        ),
      ];

      const round1Results = await Promise.all(r1Promises);
      const round1Success = round1Results.filter(r => r.ok && r.text);

      if (round1Success.length < 2) {
        // Can't have a debate with fewer than 2 participants
        const failed = round1Results.filter(r => !r.ok).map(r => ({ name: r.name, error: r.error }));
        if (wantsStream) {
          sendEvent('error', { error: 'Not enough models responded for a debate', failed });
          res.end();
          return;
        }
        return res.status(500).json({ error: 'Not enough models responded for a debate', failed });
      }

      // ── ROUND 2: rebuttals ──
      if (wantsStream) sendEvent('debate_round', { round: 2 });

      function buildRebuttalContext(myName, allArgs) {
        const others = allArgs.filter(a => a.name !== myName && a.ok && a.text);
        const otherArgs = others.map(o => o.name + ' argued:\n"' + o.text + '"').join('\n\n---\n\n');
        return 'The original question was: "' + prompt + '"\n\n'
          + 'You (' + myName + ') gave your opening argument. Here are the arguments from the other AIs:\n\n'
          + otherArgs + '\n\n'
          + 'Write a rebuttal. Identify specific weaknesses, errors, or missing considerations in the other arguments. '
          + 'Defend your position where challenged, OR update your view if another AI made a genuinely better point (intellectual honesty matters). '
          + 'Reference the other AIs by name when engaging with their points. '
          + 'Keep it focused — around 200-350 words. Be direct, even combative if warranted. This is a debate, not a group hug.';
      }

      const r2System = systemPrompt
        + ' DEBATE CONTEXT: This is the rebuttal round. You have already stated your position. '
        + 'Now you are critiquing the other AIs\' arguments and defending/refining your own. '
        + 'Be specific: cite the other AIs by name when you disagree or agree with them. '
        + 'Do NOT just restate your original argument. Engage with what the others actually said.';

      // Only participants who succeeded in round 1 can write rebuttals
      const r2Promises = round1Success.map(participant => {
        const rebuttalPrompt = buildRebuttalContext(participant.name, round1Success);
        let caller, model, key;
        if (participant.name === 'Claude')      { caller = callClaude;      model = models.claude; key = KEYS.anthropic; }
        else if (participant.name === 'ChatGPT'){ caller = callOpenAI;      model = models.openai; key = KEYS.openai; }
        else if (participant.name === 'Gemini') { caller = callGemini;      model = models.gemini; key = KEYS.gemini; }
        else if (participant.name === 'Grok')   { caller = callGrokRetry;   model = models.grok;   key = KEYS.grok; }

        return withTimeout(caller(rebuttalPrompt, model, [], key, r2System), 30000, participant.name + ' rebuttal').then(
          v => {
            if (wantsStream) sendEvent('model_done', { model: participant.name, round: 2 });
            return { name: participant.name, text: v, ok: true };
          },
          e => {
            if (wantsStream) sendEvent('model_failed', { model: participant.name, round: 2, error: e?.message });
            return { name: participant.name, ok: false, error: e?.message || 'failed' };
          }
        );
      });

      const round2Results = await Promise.all(r2Promises);

      // Merge round 1 and round 2 into per-AI "full argument" blocks for individual display
      const fullIndividual = round1Success.map(r1 => {
        const r2 = round2Results.find(x => x.name === r1.name);
        const r2Text = (r2 && r2.ok && r2.text) ? r2.text : '[No rebuttal]';
        return {
          name: r1.name,
          text: '**Opening Argument:**\n\n' + r1.text + '\n\n**Rebuttal:**\n\n' + r2Text,
          openingArgument: r1.text,
          rebuttal: r2Text,
        };
      });

      // Also include any models that failed round 1 as failed entries
      const failedR1 = round1Results.filter(r => !r.ok).map(r => ({ name: r.name, error: r.error }));

      // ── VERDICT: Haiku judges the debate ──
      if (wantsStream) sendEvent('debate_round', { round: 'verdict' });

      const verdictPrompt = 'Original question: "' + prompt + '"\n\n'
        + 'The following AIs debated this question. Each gave an opening argument and then wrote a rebuttal engaging with the others.\n\n'
        + fullIndividual.map(p => '═══ ' + p.name + ' ═══\n\nOPENING:\n' + p.openingArgument + '\n\nREBUTTAL:\n' + p.rebuttal).join('\n\n')
        + '\n\nWrite the final verdict on this debate. Your job is to:\n'
        + '1) Name which AI made the strongest overall case and why. Be willing to actually pick a winner.\n'
        + '2) Identify the most important disagreement and explain which side has the better argument.\n'
        + '3) Extract the correct or best answer to the user\'s original question.\n'
        + 'Do NOT be mealy-mouthed or refuse to take a position. The user wants a clear verdict.';

      const verdictSystem = 'You are the FusionAI debate judge. Deliver a decisive, direct verdict. '
        + 'Name the winning AI. Explain why they won. Give the user the best answer to their original question. '
        + 'Do NOT moralize, hedge, or refuse to pick a winner. '
        + 'Format: a short opening paragraph stating the winner and why, then the substantive answer to the original question. '
        + 'Use markdown tables where comparing claims side by side. '
        + 'FusionAI was created by Ben Christianson at fusion4ai.com.';

      if (wantsStream) {
        sendEvent('synth_start', { verdict: true });
        try {
          let acc = '';
          for await (const delta of streamClaude(verdictPrompt, SYNTH_MODEL, [], KEYS.anthropic, verdictSystem, SYNTHESIS_MAX_TOKENS)) {
            acc += delta;
            sendEvent('delta', { text: delta });
          }
          sendEvent('done', {
            reply: acc,
            synthesized: true,
            debate: true,
            models: fullIndividual.map(p => p.name),
            failed: failedR1.map(f => f.name),
            failedDetails: failedR1,
            individual: fullIndividual,
            complexity: 'debate',
          });
          res.end();
          return;
        } catch (e) {
          // Fallback: just concatenate
          const fallback = fullIndividual.map(p => '### ' + p.name + '\n\n' + p.text).join('\n\n---\n\n');
          sendEvent('delta', { text: fallback });
          sendEvent('done', {
            reply: fallback,
            synthesized: false,
            debate: true,
            models: fullIndividual.map(p => p.name),
            failed: failedR1.map(f => f.name),
            failedDetails: failedR1,
            individual: fullIndividual,
            complexity: 'debate',
          });
          res.end();
          return;
        }
      }

      // Non-streaming fallback for debate
      let verdictText = '';
      try {
        verdictText = await withTimeout(callClaude(verdictPrompt, SYNTH_MODEL, [], KEYS.anthropic, verdictSystem), 25000, 'Verdict');
      } catch (e) {
        verdictText = fullIndividual.map(p => '### ' + p.name + '\n\n' + p.text).join('\n\n---\n\n');
      }
      return res.status(200).json({
        reply: verdictText,
        synthesized: true,
        debate: true,
        models: fullIndividual.map(p => p.name),
        failed: failedR1.map(f => f.name),
        failedDetails: failedR1,
        individual: fullIndividual,
        mode: activeMode,
        complexity: 'debate',
      });
    }

    // ── COMPLEX: 4 models with race logic (start synthesis when 3/4 in) ──
    if (wantsStream) sendEvent('complexity', { complexity, models: ['Claude', 'ChatGPT', 'Gemini', 'Grok'] });

    // WIN #3: Grok gets tighter timeout because it's typically the slowest
    const claudeP = withTimeout(callClaude(fullPrompt, models.claude, convHistory, KEYS.anthropic, systemPrompt), 25000, 'Claude');
    const gptP = withTimeout(callOpenAI(fullPrompt, models.openai, convHistory, KEYS.openai, systemPrompt), 25000, 'ChatGPT');
    const geminiP = withTimeout(callGemini(fullPrompt, models.gemini, convHistory, KEYS.gemini, systemPrompt), 25000, 'Gemini');
    const grokP = withTimeout(callGrok(fullPrompt, models.grok, convHistory, KEYS.grok, systemPrompt), 20000, 'Grok');

    // Track each result as it arrives
    const names = ['Claude', 'ChatGPT', 'Gemini', 'Grok'];
    const promises = [claudeP, gptP, geminiP, grokP];

    // Manually collect with event emission as they land (true streaming of progress)
    const collected = [];
    const settledFlags = [false, false, false, false];

    const wrapped = promises.map((p, i) =>
      p.then(
        value => {
          settledFlags[i] = true;
          if (value) {
            collected.push({ name: names[i], text: value, ok: true });
            if (wantsStream) sendEvent('model_done', { model: names[i] });
          } else {
            collected.push({ name: names[i], text: null, ok: false, error: 'Empty' });
            if (wantsStream) sendEvent('model_failed', { model: names[i], error: 'Empty' });
          }
        },
        err => {
          settledFlags[i] = true;
          collected.push({ name: names[i], text: null, ok: false, error: err?.message || 'Unknown' });
          if (wantsStream) sendEvent('model_failed', { model: names[i], error: err?.message || 'Unknown' });
        }
      )
    );

    // WIN #3 (race): resolve when we have 3 successes OR all 4 settled, whichever first
    // Wait max 15s for 3rd response after first response came in
    let firstResponseTime = null;
    function successCount() { return collected.filter(c => c.ok).length; }
    function allDone() { return settledFlags.every(f => f); }

    const startTime = Date.now();
    const MAX_WAIT_AFTER_3 = 4000; // ms to wait for 4th after 3 are in

    await new Promise(resolve => {
      let resolved = false;
      let raceTimer = null;
      function done() {
        if (resolved) return;
        resolved = true;
        if (raceTimer) clearTimeout(raceTimer);
        resolve();
      }
      // Check every 150ms whether we should proceed
      const checker = setInterval(() => {
        if (allDone()) { clearInterval(checker); done(); return; }
        if (successCount() >= 3 && !raceTimer) {
          // Start 4-second grace period for Grok/stragglers
          raceTimer = setTimeout(() => { clearInterval(checker); done(); }, MAX_WAIT_AFTER_3);
        }
        // Hard ceiling at 25s total (timeouts should have fired, but belt-and-suspenders)
        if (Date.now() - startTime > 26000) { clearInterval(checker); done(); }
      }, 150);
      // Also resolve naturally when all complete
      Promise.all(wrapped).then(() => { clearInterval(checker); done(); });
    });

    successful = collected.filter(c => c.ok).map(c => ({ name: c.name, text: c.text }));
    failed = collected.filter(c => !c.ok).map(c => ({ name: c.name, error: c.error }));

    // Fill in "not yet responded" for any model that didn't settle in time
    names.forEach((n, i) => {
      if (!settledFlags[i] && !successful.find(s => s.name === n) && !failed.find(f => f.name === n)) {
        failed.push({ name: n, error: 'Response skipped (answering from faster models)' });
      }
    });

    if (successful.length === 0) {
      if (wantsStream) {
        sendEvent('error', { error: 'All models failed', failed });
        res.end();
        return;
      }
      return res.status(500).json({ error: 'All models failed', failed, failedDetails: failed });
    }

    // If only one model succeeded, stream it directly (no synthesis needed)
    if (successful.length === 1) {
      const text = successful[0].text;
      if (wantsStream) {
        sendEvent('synth_start', {});
        const chunkSize = 40;
        for (let i = 0; i < text.length; i += chunkSize) {
          sendEvent('delta', { text: text.slice(i, i + chunkSize) });
        }
        sendEvent('done', { reply: text, synthesized: false, models: [successful[0].name], failed: failed.map(f => f.name), failedDetails: failed, complexity });
        res.end();
        return;
      }
      return res.status(200).json({ reply: text, synthesized: false, models: [successful[0].name], failed: failed.map(f => f.name), failedDetails: failed, individual: successful, mode: activeMode, complexity });
    }

    // Synthesize from whoever responded (could be 2, 3, or 4)
    const synthPrompt = 'The user asked: "' + prompt + '"\n\nHere are responses from ' + successful.length + ' AI models:\n\n' + successful.map((s, i) => 'Response ' + (i + 1) + ':\n' + s.text).join('\n\n---\n\n');
    const synthInst = buildSynthInstruction(successful.length);

    if (wantsStream) {
      sendEvent('synth_start', {});
      try {
        let acc = '';
        // WIN #2: synthesis uses Haiku regardless of tier
        // WIN #1: synthesis is streamed
        for await (const delta of streamClaude(synthPrompt, SYNTH_MODEL, [], KEYS.anthropic, synthInst, SYNTHESIS_MAX_TOKENS)) {
          acc += delta;
          sendEvent('delta', { text: delta });
        }
        sendEvent('done', { reply: acc, synthesized: true, models: successful.map(s => s.name), failed: failed.map(f => f.name), failedDetails: failed, complexity });
        res.end();
        return;
      } catch (e) {
        const fallback = successful[0].text;
        sendEvent('delta', { text: fallback });
        sendEvent('done', { reply: fallback, synthesized: false, models: successful.map(s => s.name), failed: failed.map(f => f.name), failedDetails: failed, complexity });
        res.end();
        return;
      }
    }

    // Non-streaming fallback for complex
    try {
      finalReply = await withTimeout(callClaude(synthPrompt, SYNTH_MODEL, [], KEYS.anthropic, synthInst), 25000, 'Synthesis');
      synthesized = true;
    } catch {
      finalReply = successful[0].text;
    }

    return res.status(200).json({
      reply: finalReply,
      synthesized,
      models: successful.map(s => s.name),
      failed: failed.map(f => f.name),
      failedDetails: failed,
      individual: successful,
      mode: activeMode,
      complexity
    });

  } catch (e) {
    console.error('Handler error:', e);
    if (wantsStream && !res.writableEnded) {
      try { sendEvent('error', { error: e.message }); res.end(); } catch {}
      return;
    }
    if (!res.headersSent) return res.status(500).json({ error: e.message });
  }
}
