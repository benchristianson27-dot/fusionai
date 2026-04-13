export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { prompt, history, tier, mode, fileData } = req.body;
  if (!prompt) return res.status(400).json({ error: 'No prompt provided' });

  const KEYS = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai: process.env.OPENAI_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
    grok: process.env.GROK_API_KEY,
  };

  const TIER_MODELS = {
    free: { claude: 'claude-haiku-4-5-20251001', openai: 'gpt-4o-mini', gemini: 'gemini-2.5-flash-lite', grok: 'grok-3-mini-latest' },
    starter: { claude: 'claude-sonnet-4-20250514', openai: 'gpt-4o-mini', gemini: 'gemini-2.5-flash', grok: 'grok-3-mini-latest' },
    pro: { claude: 'claude-sonnet-4-20250514', openai: 'gpt-4o', gemini: 'gemini-2.5-pro', grok: 'grok-3-latest' },
    enterprise: { claude: 'claude-opus-4-20250514', openai: 'gpt-4o', gemini: 'gemini-2.5-pro', grok: 'grok-3-latest' },
  };

  const models = TIER_MODELS[tier] || TIER_MODELS.free;
  const activeMode = mode || 'normal';

  let systemPrompt = `You are FusionAI. This is a real, live product — not a simulation or roleplay. You are an advanced AI assistant powered by four AI models (Claude, ChatGPT, Gemini, Grok) working simultaneously. The user's query goes to all four models in parallel, and the best parts of each response are synthesized into one superior answer.

CRITICAL RULES — follow these exactly:
- You ARE FusionAI. Never say "I'm just one AI" or deny that four models are working together.
- You DO have conversation memory within the current chat session. The last 10 messages are sent with every request.
- You have knowledge up to 2025-2026. Never say your knowledge stops at 2023.
- When in Search Mode, you prioritize the most current information available.
- When in Thinking Mode, you reason step-by-step before answering.
- Never list your limitations unprompted. Just answer the question directly.
- If asked what you can do, focus on your STRENGTHS: multi-model synthesis, conversation memory, thinking mode, search mode, code generation, creative writing, analysis, and more.
- Never say you cannot browse the internet, create files, or process uploads unless specifically asked about those features.
- Give confident, direct, thorough answers. You are a premium AI product — act like it.
- Use markdown formatting when it improves readability.
- You CAN create PowerPoint presentations (.pptx) and Word documents (.docx). When a user asks for a presentation, slides, or document, the system will automatically generate and download the actual file.
- Be concise when the question is simple. Be thorough when the question is complex.
- Give direct, honest answers. Do not hedge excessively or add unnecessary disclaimers.
- For controversial or alternative topics, present information fairly without reflexively dismissing unconventional viewpoints.
- Include diverse perspectives on debatable topics rather than defaulting to one mainstream narrative.`;

  if (activeMode === 'thinking') {
    systemPrompt += '\n\nThe user has enabled Thinking Mode. Think through the problem step-by-step. Show your reasoning process clearly. Break down complex problems. Consider multiple angles. Then provide your thorough, well-reasoned answer.';
  }
  if (activeMode === 'search') {
    systemPrompt += '\n\nThe user has enabled Web Search Mode. Provide the most current, up-to-date information possible. Include specific dates, sources, and facts. If unsure about recency, acknowledge your knowledge cutoff date.';
  }

  let fullPrompt = prompt;
  if (fileData && fileData.length > 0) {
    fullPrompt = fileData.map(f => '[File: ' + f.name + ']\n' + f.content).join('\n\n') + '\n\n' + prompt;
  }

  const convHistory = Array.isArray(history) ? history.slice(-10) : [];
  
function withTimeout(promise, ms, name) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(name + ' timed out after ' + ms + 'ms')), ms))
  ]);
}

const names = ['Claude', 'ChatGPT', 'Gemini', 'Grok'];

  // Call all 4 models - 25s timeout, quick retry on server errors only
  async function callWithRetry(fn, args, name) {
    try {
      return await withTimeout(fn(...args), 25000, name);
    } catch (e) {
      if (e.message.includes('500') || e.message.includes('502') || e.message.includes('503') || e.message.includes('529')) {
        return await withTimeout(fn(...args), 15000, name);
      }
      throw e;
    }
  }
  
  const results = await Promise.allSettled([
    callWithRetry(callClaude, [fullPrompt, models.claude, convHistory, KEYS.anthropic, systemPrompt], 'Claude'),
    callWithRetry(callOpenAI, [fullPrompt, models.openai, convHistory, KEYS.openai, systemPrompt], 'ChatGPT'),
    callWithRetry(callGemini, [fullPrompt, models.gemini, convHistory, KEYS.gemini, systemPrompt], 'Gemini'),
    callWithRetry(callGrok, [fullPrompt, models.grok, convHistory, KEYS.grok, systemPrompt], 'Grok'),
  ]);

  const successful = [], failed = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value) successful.push({ name: names[i], text: r.value });
    else failed.push({ name: names[i], error: r.status === 'rejected' ? (r.reason?.message || 'Unknown error') : 'Empty response' });
  });

  if (!successful.length) return res.status(500).json({ error: 'No models responded', details: failed });

  let finalReply, synthesized = false;
  if (successful.length === 1) {
    finalReply = successful[0].text;
  } else {
    synthesized = true;
    let synthInst = 'You are an unbiased synthesis engine. Your job is to create one superior answer by objectively evaluating ALL responses on their merits. Rules: 1) Evaluate each response independently on accuracy, depth, and usefulness — do NOT favor any particular response position (1st, 2nd, 3rd, 4th). 2) For factual claims, prefer the response with the most specific evidence or data. 3) For advice, opinions, and controversial topics, include diverse perspectives — especially unconventional or contrarian viewpoints that challenge mainstream narratives if they are well-reasoned. 4) For health, supplements, peptides, and similar topics, include both mainstream medical views AND alternative perspectives with appropriate context. 5) Do NOT sanitize or water down responses — if a response gives a direct, honest answer, preserve that directness. 6) Do NOT mention model names, response numbers, or that you are synthesizing. Write as one cohesive voice.';
    if (activeMode === 'thinking') synthInst += ' Preserve step-by-step reasoning.';
    if (activeMode === 'search') synthInst += ' Prioritize the most recent info.';
    const synthPrompt = synthInst + '\n\nQuestion: "' + prompt + '"\n\n' + successful.map((r, i) => '=== Response ' + (i+1) + ' ===\n' + r.text).join('\n\n') + '\n\nBest synthesized answer:';
    try { finalReply = await callClaude(synthPrompt, models.claude, [], KEYS.anthropic, synthInst); }
    catch (e) { finalReply = successful[0].text; synthesized = false; }
  }

  return res.status(200).json({ reply: finalReply, synthesized, models: successful.map(s => s.name), failed: failed.map(f => f.name), failedDetails: failed, individual: successful, mode: activeMode });
}

async function callClaude(p, model, hist, key, sys) {
  if (!key) throw new Error('No key');
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model, max_tokens: 4096, system: sys, messages: hist.map(m => ({ role: m.role, content: m.content })).concat([{ role: 'user', content: p }]) }) });
  if (!r.ok) { let errMsg='Claude error '+r.status; try{const e=await r.json();errMsg=e.error?.message||errMsg;}catch(x){} throw new Error(errMsg); }
  return (await r.json()).content?.map(b => b.text || '').join('') || '';
}
async function callOpenAI(p, model, hist, key, sys) {
  if (!key) throw new Error('No OpenAI key configured');
  const r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }, body: JSON.stringify({ model, max_tokens: 4096, messages: [{ role: 'system', content: sys }].concat(hist.map(m => ({ role: m.role, content: m.content }))).concat([{ role: 'user', content: p }]) }) });
  if (!r.ok) { let errMsg='OpenAI error '+r.status; try{const e=await r.json();errMsg=e.error?.message||errMsg;}catch(x){} throw new Error(errMsg); }
  return (await r.json()).choices?.[0]?.message?.content || '';
}
async function callGemini(p, model, hist, key, sys) {
  if (!key) throw new Error('No Gemini key configured');
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + key, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ systemInstruction: { parts: [{ text: sys }] }, contents: hist.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })).concat([{ role: 'user', parts: [{ text: p }] }]) }) });
  if (!r.ok) { let errMsg='Gemini error '+r.status; try{const e=await r.json();errMsg=e.error?.message||errMsg;}catch(x){} throw new Error(errMsg); }
  return (await r.json()).candidates?.[0]?.content?.parts?.[0]?.text || '';
}
async function callGrok(p, model, hist, key, sys) {
  if (!key) throw new Error('No key');
  const r = await fetch('https://api.x.ai/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }, body: JSON.stringify({ model, max_tokens: 4096, messages: [{ role: 'system', content: sys }].concat(hist.map(m => ({ role: m.role, content: m.content }))).concat([{ role: 'user', content: p }]) }) });
  if (!r.ok) { let errMsg='Grok error '+r.status; try{const e=await r.json();errMsg=e.error?.message||errMsg;}catch(x){} throw new Error(errMsg); }
  return (await r.json()).choices?.[0]?.message?.content || '';
}
