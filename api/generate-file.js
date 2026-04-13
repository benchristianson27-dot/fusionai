import PptxGenJS from 'pptxgenjs';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx';

export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } },
  maxDuration: 60,
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { prompt, fileType, tier } = req.body;
  if (!prompt) return res.status(400).json({ error: 'No prompt' });

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'Server not configured' });

  try {
    if (fileType === 'pptx') {
      return await generatePptx(prompt, ANTHROPIC_KEY, tier, res);
    } else if (fileType === 'docx') {
      return await generateDocx(prompt, ANTHROPIC_KEY, tier, res);
    } else {
      return res.status(400).json({ error: 'Unsupported file type. Use pptx or docx.' });
    }
  } catch (e) {
    console.error('File generation error:', e);
    return res.status(500).json({ error: e.message });
  }
}

// ═══ POWERPOINT GENERATION ═══
async function generatePptx(prompt, apiKey, tier, res) {
  const model = tier === 'enterprise' ? 'claude-opus-4-20250514' : 'claude-sonnet-4-20250514';

  // Ask Claude to generate structured slide data
  const slidePrompt = `Generate a professional PowerPoint presentation for this request. Return ONLY valid JSON, no markdown fences, no explanation.

Format:
{
  "title": "Presentation Title",
  "slides": [
    {
      "title": "Slide Title",
      "bullets": ["Point 1", "Point 2", "Point 3"],
      "notes": "Speaker notes for this slide"
    }
  ]
}

Rules:
- 6-12 slides typically
- 3-5 bullets per slide max
- Keep bullet text concise (under 15 words each)
- First slide should be a title slide with just the title and subtitle in bullets
- Last slide should be a summary or Q&A slide
- Speaker notes should be 1-2 sentences of what to say

Request: ${prompt}`;

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 4096, messages: [{ role: 'user', content: slidePrompt }] }),
  });

  if (!claudeRes.ok) throw new Error('AI generation failed');
  const claudeData = await claudeRes.json();
  let content = claudeData.content?.[0]?.text || '';
  content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  let slideData;
  try { slideData = JSON.parse(content); } catch (e) { throw new Error('Failed to parse slide data'); }

  // Build the PowerPoint
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'FusionAI';
  pptx.subject = slideData.title;

  // Color scheme
  const BG = '0A0908';
  const GOLD = 'C8A96E';
  const TEXT = 'EDE9E3';
  const TEXT2 = '8A8479';

  slideData.slides.forEach((slide, i) => {
    const s = pptx.addSlide();
    s.background = { color: BG };

    if (i === 0) {
      // Title slide
      s.addText(slide.title || slideData.title, {
        x: 0.8, y: 1.5, w: 11, h: 1.5,
        fontSize: 36, fontFace: 'Georgia', color: TEXT,
        align: 'center', bold: false, italic: true,
      });
      if (slide.bullets && slide.bullets.length > 0) {
        s.addText(slide.bullets[0], {
          x: 0.8, y: 3.2, w: 11, h: 0.8,
          fontSize: 16, fontFace: 'Calibri', color: GOLD,
          align: 'center',
        });
      }
      // FusionAI branding
      s.addText('Built with FusionAI', {
        x: 0.8, y: 6.8, w: 11, h: 0.4,
        fontSize: 10, fontFace: 'Calibri', color: TEXT2,
        align: 'center',
      });
    } else {
      // Content slide
      // Gold accent line
      s.addShape('rect', { x: 0.6, y: 0.4, w: 0.06, h: 0.5, fill: { color: GOLD } });

      s.addText(slide.title, {
        x: 0.9, y: 0.35, w: 10, h: 0.6,
        fontSize: 24, fontFace: 'Georgia', color: TEXT,
        bold: false, italic: true,
      });

      if (slide.bullets && slide.bullets.length > 0) {
        const bulletText = slide.bullets.map(b => ({
          text: b,
          options: { fontSize: 15, fontFace: 'Calibri', color: TEXT, bullet: { code: '2022', color: GOLD }, breakType: 'none', paraSpaceAfter: 12 },
        }));
        s.addText(bulletText, {
          x: 0.9, y: 1.3, w: 10.5, h: 4.5,
          valign: 'top', lineSpacing: 28,
        });
      }

      // Slide number
      s.addText(String(i + 1), {
        x: 12, y: 6.8, w: 0.6, h: 0.4,
        fontSize: 10, fontFace: 'Calibri', color: TEXT2,
        align: 'right',
      });
    }

    if (slide.notes) {
      s.addNotes(slide.notes);
    }
  });

  const buffer = await pptx.write({ outputType: 'base64' });

  res.status(200).json({
    file: buffer,
    filename: slideData.title.replace(/[^a-zA-Z0-9 ]/g, '').trim().replace(/\s+/g, '_') + '.pptx',
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  });
}

// ═══ WORD DOCUMENT GENERATION ═══
async function generateDocx(prompt, apiKey, tier, res) {
  const model = tier === 'enterprise' ? 'claude-opus-4-20250514' : 'claude-sonnet-4-20250514';

  const docPrompt = `Generate a professional document for this request. Return ONLY valid JSON, no markdown fences.

Format:
{
  "title": "Document Title",
  "sections": [
    {
      "heading": "Section Heading",
      "paragraphs": ["Paragraph text here.", "Another paragraph."]
    }
  ]
}

Rules:
- Write thorough, professional content
- 3-8 sections typically
- Each paragraph should be 2-4 sentences
- Use proper document structure

Request: ${prompt}`;

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 4096, messages: [{ role: 'user', content: docPrompt }] }),
  });

  if (!claudeRes.ok) throw new Error('AI generation failed');
  const claudeData = await claudeRes.json();
  let content = claudeData.content?.[0]?.text || '';
  content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  let docData;
  try { docData = JSON.parse(content); } catch (e) { throw new Error('Failed to parse document data'); }

  // Build the Word document
  const children = [];

  // Title
  children.push(new Paragraph({
    text: docData.title,
    heading: HeadingLevel.TITLE,
    alignment: AlignmentType.CENTER,
    spacing: { after: 400 },
  }));

  // Subtitle line
  children.push(new Paragraph({
    children: [new TextRun({ text: 'Generated by FusionAI', size: 20, color: '8A8479', italics: true })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 600 },
  }));

  // Sections
  docData.sections.forEach(section => {
    children.push(new Paragraph({
      text: section.heading,
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 400, after: 200 },
    }));

    section.paragraphs.forEach(para => {
      children.push(new Paragraph({
        children: [new TextRun({ text: para, size: 24 })],
        spacing: { after: 200 },
      }));
    });
  });

  const doc = new Document({
    sections: [{ properties: {}, children }],
    creator: 'FusionAI',
    title: docData.title,
  });

  const buffer = await Packer.toBase64String(doc);

  res.status(200).json({
    file: buffer,
    filename: docData.title.replace(/[^a-zA-Z0-9 ]/g, '').trim().replace(/\s+/g, '_') + '.docx',
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}
