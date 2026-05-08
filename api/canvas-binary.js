// /api/canvas-binary
//
// Fetches binary content (PDF, DOCX, PPTX) from a Canvas file URL on behalf of
// the frontend. Why this exists: Canvas file download URLs (returned from
// /files/:id) typically don't include CORS headers, so the browser can't fetch
// them directly. This proxy fetches server-side and returns base64-encoded
// bytes which the frontend then parses with PDF.js / mammoth.
//
// Request body:
//   {
//     url:   "https://canvas.instructure.com/api/v1/courses/.../files/12345"  (Canvas file API URL OR direct download URL)
//     token: "Canvas API token"
//     fileId: 12345  (optional; if provided + url is the canvas base, we'll hit /files/:id first to get the signed download URL)
//   }
//
// Response:
//   {
//     ok: true,
//     filename: "Unit7_Vocab.pdf",
//     mime: "application/pdf",
//     size: 248192,
//     base64: "..." (the file contents, base64-encoded)
//   }
//
// Failure modes return { ok: false, error: "..." } with a 400/502/etc. status.
// We cap fetch size at 25 MB to prevent runaway memory; bigger files truncate
// with a message.

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB

export default async function handler(req, res) {
  // CORS — match the existing canvas proxy's allowlist
  const origin = req.headers.origin || '';
  const allowedOrigins = [
    'https://fusion4ai.com',
    'https://www.fusion4ai.com',
    'https://fusionai-xi.vercel.app',
    'http://localhost:3000',
    'http://localhost:5173',
  ];
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'POST only' });
  }

  try {
    const { url, token, fileId, canvasBase } = req.body || {};
    if (!token) {
      return res.status(400).json({ ok: false, error: 'token required' });
    }
    if (!url && !fileId) {
      return res.status(400).json({ ok: false, error: 'url or fileId required' });
    }

    // Step 1: Resolve the signed download URL if needed
    let downloadUrl = url;
    let filenameHint = '';
    let mimeHint = '';
    if (fileId && canvasBase) {
      // Hit the file API to get the signed download URL + metadata
      const apiUrl = `${canvasBase.replace(/\/$/, '')}/api/v1/files/${fileId}`;
      const apiResp = await fetch(apiUrl, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!apiResp.ok) {
        return res.status(502).json({ ok: false, error: `Canvas file metadata fetch failed: ${apiResp.status}` });
      }
      const fileMeta = await apiResp.json();
      if (!fileMeta.url) {
        return res.status(502).json({ ok: false, error: 'Canvas file has no download URL (locked or hidden)' });
      }
      downloadUrl = fileMeta.url;
      filenameHint = fileMeta.display_name || fileMeta.filename || '';
      mimeHint = fileMeta['content-type'] || fileMeta.mime_class || '';
    }

    // Step 2: Fetch the actual bytes. For Canvas signed URLs, the auth token
    // is embedded in the URL itself; no Authorization header needed (and
    // sending one can actually break the request). For raw API URLs, do
    // include the bearer token.
    const isSigned = /\?(download_frd=|verifier=)/.test(downloadUrl);
    const fetchHeaders = isSigned ? {} : { Authorization: `Bearer ${token}` };

    const fileResp = await fetch(downloadUrl, { headers: fetchHeaders });
    if (!fileResp.ok) {
      return res.status(502).json({ ok: false, error: `File download failed: ${fileResp.status}` });
    }

    // Pull bytes with size cap
    const buffer = await fileResp.arrayBuffer();
    if (buffer.byteLength > MAX_BYTES) {
      return res.status(413).json({
        ok: false,
        error: `File too large (${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB > 25 MB cap)`,
        size: buffer.byteLength,
      });
    }

    const bytes = Buffer.from(buffer);
    const mime = fileResp.headers.get('content-type') || mimeHint || 'application/octet-stream';
    // Pull filename from Content-Disposition if present
    let filename = filenameHint;
    const cd = fileResp.headers.get('content-disposition') || '';
    const cdMatch = cd.match(/filename\*?=(?:UTF-8'')?["']?([^;"'\n]+)/i);
    if (cdMatch && !filename) filename = decodeURIComponent(cdMatch[1]);

    return res.status(200).json({
      ok: true,
      filename,
      mime,
      size: bytes.length,
      base64: bytes.toString('base64'),
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || 'Unknown error' });
  }
}
