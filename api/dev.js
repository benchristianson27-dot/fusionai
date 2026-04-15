import { verifyAuth } from './auth.js';

export const config = {
  maxDuration: 60,
  api: { bodyParser: { sizeLimit: '2mb' } },
};

// Only this email can access dev mode
const DEV_EMAIL = 'ben.christianson27@gmail.com';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Dev-Secret');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── Layer 1: Firebase auth ──
  const user = await verifyAuth(req);
  if (!user.authenticated) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // ── Layer 2: Email whitelist ──
  if (user.email !== DEV_EMAIL) {
    // Don't even acknowledge this endpoint exists
    return res.status(404).json({ error: 'Not found' });
  }

  // ── Layer 3: Dev secret (separate from Firebase, set in Vercel env) ──
  const devSecret = req.headers['x-dev-secret'];
  if (!devSecret || devSecret !== process.env.DEV_MODE_SECRET) {
    return res.status(403).json({ error: 'Invalid dev credentials' });
  }

  // ── Validated. Process dev command. ──
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN_READ;
  const REPO_OWNER = process.env.GITHUB_REPO_OWNER || 'benchristianson27-dot';
  const REPO_NAME = process.env.GITHUB_REPO_NAME || 'fusionai';

  if (!GITHUB_TOKEN) {
    return res.status(500).json({ error: 'GitHub token not configured' });
  }

  const { action, path, ref } = req.body;
  const branch = ref || 'main';

  const ghFetch = async (url) => {
    const r = await fetch(url, {
      headers: {
        'Authorization': 'Bearer ' + GITHUB_TOKEN,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'FusionAI-Dev',
      },
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.message || 'GitHub API error ' + r.status);
    }
    return r.json();
  };

  try {
    // ── LIST: Get repo file tree ──
    if (action === 'list') {
      const tree = await ghFetch(
        `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/git/trees/${branch}?recursive=1`
      );
      const files = tree.tree
        .filter(f => f.type === 'blob')
        .map(f => ({ path: f.path, size: f.size, sha: f.sha }));
      return res.status(200).json({ files, branch });
    }

    // ── READ: Get file contents ──
    if (action === 'read') {
      if (!path) return res.status(400).json({ error: 'Path required' });
      const file = await ghFetch(
        `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${encodeURIComponent(path)}?ref=${branch}`
      );
      const content = Buffer.from(file.content, 'base64').toString('utf-8');
      return res.status(200).json({
        path: file.path,
        content,
        sha: file.sha,
        size: file.size,
        branch,
      });
    }

    // ── LOG: Get recent commits ──
    if (action === 'log') {
      const commits = await ghFetch(
        `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/commits?sha=${branch}&per_page=20`
      );
      const log = commits.map(c => ({
        sha: c.sha.slice(0, 7),
        message: c.commit.message,
        date: c.commit.author.date,
        author: c.commit.author.name,
      }));
      return res.status(200).json({ commits: log, branch });
    }

    // ── DIFF: Get diff between two commits ──
    if (action === 'diff') {
      const { base, head } = req.body;
      if (!base || !head) return res.status(400).json({ error: 'Base and head SHAs required' });
      const diff = await ghFetch(
        `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/compare/${base}...${head}`
      );
      const files = diff.files.map(f => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch,
      }));
      return res.status(200).json({ files, totalChanges: diff.files.length });
    }

    // ── ANALYZE: Send file to Claude for analysis ──
    if (action === 'analyze') {
      if (!path) return res.status(400).json({ error: 'Path required' });
      const { question } = req.body;
      if (!question) return res.status(400).json({ error: 'Question required' });

      // Fetch the file
      const file = await ghFetch(
        `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${encodeURIComponent(path)}?ref=${branch}`
      );
      const content = Buffer.from(file.content, 'base64').toString('utf-8');

      // Send to Claude for analysis
      const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
      if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'AI not configured' });

      const sysPrompt = 'You are a senior developer reviewing code for the FusionAI project (fusion4ai.com). '
        + 'The user is Ben Christianson, the creator. Be direct and technical. '
        + 'When suggesting changes, output clean diffs or complete replacement code. '
        + 'Be specific about line numbers and exact changes needed.';

      const userMsg = `File: ${path}\n\n\`\`\`\n${content}\n\`\`\`\n\nQuestion: ${question}`;

      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4000,
          system: sysPrompt,
          messages: [{ role: 'user', content: userMsg }],
        }),
      });

      if (!aiRes.ok) {
        const err = await aiRes.json().catch(() => ({}));
        throw new Error(err.error?.message || 'AI analysis failed');
      }

      const aiData = await aiRes.json();
      const analysis = aiData.content?.[0]?.text || '';

      return res.status(200).json({ analysis, path, branch });
    }

    return res.status(400).json({ error: 'Unknown action. Use: list, read, log, diff, analyze' });

  } catch (e) {
    console.error('Dev mode error:', e);
    return res.status(500).json({ error: e.message });
  }
}
