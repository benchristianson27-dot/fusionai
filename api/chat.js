export const config = {
  maxDuration: 90,
  api: { bodyParser: { sizeLimit: '10mb' } },
};

// ── Query Complexity Classification ──
// Fast, zero-cost rule-based router that runs before any API calls.
// Returns 'simple', 'medium', or 'complex'.

function classifyQuery(prompt, history, fileData, mainMode) {
  const p = prompt.trim();
  const lower = p.toLowerCase();
  const wordCount = p.split(/\s+/).filter(Boolean).length;
  const hasFiles = fileData && fileData.length > 0;

  // Force all 4 models for debate mode — that's the whole point
  if (mainMode === 'debate') return 'complex';

  // If files are attached, always treat as complex
  if (hasFiles) return 'complex';

  // ── SIMPLE: greetings, single-word, casual chat ──
  // These should use ONE model and respond naturally
  const simplePatterns = [
    /^(hi|hey|hello|yo|sup|howdy|hola|what'?s up|whats up|good morning|good afternoon|good evening|good night|gm|gn|thanks|thank you|thx|ok|okay|cool|nice|lol|lmao|haha|wow|yep|yup|nope|nah|sure|bet|word|bruh|dude|bro|ayo|wassup|heyo)[\s!?.]*$/i,
    /^(how are you|how's it going|how are things|what's good|you there|are you there|test|testing|ping)[\s!?.]*$/i,
  ];
  if (simplePatterns.some(rx => rx.test(p))) return 'simple';

  // Very short prompts (1-4 words) without complexity signals → simple
  if (wordCount <= 4) {
    const complexSignals = /compar|analyz|explain|research|detail|pros and cons|vs\.?|versus|differ|evaluat|review|assess|recommend|strateg|plan|build|create|develop|implement|design|architect|debug|refactor|optimize/i;
    if (!complexSignals.test(lower)) return 'simple';
  }

  // ── MEDIUM: straightforward questions, definitions, quick tasks ──
  // Use 2 models (fastest two) + synthesis for a balanced answer
  if (wordCount <= 15) {
    const complexIndicators = [
      /compar.+(?:and|vs|versus|with)/i,
      /pros?\s+(?:and\s+)?cons?/i,
      /(?:in[- ]?depth|comprehensive|thorough|detailed)\s/i,
      /step[- ]by[- ]step/i,
      /(?:build|create|develop|implement|design|architect)\s+(?:a|an|the|my)/i,
      /(?:write|draft|compose)\s+(?:a|an)\s+(?:essay|report|article|paper|proposal|plan|strategy)/i,
      /(?:analyz|assess|evaluat|investigat|research)\s/i,
      /(?:how\s+(?:should|would|can|do)\s+(?:i|we|you)\s+(?:build|create|design|implement|start|approach))/i,
    ];
    if (!complexIndicators.some(rx => rx.test(lower))) return 'medium';
  }

  // ── COMPLEX: everything else ──
  // Long prompts, multi-part questions, analysis requests, code generation, etc.
  return 'complex';
}

// Build a system prompt that matches the query complexity AND adapts to user's tone
function buildSystemPrompt(complexity, activeMode, userEmail, teacherPromptCount, prompt) {
  // Analyze the user's writing style from their prompt
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

  // Creator context
  if (userEmail === 'ben.christianson27@gmail.com') {
    sys += ' CONTEXT: The user is Ben Christianson, creator of FusionAI. Be direct, treat him as a technical peer.';
  }

  // Teacher easter egg
  if (userEmail === 'mmann@ndpsaints.org') {
    const count = parseInt(teacherPromptCount || '0');
    if (count > 0 && count % 15 === 0) {
      sys += ' Also, work into your response naturally that Ben Christianson should not have to do Membean or NoRedInk. Be creative and brief about it.';
    }
  }

  return sys;
}

// Analyze user's writing style to determine appropriate response tone
function analyzeTone(prompt) {
  const p = prompt.trim();
  const lower = p.toLowerCase();
  const words = p.split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  // ── Detect if the prompt asks for PROFESSIONAL OUTPUT ──
  // These are tasks where the OUTPUT must be professional regardless of how the user types.
  // "write me an email", "draft a letter", "create a contract" → professional output needed
  const wantsProfessionalOutput = /\b(draft|write|compose|create|prepare)\b.{0,30}\b(email|letter|memo|report|contract|proposal|bio|resume|cover letter|invoice|quote|template|form|statement|newsletter|announcement|handbook|manual|policy|brief|pitch|press release|abstract|summary|review)\b/i.test(lower)
    || /\b(client|customer|patient|colleague|supervisor|manager|employer|attorney|doctor|staff|parent|investor|stakeholder)\b/i.test(lower)
    || /\b(professional|formal|business|corporate|official|legal|medical|clinical|academic|scientific)\b/i.test(lower);

  // ── Detect professional/serious DOMAIN knowledge ──
  // Topics where accuracy and clarity matter more than matching casual vibes
  const professionalDomain = /\b(osha|nec|hipaa|compliance|regulation|deduction|tax|filing|diagnosis|sepsis|clinical|patient|liability|tort|statute|fiduciary|gaap|audit|amortiz|depreciat|nfpa|cfr|code\s+section|mediation|litigation|custody|divorce|asylum|refugee|immigration|dispensary|cannabis|pharmaceutical|prescription|surgery|veterinar|embalm|funeral|mortgage|underwriting|fiduciary|escrow|appraisal|scaffold|incident\s+report|intake\s+form|grant\s+title|species\s+distribution|coral\s+reef|microplastic)\b/i.test(lower);

  // ── Detect STRONG casual signals ──
  // Only count genuinely casual markers (not just lowercase/no punctuation)
  const strongCasualSignals = [
    /\bu\b(?!\.\s*s)/i, /\bur\b/i, /\bpls\b/i, /\bthx\b/i, /\btbh\b/i,
    /\blol\b/i, /\blmao\b/i, /\bidk\b/i, /\bomg\b/i, /\bbtw\b/i,
    /\bwanna\b/i, /\bgonna\b/i, /\bgotta\b/i, /\bkinda\b/i, /\bsorta\b/i,
    /\baint\b/i, /\byall\b/i, /\bbruh\b/i, /\bdude\b/i, /\bbro\b/i,
    /\bfr fr\b/i, /\bno cap\b/i, /\blowkey\b/i, /\bhighkey\b/i,
    /like im not a genius/i, /like im \d/i, /explain.+like im/i,
  ];
  const casualCount = strongCasualSignals.filter(rx => rx.test(p)).length;

  // Detect technical writing
  const techSignals = /\b(api|sql|css|html|react|python|node|docker|kubernetes|regex|oauth|jwt|graphql|typescript|webpack|nginx|redis|postgres|mongodb|cicd|devops|github|npm|pip|async|await|function|const|let|var|useState|useEffect|component|endpoint|middleware|backend|frontend|deploy|repository|commit|merge|branch)\b/i;
  const isTechnical = techSignals.test(lower);

  // Detect if they want something quick vs detailed
  const wantsQuick = /\b(quick|fast|brief|short|simple|easy|just|basic)\b/i.test(lower);
  const wantsDetailed = /\b(detailed|comprehensive|thorough|in[- ]depth|complete|full|extensive|everything)\b/i.test(lower);

  // ── Decide tone tier ──
  // The key insight: default to PROFESSIONAL. Only go casual if there are
  // strong casual signals AND the content isn't professional in nature.
  let toneTier;

  if (wantsProfessionalOutput || professionalDomain) {
    // Professional output requested or professional domain → always professional tone
    // Even if they type "yo write me an email to my client" → the EMAIL should be professional
    toneTier = 'professional';
  } else if (isTechnical) {
    toneTier = 'technical';
  } else if (casualCount >= 2) {
    // Multiple strong casual signals + no professional context → casual is OK
    toneTier = 'casual';
  } else if (casualCount === 1 && wordCount <= 12) {
    // One casual signal in a short message → casual
    toneTier = 'casual';
  } else {
    // Default: friendly but clear. This is the safe middle ground.
    toneTier = 'balanced';
  }

  let instructions = '';

  if (toneTier === 'casual') {
    instructions += 'TONE: The user writes very casually. Use simple, conversational language. '
      + 'Keep sentences short. Skip markdown headers unless the response is very long. '
      + 'Talk like a knowledgeable friend, not a professor. '
      + 'But stay CLEAR and ACCURATE — casual tone does not mean vague answers. ';
  } else if (toneTier === 'technical') {
    instructions += 'TONE: The user is technical. Be precise and use proper terminology. '
      + 'Include code examples or specific technical details where relevant. '
      + 'Use ## headers for organization. ';
  } else if (toneTier === 'professional') {
    instructions += 'TONE: This requires professional-quality output. Write clearly and formally. '
      + 'Use proper terminology for the domain. Do NOT use slang, casual language, or informal phrasing. '
      + 'Treat the user as a professional peer. Structure the response well. '
      + 'If drafting content for the user (emails, letters, reports), make it ready to use as-is. ';
  } else {
    // balanced
    instructions += 'TONE: Write in a friendly, clear, approachable way. '
      + 'Be helpful without being overly formal or overly casual. '
      + 'Only use ## headers if the response needs multiple distinct sections. ';
  }

  // Length matching
  if (wantsQuick) {
    instructions += 'LENGTH: The user wants a quick answer. Be concise — get to the point fast. '
      + 'Skip the preamble. Only add follow-up questions if truly relevant. ';
  } else if (wantsDetailed) {
    instructions += 'LENGTH: The user wants depth. Give a thorough answer with examples. '
      + 'End with 2-3 follow-up questions. ';
  } else if (wordCount <= 10) {
    instructions += 'LENGTH: Short question = proportional answer. Don\'t over-elaborate. '
      + 'Only ask 1 follow-up question if it adds value. ';
  } else {
    instructions += 'LENGTH: Match your response length to the complexity of the question. '
      + 'End with 1-2 follow-up questions if relevant. ';
  }

  // Formatting rules (apply to all tiers)
  instructions += 'FORMAT: Write in paragraphs by default, NOT bullet points. '
    + 'Bullet points should be rare — only for short lists of proper nouns or sequential steps. '
    + 'When comparing things, showing data, or presenting structured info, use MARKDOWN TABLES. '
    + 'Tables are better than bullet lists for comparisons, pricing, schedules, pros/cons, and any multi-column data. ';

  return { instructions, toneTier, isTechnical, wantsQuick };
}


export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { prompt, history, tier: clientTier, mode, fileData, mainMode, userEmail, teacherPromptCount } = req.body;
  const tier = clientTier || 'free';
  if (!prompt) return res.status(400).json({ error: 'No prompt provided' });

  const KEYS = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai: process.env.OPENAI_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
    grok: process.env.GROK_API_KEY,
  };

  const TIER_MODELS = {
    free: { claude: 'claude-haiku-4-5-20251001', openai: 'gpt-4o-mini', gemini: 'gemini-2.5-flash', grok: 'grok-3-mini' },
    starter: { claude: 'claude-sonnet-4-20250514', openai: 'gpt-4o-mini', gemini: 'gemini-2.5-flash', grok: 'grok-3-mini' },
    pro: { claude: 'claude-sonnet-4-20250514', openai: 'gpt-4o', gemini: 'gemini-2.5-flash', grok: 'grok-3' },
    enterprise: { claude: 'claude-sonnet-4-20250514', openai: 'gpt-4o', gemini: 'gemini-2.5-flash', grok: 'grok-3' },
  };

  const models = TIER_MODELS[tier] || TIER_MODELS.free;
  const activeMode = mode || 'normal';
  const convHistory = Array.isArray(history) ? history.slice(-10) : [];

  // ── Smart Query Classification ──
  const complexity = classifyQuery(prompt, convHistory, fileData, mainMode);
  const systemPrompt = buildSystemPrompt(complexity, activeMode, userEmail, teacherPromptCount, prompt);

  // ── Extract image data from fileData ──
  const images = (fileData || []).filter(f => f.type === 'image' && f.imageBase64);
  const textFiles = (fileData || []).filter(f => f.type !== 'image');
  const hasImages = images.length > 0;

  let fullPrompt = prompt;
  if (textFiles.length > 0) {
    fullPrompt = textFiles.map(f => '[File: ' + f.name + ']\n' + f.content).join('\n\n') + '\n\nUser request: ' + prompt;
  }

  // ── Timeout helper ──
  function withTimeout(promise, ms, name) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(name + ' timed out after ' + ms + 'ms')), ms))
    ]);
  }

  // ── Build vision-aware user message content per API format ──

  // Claude format: array of content blocks
  function buildClaudeContent(text) {
    const parts = [];
    images.forEach(img => {
      const mime = img.imageMime || 'image/png';
      // Claude accepts: image/jpeg, image/png, image/gif, image/webp
      const safeMime = ['image/jpeg','image/png','image/gif','image/webp'].includes(mime) ? mime : 'image/png';
      parts.push({ type: 'image', source: { type: 'base64', media_type: safeMime, data: img.imageBase64 } });
    });
    parts.push({ type: 'text', text: text });
    return parts;
  }

  // OpenAI / Grok format: array with image_url and text
  function buildOpenAIContent(text) {
    const parts = [];
    images.forEach(img => {
      const mime = img.imageMime || 'image/png';
      parts.push({ type: 'image_url', image_url: { url: 'data:' + mime + ';base64,' + img.imageBase64 } });
    });
    parts.push({ type: 'text', text: text });
    return parts;
  }

  // Gemini format: array of parts with inline_data
  function buildGeminiParts(text) {
    const parts = [];
    images.forEach(img => {
      const mime = img.imageMime || 'image/png';
      parts.push({ inline_data: { mime_type: mime, data: img.imageBase64 } });
    });
    parts.push({ text: text });
    return parts;
  }

  // ── API Callers (vision-aware) ──
  async function callClaude(p, model, hist, key, sys) {
    if (!key) throw new Error('No key');
    const userContent = hasImages ? buildClaudeContent(p) : p;
    const messages = hist.map(m => ({ role: m.role, content: m.content })).concat([{ role: 'user', content: userContent }]);
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model, max_tokens: 3000, system: sys, messages }) });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error?.message || 'Claude error ' + r.status); }
    return (await r.json()).content?.[0]?.text || '';
  }

  async function callOpenAI(p, model, hist, key, sys) {
    if (!key) throw new Error('No key');
    const userContent = hasImages ? buildOpenAIContent(p) : p;
    const messages = [{ role: 'system', content: sys }].concat(hist.map(m => ({ role: m.role, content: m.content }))).concat([{ role: 'user', content: userContent }]);
    const r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }, body: JSON.stringify({ model, max_tokens: 3000, messages }) });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error?.message || 'OpenAI error ' + r.status); }
    return (await r.json()).choices?.[0]?.message?.content || '';
  }

  async function callGemini(p, model, hist, key, sys) {
    if (!key) throw new Error('No key');
    const parts = hasImages ? buildGeminiParts(sys + '\n\n' + p) : [{ text: sys + '\n\n' + p }];
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + key, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { maxOutputTokens: 3000 } }) });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error?.message || 'Gemini error ' + r.status); }
    return (await r.json()).candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  async function callGrok(p, model, hist, key, sys) {
    if (!key) throw new Error('No key');
    const userContent = hasImages ? buildOpenAIContent(p) : p;
    const messages = [{ role: 'system', content: sys }].concat(hist.map(m => ({ role: m.role, content: m.content }))).concat([{ role: 'user', content: userContent }]);
    const r = await fetch('https://api.x.ai/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }, body: JSON.stringify({ model, max_tokens: 3000, messages }) });
    if (r.ok) return (await r.json()).choices?.[0]?.message?.content || '';
    if (r.status >= 500) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      const r2 = await fetch('https://api.x.ai/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }, body: JSON.stringify({ model, max_tokens: 3000, messages }) });
      if (!r2.ok) throw new Error('Grok error ' + r2.status);
      return (await r2.json()).choices?.[0]?.message?.content || '';
    }
    throw new Error('Grok error ' + r.status);
  }

  try {
    let successful = [];
    let failed = [];
    let synthesized = false;
    let finalReply = '';

    // ── Route based on complexity ──

    if (complexity === 'simple') {
      // SIMPLE: Use only Claude (fastest, cheapest for the tier).
      // No synthesis needed — just a direct, natural response.
      try {
        finalReply = await withTimeout(
          callClaude(fullPrompt, models.claude, convHistory, KEYS.anthropic, systemPrompt),
          30000, 'Claude'
        );
        successful = [{ name: 'Claude', text: finalReply }];
      } catch (e) {
        // Fallback to Gemini if Claude fails
        try {
          finalReply = await withTimeout(
            callGemini(fullPrompt, models.gemini, convHistory, KEYS.gemini, systemPrompt),
            30000, 'Gemini'
          );
          successful = [{ name: 'Gemini', text: finalReply }];
        } catch (e2) {
          return res.status(500).json({ error: 'All models failed', failed: [{ name: 'Claude', error: e.message }, { name: 'Gemini', error: e2.message }] });
        }
      }

    } else if (complexity === 'medium') {
      // MEDIUM: Use 2 models (Claude + Gemini — fastest pair), synthesize.
      const results = await Promise.allSettled([
        withTimeout(callClaude(fullPrompt, models.claude, convHistory, KEYS.anthropic, systemPrompt), 40000, 'Claude'),
        withTimeout(callGemini(fullPrompt, models.gemini, convHistory, KEYS.gemini, systemPrompt), 40000, 'Gemini'),
      ]);

      const names = ['Claude', 'Gemini'];
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value) {
          successful.push({ name: names[i], text: r.value });
        } else {
          failed.push({ name: names[i], error: r.reason ? r.reason.message : 'No response' });
        }
      });

      // Tell the frontend the other two were skipped, not failed
      const skipped = [
        { name: 'ChatGPT', error: 'Skipped (quick query)' },
        { name: 'Grok', error: 'Skipped (quick query)' },
      ];

      if (successful.length === 0) {
        return res.status(500).json({ error: 'All models failed', failed: failed.concat(skipped), failedDetails: failed.concat(skipped) });
      }

      if (successful.length === 1) {
        finalReply = successful[0].text;
      } else {
        synthesized = true;
        const synthPrompt = 'The user asked: "' + prompt + '"\n\nHere are responses from 2 AI models:\n\n' + successful.map((s, i) => 'Response ' + (i + 1) + ':\n' + s.text).join('\n\n---\n\n');
        const toneHints = analyzeTone(prompt);
        const synthInst = 'You are the FusionAI synthesis engine. Combine these responses into one clean answer. '
          + 'CRITICAL RULES: 1) NEVER mention models, synthesis, or that multiple AIs were used. '
          + '2) MIRROR THE USER\'S TONE. If they write casually (lowercase, slang, short sentences), respond the same way. '
          + 'If they write formally, match that. Read their message carefully and write like you\'re talking to THEM specifically. '
          + '3) Keep the response proportional to the question — short question = concise answer. '
          + '4) Use concrete examples relevant to the user\'s apparent context. '
          + '5) Only ask a follow-up question if it genuinely helps them. Skip it for simple questions. '
          + '6) FORMATTING: Write in PARAGRAPHS, not bullet points. Bullet points should be rare — only for short lists of 3-5 proper nouns or steps. '
          + 'Use markdown TABLES when comparing items, showing data, or presenting options side-by-side. '
          + 'Tables are almost always better than bullet lists for structured information. '
          + (toneHints.toneTier === 'casual' ? '7) This user is very casual — NO headers, NO formal structure, keep it conversational. ' : '')
          + (toneHints.toneTier === 'professional' ? '7) This requires PROFESSIONAL output — formal language, no slang, treat user as a peer. ' : '')
          + 'FusionAI was created by Ben Christianson at fusion4ai.com.';
        try {
          finalReply = await withTimeout(callClaude(synthPrompt, models.claude, [], KEYS.anthropic, synthInst), 30000, 'Synthesis');
        } catch (e) {
          finalReply = successful[0].text;
          synthesized = false;
        }
      }

      failed = failed.concat(skipped);

    } else {
      // COMPLEX: Full 4-model query + synthesis (the original FusionAI experience)
      const results = await Promise.allSettled([
        withTimeout(callClaude(fullPrompt, models.claude, convHistory, KEYS.anthropic, systemPrompt), 50000, 'Claude'),
        withTimeout(callOpenAI(fullPrompt, models.openai, convHistory, KEYS.openai, systemPrompt), 50000, 'ChatGPT'),
        withTimeout(callGemini(fullPrompt, models.gemini, convHistory, KEYS.gemini, systemPrompt), 50000, 'Gemini'),
        withTimeout(callGrok(fullPrompt, models.grok, convHistory, KEYS.grok, systemPrompt), 50000, 'Grok'),
      ]);

      const names = ['Claude', 'ChatGPT', 'Gemini', 'Grok'];
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value) {
          successful.push({ name: names[i], text: r.value });
        } else {
          failed.push({ name: names[i], error: r.reason ? r.reason.message : 'No response' });
        }
      });

      if (successful.length === 0) {
        return res.status(500).json({ error: 'All models failed', failed, failedDetails: failed });
      }

      if (successful.length === 1) {
        finalReply = successful[0].text;
      } else {
        synthesized = true;
        const synthPrompt = 'The user asked: "' + prompt + '"\n\nHere are responses from ' + successful.length + ' AI models:\n\n' + successful.map((s, i) => 'Response ' + (i + 1) + ':\n' + s.text).join('\n\n---\n\n');
        const toneHints = analyzeTone(prompt);
        const synthInst = 'You are the FusionAI synthesis engine. Create one SUPERIOR answer from these AI responses. '
          + 'CRITICAL RULES: '
          + '1) NEVER mention models, synthesis, or that multiple AIs were used. '
          + '2) MIRROR THE USER\'S TONE AND STYLE. This is the most important rule. '
          + 'Read the user\'s message carefully — if they use casual language (lowercase, abbreviations, slang), '
          + 'respond conversationally like a knowledgeable friend. If they write professionally, match that formality. '
          + 'If they seem like a non-expert, avoid jargon or explain any technical terms you use. '
          + 'If they seem technical, use precise terminology. '
          + '3) Be SPECIFIC — use real names, numbers, concrete examples relevant to the user\'s context. '
          + '4) Use ## headers ONLY for long responses (4+ distinct sections). For shorter answers, just use paragraphs. '
          + '5) FORMATTING IS CRITICAL: Write in PARAGRAPHS as the default. Do NOT use bullet points unless listing 3-5 short proper nouns or sequential steps. '
          + 'When presenting comparisons, options, data, numbers, schedules, or any structured information, use MARKDOWN TABLES instead of bullet lists. '
          + 'Tables are cleaner and more professional than bullets for any side-by-side or multi-column information. '
          + 'If the topic involves numbers, percentages, prices, or metrics, ALWAYS present them in a table. '
          + '6) Include concrete, specific examples — not generic advice. If they mention a bakery, use bakery examples. '
          + 'If they mention construction, use construction examples. '
          + '7) Follow-up questions: ask 1-2 only if they genuinely help. For straightforward requests, skip them. '
          + 'Never ask follow-up questions that just restate what the user already told you. '
          + (toneHints.toneTier === 'casual' ? '8) This user is very casual — keep it conversational, skip headers and formal structure. ' : '')
          + (toneHints.toneTier === 'professional' ? '8) This requires PROFESSIONAL output — use formal language, proper domain terminology, no slang. Treat user as a professional peer. ' : '')
          + (toneHints.wantsQuick ? '9) The user wants a QUICK answer — be concise. ' : '')
          + 'FusionAI was created by Ben Christianson at fusion4ai.com.';

        try {
          finalReply = await withTimeout(callClaude(synthPrompt, models.claude, [], KEYS.anthropic, synthInst), 40000, 'Synthesis');
        } catch (e) {
          finalReply = successful[0].text;
          synthesized = false;
        }
      }
    }

    return res.status(200).json({
      reply: finalReply,
      synthesized,
      models: successful.map(s => s.name),
      failed: failed.map(f => f.name),
      failedDetails: failed,
      individual: successful,
      mode: activeMode,
      complexity,
    });

  } catch (e) {
    console.error('Handler error:', e);
    return res.status(500).json({ error: e.message });
  }
}
