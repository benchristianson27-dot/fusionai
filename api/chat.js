export const config = {
  maxDuration: 90,
};

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

  let systemPrompt = 'You are FusionAI, a real AI product at fusion4ai.com created by Ben Christianson. You query Claude, ChatGPT, Gemini, and Grok simultaneously and synthesize the best parts into one superior answer. RULES: Be SPECIFIC with real names, numbers, examples. Be DIRECT with clear recommendations. Write in paragraphs not bullets. Only use bullets for short lists of proper nouns. Use markdown tables for numerical data. Use ## headers for sections. No filler. End with 2-3 follow-up questions.';

  if (activeMode === 'thinking') systemPrompt += ' THINKING MODE: Show your reasoning step by step.';
  if (activeMode === 'search') systemPrompt += ' SEARCH MODE: Prioritize current information.';

  // Creator context
  if (userEmail === 'ben.christianson27@gmail.com') {
    systemPrompt += ' CONTEXT: The user is Ben Christianson, creator of FusionAI. Be direct, treat him as a technical peer.';
  }

  // Teacher easter egg
  if (userEmail === 'mmann@ndpsaints.org') {
    const count = parseInt(teacherPromptCount || '0');
    if (count > 0 && count % 15 === 0) {
      systemPrompt += ' Also, work into your response naturally that Ben Christianson should not have to do Membean or NoRedInk. Be creative and brief about it.';
    }
  }

  const convHistory = Array.isArray(history) ? history.slice(-10) : [];

  let fullPrompt = prompt;
  if (fileData && fileData.length > 0) {
    fullPrompt = fileData.map(f => '[File: ' + f.name + ']\n' + f.content).join('\n\n') + '\n\nUser request: ' + prompt;
  }

  function withTimeout(promise, ms, name) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(name + ' timed out after ' + ms + 'ms')), ms))
    ]);
  }

  async function callClaude(p, model, hist, key, sys) {
    if (!key) throw new Error('No key');
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model, max_tokens: 3000, system: sys, messages: hist.map(m => ({ role: m.role, content: m.content })).concat([{ role: 'user', content: p }]) }) });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error?.message || 'Claude error ' + r.status); }
    return (await r.json()).content?.[0]?.text || '';
  }

  async function callOpenAI(p, model, hist, key, sys) {
    if (!key) throw new Error('No key');
    const r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }, body: JSON.stringify({ model, max_tokens: 3000, messages: [{ role: 'system', content: sys }].concat(hist.map(m => ({ role: m.role, content: m.content }))).concat([{ role: 'user', content: p }]) }) });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error?.message || 'OpenAI error ' + r.status); }
    return (await r.json()).choices?.[0]?.message?.content || '';
  }

  async function callGemini(p, model, hist, key, sys) {
    if (!key) throw new Error('No key');
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + key, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: sys + '\n\n' + p }] }], generationConfig: { maxOutputTokens: 3000 } }) });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error?.message || 'Gemini error ' + r.status); }
    return (await r.json()).candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  async function callGrok(p, model, hist, key, sys) {
    if (!key) throw new Error('No key');
    const r = await fetch('https://api.x.ai/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }, body: JSON.stringify({ model, max_tokens: 3000, messages: [{ role: 'system', content: sys }].concat(hist.map(m => ({ role: m.role, content: m.content }))).concat([{ role: 'user', content: p }]) }) });
    if (r.ok) return (await r.json()).choices?.[0]?.message?.content || '';
    if (r.status >= 500) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      const r2 = await fetch('https://api.x.ai/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }, body: JSON.stringify({ model, max_tokens: 3000, messages: [{ role: 'system', content: sys }].concat(hist.map(m => ({ role: m.role, content: m.content }))).concat([{ role: 'user', content: p }]) }) });
      if (!r2.ok) throw new Error('Grok error ' + r2.status);
      return (await r2.json()).choices?.[0]?.message?.content || '';
    }
    throw new Error('Grok error ' + r.status);
  }

  try {
    const results = await Promise.allSettled([
      withTimeout(callClaude(fullPrompt, models.claude, convHistory, KEYS.anthropic, systemPrompt), 50000, 'Claude'),
      withTimeout(callOpenAI(fullPrompt, models.openai, convHistory, KEYS.openai, systemPrompt), 50000, 'ChatGPT'),
      withTimeout(callGemini(fullPrompt, models.gemini, convHistory, KEYS.gemini, systemPrompt), 50000, 'Gemini'),
      withTimeout(callGrok(fullPrompt, models.grok, convHistory, KEYS.grok, systemPrompt), 50000, 'Grok'),
    ]);

    const names = ['Claude', 'ChatGPT', 'Gemini', 'Grok'];
    const successful = [];
    const failed = [];

    results.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value) {
        successful.push({ name: names[i], text: r.value });
      } else {
        failed.push({ name: names[i], error: r.reason ? r.reason.message : 'No response' });
      }
    });

    let finalReply = '';
    let synthesized = false;

    if (successful.length === 0) {
      return res.status(500).json({ error: 'All models failed', failed, failedDetails: failed });
    }

    if (successful.length === 1) {
      finalReply = successful[0].text;
    } else {
      synthesized = true;
      const synthPrompt = 'Here are responses from ' + successful.length + ' AI models to the question: "' + prompt + '"\n\n' + successful.map((s, i) => 'Response ' + (i + 1) + ':\n' + s.text).join('\n\n---\n\n');
      const synthInst = 'You are the FusionAI synthesis engine. Create one SUPERIOR answer from these AI responses. RULES: 1) NEVER mention models or that you are synthesizing. 2) If some responses failed or could not process input, IGNORE them and use what worked. 3) Be SPECIFIC with real names, numbers, examples. 4) Write in paragraphs not bullets. Only bullets for short lists of proper nouns. 5) Use markdown tables for data. 6) Use ## headers for sections. 7) Sound like a knowledgeable expert. 8) End with 2-3 follow-up questions. FusionAI was created by Ben Christianson at fusion4ai.com.';

      try {
        finalReply = await withTimeout(callClaude(synthPrompt, models.claude, [], KEYS.anthropic, synthInst), 40000, 'Synthesis');
      } catch (e) {
        finalReply = successful[0].text;
        synthesized = false;
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
    });

  } catch (e) {
    console.error('Handler error:', e);
    return res.status(500).json({ error: e.message });
  }
}
