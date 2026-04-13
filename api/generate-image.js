import { verifyAuth } from './auth.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await verifyAuth(req);
  if (!user.authenticated) return res.status(401).json({ error: 'Sign in required' });
  
  // Check image allowance server-side
  const TIER_IMAGES = { free: 0, starter: 5, pro: 25, enterprise: 100 };
  if (!user.isAdmin && TIER_IMAGES[user.tier] === 0) {
    return res.status(403).json({ error: 'Image generation requires a paid plan' });
  }
  
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'No prompt' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Server not configured' });

  try {
    const r = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt: prompt,
        n: 1,
        size: '1024x1024',
        quality: 'medium',
      }),
    });

    if (!r.ok) {
      const e = await r.json();
      throw new Error(e.error?.message || 'Image generation failed');
    }

    const data = await r.json();
    var imgData = data.data[0];
    var url = imgData.url || null;
    if (!url && imgData.b64_json) {
      url = 'data:image/png;base64,' + imgData.b64_json;
    }
    return res.status(200).json({
      url: url,
      revised_prompt: imgData.revised_prompt || prompt,
    });
  } catch (e) {
    console.error('Image gen error:', e);
    return res.status(500).json({ error: e.message });
  }
}
