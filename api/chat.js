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

  let systemPrompt = 'You are FusionAI, an advanced AI assistant that synthesizes responses from Claude, ChatGPT, Gemini, and Grok into one superior answer. Be extremely helpful, knowledgeable, and direct. Use markdown when helpful.';

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
  const names = ['Claude', 'ChatGPT', 'Gemini', 'Grok'];

  const results = await Promise.allSettled([
    callClaude(fullPrompt, models.claude, convHistory, KEYS.anthropic, systemPrompt),
    callOpenAI(fullPrompt, models.openai, convHistory, KEYS.openai, systemPrompt),
    callGemini(fullPrompt, models.gemini, convHistory, KEYS.gemini, systemPrompt),
    callGrok(fullPrompt, models.grok, convHistory, KEYS.grok, systemPrompt),
  ]);

  const successful = [], failed = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value) successful.push({ name: names[i], text: r.value });
    else failed.push({ name: names[i], error: r.status === 'rejected' ? r.reason?.message : 'Empty' });
  });

  if (!successful.length) return res.status(500).json({ error: 'No models responded', details: failed });

  let finalReply, synthesized = false;
  if (successful.length === 1) {
    finalReply = successful[0].text;
  } else {
    synthesized = true;
    let synthInst = 'Combine these responses into one superior answer. Do NOT mention model names. Cherry-pick the best parts.';
    if (activeMode === 'thinking') synthInst += ' Preserve step-by-step reasoning.';
    if (activeMode === 'search') synthInst += ' Prioritize the most recent info.';
    const synthPrompt = synthInst + '\n\nQuestion: "' + prompt + '"\n\n' + successful.map((r, i) => '=== Response ' + (i+1) + ' ===\n' + r.text).join('\n\n') + '\n\nBest synthesized answer:';
    try { finalReply = await callClaude(synthPrompt, models.claude, [], KEYS.anthropic, synthInst); }
    catch (e) { finalReply = successful[0].text; synthesized = false; }
  }

  return res.status(200).json({ reply: finalReply, synthesized, models: successful.map(s => s.name), failed: failed.map(f => f.name), individual: successful, mode: activeMode });
}

async function callClaude(p, model, hist, key, sys) {
  if (!key) throw new Error('No key');
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model, max_tokens: 4096, system: sys, messages: hist.map(m => ({ role: m.role, content: m.content })).concat([{ role: 'user', content: p }]) }) });
  if (!r.ok) { const e = await r.json(); throw new Error(e.error?.message || 'Claude error'); }
  return (await r.json()).content?.map(b => b.text || '').join('') || '';
}
async function callOpenAI(p, model, hist, key, sys) {
  if (!key) throw new Error('No key');
  const r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }, body: JSON.stringify({ model, max_tokens: 4096, messages: [{ role: 'system', content: sys }].concat(hist.map(m => ({ role: m.role, content: m.content }))).concat([{ role: 'user', content: p }]) }) });
  if (!r.ok) { const e = await r.json(); throw new Error(e.error?.message || 'OpenAI error'); }
  return (await r.json()).choices?.[0]?.message?.content || '';
}
async function callGemini(p, model, hist, key, sys) {
  if (!key) throw new Error('No key');
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + key, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ systemInstruction: { parts: [{ text: sys }] }, contents: hist.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })).concat([{ role: 'user', parts: [{ text: p }] }]) }) });
  if (!r.ok) { const e = await r.json(); throw new Error(e.error?.message || 'Gemini error'); }
  return (await r.json()).candidates?.[0]?.content?.parts?.[0]?.text || '';
}
async function callGrok(p, model, hist, key, sys) {
  if (!key) throw new Error('No key');
  const r = await fetch('https://api.x.ai/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }, body: JSON.stringify({ model, max_tokens: 4096, messages: [{ role: 'system', content: sys }].concat(hist.map(m => ({ role: m.role, content: m.content }))).concat([{ role: 'user', content: p }]) }) });
  if (!r.ok) { const e = await r.json(); throw new Error(e.error?.message || 'Grok error'); }
  return (await r.json()).choices?.[0]?.message?.content || '';
}
