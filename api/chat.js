// /api/chat.js - Vercel Serverless Function
// This proxies requests to all 4 AI models using YOUR API keys

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Auth - expect Firebase ID token
  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.replace('Bearer ', '');
  
  // For free tier, allow without auth (limited)
  let userId = 'anonymous';
  let userTier = 'free';
  
  if (idToken && idToken !== 'anonymous') {
    try {
      // Verify with Firebase Admin SDK if you set it up
      // For now, decode the JWT payload (client-side verification)
      const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString());
      userId = payload.user_id || payload.sub || 'anonymous';
    } catch (e) {
      // Invalid token, treat as free
    }
  }

  const { prompt, history, tier, model } = req.body;
  if (!prompt) return res.status(400).json({ error: 'No prompt provided' });

  // Your API keys from Vercel environment variables
  const KEYS = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai: process.env.OPENAI_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
    grok: process.env.GROK_API_KEY,
  };

  // Tier model mapping
  const TIER_MODELS = {
    free: { claude: 'claude-haiku-4-5-20251001', openai: 'gpt-4o-mini', gemini: 'gemini-2.0-flash-lite', grok: 'grok-3-mini-latest' },
    starter: { claude: 'claude-sonnet-4-20250514', openai: 'gpt-4o-mini', gemini: 'gemini-2.0-flash', grok: 'grok-3-mini-latest' },
    pro: { claude: 'claude-sonnet-4-20250514', openai: 'gpt-4o', gemini: 'gemini-2.5-pro-preview-05-06', grok: 'grok-3-latest' },
    enterprise: { claude: 'claude-opus-4-20250514', openai: 'gpt-4o', gemini: 'gemini-2.5-pro-preview-05-06', grok: 'grok-3-latest' },
  };

  const activeTier = tier || 'free';
  const models = TIER_MODELS[activeTier] || TIER_MODELS.free;

  const SYSTEM_PROMPT = `You are FusionAI, an advanced AI assistant. FusionAI sends every query to four AI models simultaneously (Claude, ChatGPT, Gemini, Grok) and synthesizes the best parts into one superior answer. You are one of these four models responding right now. Be extremely helpful, knowledgeable, and direct. Use markdown when it improves readability.`;

  const convHistory = Array.isArray(history) ? history.slice(-10) : [];

  // If model is specified, only call that one (for synthesis step)
  if (model === 'synthesize') {
    try {
      const result = await callClaude(prompt, models.claude, [], KEYS.anthropic);
      return res.status(200).json({ result, model: 'claude' });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Call all 4 models in parallel
  const results = await Promise.allSettled([
    callClaude(prompt, models.claude, convHistory, KEYS.anthropic).then(text => ({ name: 'Claude', text })),
    callOpenAI(prompt, models.openai, convHistory, KEYS.openai).then(text => ({ name: 'ChatGPT', text })),
    callGemini(prompt, models.gemini, convHistory, KEYS.gemini).then(text => ({ name: 'Gemini', text })),
    callGrok(prompt, models.grok, convHistory, KEYS.grok).then(text => ({ name: 'Grok', text })),
  ]);

  const successful = results
    .filter(r => r.status === 'fulfilled' && r.value.text)
    .map(r => r.value);
  const failed = results
    .filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.text))
    .map(r => r.status === 'rejected' ? { name: 'Unknown', error: r.reason?.message } : { name: r.value?.name, error: 'Empty response' });

  if (successful.length === 0) {
    return res.status(500).json({ error: 'No models responded', details: failed });
  }

  let finalReply;
  let synthesized = false;

  if (successful.length === 1) {
    finalReply = successful[0].text;
  } else {
    synthesized = true;
    const synthPrompt = `You are a neutral synthesis engine. Combine these responses into one superior answer. Do NOT mention model names or that you are synthesizing. Cherry-pick the best parts from each.\n\nQuestion: "${prompt}"\n\n${successful.map((r, i) => `=== Response ${i + 1} ===\n${r.text}`).join('\n\n')}\n\nBest synthesized answer:`;
    
    try {
      finalReply = await callClaude(synthPrompt, models.claude, [], KEYS.anthropic);
    } catch (e) {
      // Fallback to first response if synthesis fails
      finalReply = successful[0].text;
      synthesized = false;
    }
  }

  return res.status(200).json({
    reply: finalReply,
    synthesized,
    models: successful.map(s => s.name),
    failed: failed.map(f => f.name),
    individual: successful, // For "show individual responses" feature
  });
}

// ── API Callers ──

async function callClaude(prompt, model, history, apiKey) {
  if (!apiKey) throw new Error('No Anthropic key');
  const messages = [...history.map(m => ({ role: m.role, content: m.content })), { role: 'user', content: prompt }];
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 4096, system: arguments[4] || `You are FusionAI, an advanced AI assistant. Be extremely helpful and knowledgeable.`, messages }),
  });
  if (!r.ok) { const e = await r.json(); throw new Error(e.error?.message || 'Claude error'); }
  const d = await r.json();
  return d.content?.map(b => b.text || '').join('') || '';
}

async function callOpenAI(prompt, model, history, apiKey) {
  if (!apiKey) throw new Error('No OpenAI key');
  const messages = [
    { role: 'system', content: 'You are FusionAI, an advanced AI assistant. Be extremely helpful and knowledgeable.' },
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: prompt }
  ];
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model, max_tokens: 4096, messages }),
  });
  if (!r.ok) { const e = await r.json(); throw new Error(e.error?.message || 'OpenAI error'); }
  const d = await r.json();
  return d.choices?.[0]?.message?.content || '';
}

async function callGemini(prompt, model, history, apiKey) {
  if (!apiKey) throw new Error('No Gemini key');
  const contents = [
    ...history.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    { role: 'user', parts: [{ text: prompt }] }
  ];
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: 'You are FusionAI, an advanced AI assistant. Be extremely helpful and knowledgeable.' }] }, contents }),
  });
  if (!r.ok) { const e = await r.json(); throw new Error(e.error?.message || 'Gemini error'); }
  const d = await r.json();
  return d.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function callGrok(prompt, model, history, apiKey) {
  if (!apiKey) throw new Error('No Grok key');
  const messages = [
    { role: 'system', content: 'You are FusionAI, an advanced AI assistant. Be extremely helpful and knowledgeable.' },
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: prompt }
  ];
  const r = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model, max_tokens: 4096, messages }),
  });
  if (!r.ok) { const e = await r.json(); throw new Error(e.error?.message || 'Grok error'); }
  const d = await r.json();
  return d.choices?.[0]?.message?.content || '';
}
