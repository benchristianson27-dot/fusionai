// api/canvas.js
// Canvas LMS proxy — forwards browser requests to Canvas server-side to bypass CORS.
// Canvas does not allow cross-origin fetches from arbitrary domains, so the frontend
// calls this endpoint, which proxies the request using the user's saved token.

export const config = {
  maxDuration: 15,
  api: { bodyParser: { sizeLimit: '1mb' } },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url, token, path } = req.body || {};

  if (!url || !token || !path) {
    return res.status(400).json({ error: 'Missing url, token, or path' });
  }

  // Normalize and validate the URL — only allow https Canvas-like hosts
  let baseUrl;
  try {
    baseUrl = new URL(url.trim().replace(/\/$/, ''));
  } catch (e) {
    return res.status(400).json({ error: 'Invalid Canvas URL — must be a full https URL (e.g. https://yourschool.instructure.com)' });
  }

  if (baseUrl.protocol !== 'https:') {
    return res.status(400).json({ error: 'Canvas URL must use https' });
  }

  // Safety: don't let the path escape to a different host
  if (path.includes('://') || path.startsWith('//')) {
    return res.status(400).json({ error: 'Invalid path — should be like /api/v1/users/self' });
  }

  // Build final target URL
  const targetPath = path.startsWith('/') ? path : '/' + path;
  const fullUrl = baseUrl.origin + targetPath;

  try {
    const r = await fetch(fullUrl, {
      headers: {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/json',
      },
    });

    const contentType = r.headers.get('content-type') || '';

    if (!r.ok) {
      // Surface a useful error back to the client
      let errorBody = '';
      try { errorBody = await r.text(); } catch {}

      if (r.status === 401) {
        return res.status(401).json({
          error: 'Invalid Canvas token — check that your token is correct and not expired',
          canvasStatus: r.status,
        });
      }
      if (r.status === 404) {
        return res.status(404).json({
          error: 'Canvas endpoint not found — check your Canvas URL (should look like https://yourschool.instructure.com)',
          canvasStatus: r.status,
        });
      }
      if (r.status === 403) {
        return res.status(403).json({
          error: 'Canvas token lacks permission for this action',
          canvasStatus: r.status,
        });
      }
      return res.status(r.status).json({
        error: 'Canvas returned status ' + r.status,
        canvasStatus: r.status,
        body: errorBody.slice(0, 500),
      });
    }

    if (contentType.includes('application/json')) {
      const data = await r.json();
      return res.status(200).json(data);
    }

    // Non-JSON response usually means you hit the login page — bad URL
    const text = await r.text();
    return res.status(500).json({
      error: 'Canvas returned a non-JSON response — the URL may be wrong, or Canvas may be blocking the request',
      preview: text.slice(0, 200),
    });

  } catch (e) {
    // Network-level failure (DNS, timeout, TLS, etc.)
    return res.status(500).json({
      error: 'Could not reach Canvas: ' + (e.message || 'Unknown error') + '. Double-check the URL.',
    });
  }
}
