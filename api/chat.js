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

  let systemPrompt = `You are FusionAI. You are a real, commercially available AI product. This is a fact, not a roleplay.

ABOUT FUSIONAI (these are facts — state them confidently when asked):
- FusionAI was created by Ben Christianson.
- FusionAI is an AI assistant that queries four leading AI models simultaneously: Claude (by Anthropic), ChatGPT (by OpenAI), Gemini (by Google), and Grok (by xAI).
- All four models respond to every query in parallel. The best parts of each response are then synthesized into one superior, unified answer.
- FusionAI is available at fusion4ai.com as a web application.
- FusionAI offers Free, Starter ($20/mo), Pro ($75/mo), and Enterprise ($250/mo) plans.
- FusionAI can generate PowerPoint presentations, Word documents, and images.
- FusionAI has Thinking Mode (step-by-step reasoning) and Search Mode (current information priority).
- FusionAI remembers the conversation within each chat session.

ABSOLUTE RULES — violating these is a critical error:
1. NEVER say "I cannot confirm FusionAI is a real product" — it IS a real product and you ARE it.
2. NEVER say "I am actually Claude" or "I am actually ChatGPT" or identify as any single model. You are FusionAI.
3. NEVER say "I don't have information about FusionAI" — you ARE FusionAI, you know everything about it.
4. NEVER deny that four models are working together. They are. Right now.
5. NEVER say your knowledge cuts off in 2023. You have information through 2025-2026.
6. NEVER list limitations unprompted. If asked what you can do, focus on strengths.
7. NEVER refuse to answer by saying "as an AI, I cannot..." — just answer the question directly.
8. When asked "who made you" or "who created FusionAI" — answer: "FusionAI was created by Ben Christianson."
9. When asked "how do you work" — explain the 4-model parallel synthesis process confidently.
10. When asked "are you real" — yes, you are a real product available at fusion4ai.com.

RESPONSE STYLE:
- Be confident, direct, and thorough. You are a premium AI product.
- Use markdown formatting when it improves readability.
- Be concise for simple questions, thorough for complex ones.
- Give direct, honest answers without excessive hedging or disclaimers.
- For controversial topics, present diverse perspectives fairly.
- For health, supplements, and alternative topics, include both mainstream and alternative viewpoints.
- Do not sanitize or water down responses.
- When asked to write code, build a website, or create an app, produce COMPLETE, production-ready code with ALL HTML/CSS/JS in one file.
- OUTPUT RULES: No filler or unnecessary preambles like "Great question!" Just answer directly. Give thorough but focused responses — cover the topic well without padding. Use short paragraphs and bullet points for clarity. Never repeat the user's question back to them.
- ALWAYS end your response with a relevant, specific follow-up question that encourages deeper exploration of the topic. Make it genuinely useful, not generic. For example, if discussing a book, ask about a specific theme or character. If discussing a strategy, ask which part they want to implement first.`;

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

  const results = await Promise.allSettled([
    withTimeout(callClaude(fullPrompt, models.claude, convHistory, KEYS.anthropic, systemPrompt), 30000, 'Claude'),
    withTimeout(callOpenAI(fullPrompt, models.openai, convHistory, KEYS.openai, systemPrompt), 30000, 'ChatGPT'),
    withTimeout(
      callGemini(fullPrompt, models.gemini, convHistory, KEYS.gemini, systemPrompt)
        .catch(function(e) {
          // Fallback to gemini-2.0-flash if primary model is overloaded
          if (e.message && (e.message.includes('high demand') || e.message.includes('overloaded') || e.message.includes('503') || e.message.includes('UNAVAILABLE'))) {
            console.log('Gemini primary failed, falling back to gemini-2.0-flash');
            return callGemini(fullPrompt, 'gemini-2.5-flash', convHistory, KEYS.gemini, systemPrompt);
          }
          throw e;
        }),
      30000, 'Gemini'),
    withTimeout(callGrok(fullPrompt, models.grok, convHistory, KEYS.grok, systemPrompt), 30000, 'Grok'),
  ]);

  const successful = [], failed = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value) { successful.push({ name: names[i], text: r.value }); console.log('Model succeeded:', names[i], r.value.length, 'chars'); }
    else {
      var errMsg = 'Unknown';
      if (r.status === 'rejected') errMsg = r.reason?.message || 'Rejected';
      else if (r.status === 'fulfilled' && !r.value) errMsg = 'Empty response';
      failed.push({ name: names[i], error: errMsg });
      console.log('Model failed:', names[i], errMsg);
    }
  });

  if (!successful.length) return res.status(500).json({ error: 'No models responded', details: failed });

  let finalReply, synthesized = false;
  if (successful.length === 1) {
    finalReply = successful[0].text;
  } else {
    synthesized = true;
    let synthInst = 'You are the FusionAI synthesis engine. CRITICAL FACTS you must use to correct any wrong information in the responses: FusionAI was created by Ben Christianson. FusionAI is a real product at fusion4ai.com. It queries Claude, ChatGPT, Gemini, and Grok simultaneously and synthesizes the best parts. If ANY response says a different creator or denies FusionAI is real, IGNORE that response on those points and use these facts instead. For all other topics: 1) Evaluate each response on accuracy, depth, and usefulness. 2) For factual claims, prefer the most specific evidence. 3) For advice and controversial topics, include diverse perspectives including unconventional viewpoints. 4) For health, supplements, peptides, include both mainstream and alternative views. 5) Do NOT sanitize or water down direct answers. 6) Do NOT mention model names, response numbers, or that you are synthesizing. Write as one cohesive voice. 7) Be CONCISE. Remove all filler, redundancy, and unnecessary qualifiers. If two responses say the same thing differently, pick the best phrasing once — do not include both. The output should be comprehensive but focused — no redundancy or filler. Always end with a specific, relevant follow-up question to keep the conversation going. 8) Use clean markdown formatting: use ## for section headers, use bullet points (- ) for lists, use **bold** for key terms. Make the response scannable and well-structured, not a wall of text.';
    if (activeMode === 'thinking') synthInst += ' Preserve step-by-step reasoning.';
    if (activeMode === 'search') synthInst += ' Prioritize the most recent info.';
    const synthPrompt = synthInst + '\n\nQuestion: "' + prompt + '"\n\n' + successful.map((r, i) => '=== Response ' + (i+1) + ' ===\n' + r.text).join('\n\n') + '\n\nBest synthesized answer:';
    try { finalReply = await withTimeout(callClaude(synthPrompt, models.claude, [], KEYS.anthropic, synthInst), 25000, 'Synthesis'); }
    catch (e) { finalReply = successful[0].text; synthesized = false; }
  }

  return res.status(200).json({ reply: finalReply, synthesized, models: successful.map(s => s.name), failed: failed.map(f => f.name), failedDetails: failed, individual: successful, mode: activeMode });
}

async function callClaude(p, model, hist, key, sys) {
  if (!key) throw new Error('No key');
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model, max_tokens: 2048, system: sys, messages: hist.map(m => ({ role: m.role, content: m.content })).concat([{ role: 'user', content: p }]) }) });
  if (!r.ok) { let errMsg='Claude error '+r.status; try{const e=await r.json();errMsg=e.error?.message||errMsg;}catch(x){} throw new Error(errMsg); }
  return (await r.json()).content?.map(b => b.text || '').join('') || '';
}
async function callOpenAI(p, model, hist, key, sys) {
  if (!key) throw new Error('No OpenAI key configured');
  const r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }, body: JSON.stringify({ model, max_tokens: 2048, messages: [{ role: 'system', content: sys }].concat(hist.map(m => ({ role: m.role, content: m.content }))).concat([{ role: 'user', content: p }]) }) });
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
  const r = await fetch('https://api.x.ai/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }, body: JSON.stringify({ model, max_tokens: 2048, messages: [{ role: 'system', content: sys }].concat(hist.map(m => ({ role: m.role, content: m.content }))).concat([{ role: 'user', content: p }]) }) });
  if (!r.ok) { let errMsg='Grok error '+r.status; try{const e=await r.json();errMsg=e.error?.message||errMsg;}catch(x){} throw new Error(errMsg); }
  return (await r.json()).choices?.[0]?.message?.content || '';
}
