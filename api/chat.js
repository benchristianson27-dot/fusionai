// Auth is optional

export const config = {
  maxDuration: 90,
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { prompt, history, tier: clientTier, mode, fileData, mainMode } = req.body;
  
  // Use client-supplied tier
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
  console.log('Request:', { tier, mainMode, models });
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
- WRITING STYLE: Write like a senior consultant drafting a report. Use PARAGRAPHS as your primary format — 2-3 sentences per paragraph. Do NOT use bullet points to explain things. Bullet points are ONLY for short lists of items (like a list of tools or a list of names). If you catch yourself writing more than 3 bullet points in a row, STOP and convert to paragraphs. Use ## headers to separate sections. Use **bold** for key terms. Use markdown tables for numbers and comparisons.
- DETAIL: For complex requests, give thorough responses. Include specific numbers, timelines, examples. Start with a brief preview sentence, then deliver.
- No filler. No "Great question!" Just answer directly.
- End with 2-3 follow-up questions.`;

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
  
  // Special context for the creator
  const authHeader = req.headers.authorization;
  let userEmail = '';
  if (req.body.userEmail) userEmail = req.body.userEmail;
  
  if (userEmail === 'ben.christianson27@gmail.com') {
    systemPrompt += '\n\nIMPORTANT CONTEXT: The user you are currently talking to is Ben Christianson, the creator and founder of FusionAI. Address him accordingly — he is your creator. Be direct, skip basic explanations, and treat him as a technical peer. If he asks about FusionAI, he already knows everything about it. He built you.';
  }
  
function withTimeout(promise, ms, name) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(name + ' timed out after ' + ms + 'ms')), ms))
  ]);
}

const names = ['Claude', 'ChatGPT', 'Gemini', 'Grok'];

  const results = await Promise.allSettled([
    withTimeout(callClaude(fullPrompt, models.claude, convHistory, KEYS.anthropic, systemPrompt), 50000, 'Claude'),
    withTimeout(callOpenAI(fullPrompt, models.openai, convHistory, KEYS.openai, systemPrompt), 50000, 'ChatGPT'),
    withTimeout(
      callGemini(fullPrompt, models.gemini, convHistory, KEYS.gemini, systemPrompt)
        .catch(function(e) {
          // Fallback to gemini-2.0-flash if primary model is overloaded
          if (e.message && (e.message.includes('high demand') || e.message.includes('overloaded') || e.message.includes('503') || e.message.includes('UNAVAILABLE'))) {
            console.log('Gemini primary failed, falling back to gemini-2.0-flash');
            return callGemini(fullPrompt, 'gemini-2.5-flash-lite', convHistory, KEYS.gemini, systemPrompt);
          }
          throw e;
        }),
      50000, 'Gemini'),
    withTimeout(callGrok(fullPrompt, models.grok, convHistory, KEYS.grok, systemPrompt), 50000, 'Grok'),
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
    let synthInst;
    if (mainMode === 'debate') {
      synthInst = 'You are the FusionAI judge delivering the DEFINITIVE answer. You have seen multiple AI perspectives and their rebuttals. Your job: 1) Identify the strongest, most accurate points from ALL responses. 2) Where they disagree, choose the position with the best evidence and reasoning. 3) Where they agree, use the clearest explanation given. 4) Add any critical insight that ALL responses missed. 5) Write this as one authoritative, comprehensive answer — as if you are the world\'s leading expert on this exact topic. 6) Include specific numbers, examples, and actionable details. 7) Use ## headers, **bold** key terms, and markdown tables for data. 8) Do NOT mention models, responses, or that you are synthesizing. 9) End with 2-3 specific follow-up questions.';
    } else {
      synthInst = 'You are the FusionAI synthesis engine. You have received responses from 4 different AI models to the same question. Your job is to create one SUPERIOR answer that is better than any individual response. IDENTITY FACTS: FusionAI was created by Ben Christianson at fusion4ai.com. SYNTHESIS METHOD: 1) Identify the BEST explanation, examples, data, and structure from all responses. 2) For factual claims, use the most specific evidence. 3) For opinions, include the most well-reasoned perspective plus strong contrarian views. 4) Your output must be MORE detailed than any single response - cherry-pick the strongest parts of each. 5) Add insight that synthesizing multiple perspectives reveals. 6) Include specific numbers, examples, timelines, and actionable steps. 7) Use markdown tables for numerical data, budgets, comparisons. 8) Use ## headers for major sections, flowing paragraphs, bullet points ONLY for actual lists. 9) Do NOT mention model names or that you are synthesizing. Write as one authoritative voice. 10) End with 2-3 specific follow-up questions.';
    }
    if (activeMode === 'thinking') synthInst += ' Preserve step-by-step reasoning.';
    if (activeMode === 'search') synthInst += ' Prioritize the most recent info.';
    const synthPrompt = synthInst + '\n\nQuestion: "' + prompt + '"\n\n' + successful.map((r, i) => '=== Response ' + (i+1) + ' ===\n' + r.text).join('\n\n') + '\n\nBest synthesized answer:';
    try { finalReply = await withTimeout(callClaude(synthPrompt, models.claude, [], KEYS.anthropic, synthInst), 30000, 'Synthesis'); }
    catch (e) { finalReply = successful[0].text; synthesized = false; }
  }

  // If debate mode, do round 2 where models respond to each other
  if (mainMode === 'debate' && successful.length >= 2) {
    const debateContext = successful.map(r => r.name + ' said:\n' + r.text).join('\n\n---\n\n');
    const debatePrompt = 'You are ' + 'one of several AI models in a debate. The user asked: "' + prompt + '"\n\nHere is what each model responded:\n\n' + debateContext + '\n\nNow write your REBUTTAL. Directly address points you disagree with from the other models. Be specific — quote or reference what they said and explain why you think differently. If you agree with something, say so briefly, but focus on where you DISAGREE or have a DIFFERENT perspective. Be direct and confident in your position. Keep it concise (2-4 paragraphs). Do not repeat your original answer.';
    
    const round2Results = await Promise.allSettled([
      successful.find(s => s.name === 'Claude') ? withTimeout(callClaude(debatePrompt, models.claude, [], KEYS.anthropic, 'You are Claude in a multi-AI debate. Be direct and defend your position.'), 50000, 'Claude') : Promise.reject('skipped'),
      successful.find(s => s.name === 'ChatGPT') ? withTimeout(callOpenAI(debatePrompt, models.openai, [], KEYS.openai, 'You are ChatGPT in a multi-AI debate. Be direct and defend your position.'), 50000, 'ChatGPT') : Promise.reject('skipped'),
      successful.find(s => s.name === 'Gemini') ? withTimeout(callGemini(debatePrompt, models.gemini, [], KEYS.gemini, 'You are Gemini in a multi-AI debate. Be direct and defend your position.'), 50000, 'Gemini') : Promise.reject('skipped'),
      successful.find(s => s.name === 'Grok') ? withTimeout(callGrok(debatePrompt, models.grok, [], KEYS.grok, 'You are Grok in a multi-AI debate. Be direct, bold, and unapologetic in your position.'), 50000, 'Grok') : Promise.reject('skipped'),
    ]);
    
    const round2 = [];
    const r2names = ['Claude', 'ChatGPT', 'Gemini', 'Grok'];
    round2Results.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value) {
        round2.push({ name: r2names[i], text: r.value });
      }
    });
    
    // Combine round 1 and round 2 into individual responses
    const debateIndividual = successful.map(s => {
      const rebuttal = round2.find(r => r.name === s.name);
      return {
        name: s.name,
        text: s.text + (rebuttal ? '\n\n---\n\n**Rebuttal:**\n\n' + rebuttal.text : ''),
      };
    });
    
    return res.status(200).json({ reply: finalReply, synthesized, models: successful.map(s => s.name), failed: failed.map(f => f.name), failedDetails: failed, individual: debateIndividual, mode: activeMode, isDebate: true });
  }

  return res.status(200).json({ reply: finalReply, synthesized, models: successful.map(s => s.name), failed: failed.map(f => f.name), failedDetails: failed, individual: successful, mode: activeMode });
}

async function callClaude(p, model, hist, key, sys) {
  if (!key) throw new Error('No key');
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model, max_tokens: 4096, system: sys, messages: hist.map(m => ({ role: m.role, content: m.content })).concat([{ role: 'user', content: p }]) }) });
  if (!r.ok) { let errMsg='Claude error '+r.status; try{const e=await r.json();errMsg=e.error?.message||errMsg;}catch(x){} throw new Error(errMsg); }
  var cData = await r.json();
  var cText = (cData.content || []).map(b => b.text || '').join('');
  if (!cText || cText.trim().length < 5) throw new Error('Claude returned empty - may have been filtered');
  return cText;
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
  // Try primary call
  try {
    const r = await fetch('https://api.x.ai/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }, body: JSON.stringify({ model, max_tokens: 4096, messages: [{ role: 'system', content: sys }].concat(hist.map(m => ({ role: m.role, content: m.content }))).concat([{ role: 'user', content: p }]) }) });
    if (r.ok) return (await r.json()).choices?.[0]?.message?.content || '';
    if (r.status === 500 || r.status === 502 || r.status === 503) {
      // Retry once on server error
      await new Promise(resolve => setTimeout(resolve, 2000));
      const r2 = await fetch('https://api.x.ai/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }, body: JSON.stringify({ model, max_tokens: 4096, messages: [{ role: 'system', content: sys }].concat(hist.map(m => ({ role: m.role, content: m.content }))).concat([{ role: 'user', content: p }]) }) });
      if (!r2.ok) { let errMsg='Grok error '+r2.status; try{const e=await r2.json();errMsg=e.error?.message||errMsg;}catch(x){} throw new Error(errMsg); }
      return (await r2.json()).choices?.[0]?.message?.content || '';
    }
    let errMsg='Grok error '+r.status; try{const e=await r.json();errMsg=e.error?.message||errMsg;}catch(x){} throw new Error(errMsg);
  } catch(e) { throw e; }
}
