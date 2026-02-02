// api/scan.js
import formidable from 'formidable';
import fs from 'fs/promises';
import pdf from 'pdf-parse';

export const config = {
  api: {
    bodyParser: false,  // Let formidable handle multipart
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const form = formidable({ multiples: true });

  try {
    const [fields, files] = await form.parse(req);

    const fileArray = Array.isArray(files.files) ? files.files : [files.files].filter(Boolean);

    if (!fileArray.length) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const results = await Promise.all(
      fileArray.map(async (file) => {
        const buffer = await fs.readFile(file.filepath);
        let content = '';

        if (file.mimetype === 'application/pdf') {
          const data = await pdf(buffer);
          content = data.text;
        } else if (file.mimetype === 'text/plain') {
          content = buffer.toString('utf-8');
        } else {
          content = 'Unsupported file type for scanning';
        }

        // Clean up temp file
        await fs.unlink(file.filepath).catch(() => {});

        // Scanning logic (same as your original intent)
        const sensitive_terms = scanKeywords(content);
        const sensitive_patterns = scanPatterns(content);

        return {
          content: content.substring(0, 5000),  // Limit size to avoid huge responses
          sensitive_terms,
          sensitive_patterns,
        };
      })
    );

    res.status(200).json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Scan failed: ' + err.message });
  }
}

function scanKeywords(content) {
  const keywords = ['password', 'secret', 'confidential', 'private', 'ssn', 'credit card', 'sensitive'];
  return keywords.filter(kw => content.toLowerCase().includes(kw));
}

function scanPatterns(content) {
  return {
    email: content.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g) || [],
    phone: content.match(/\b\+?\d{1,3}[-. ]?\d{3}[-. ]?\d{3}[-. ]?\d{4}\b/g) || [],
    password: content.match(/password\s*[:=]\s*[\w!@#$%^&*]{8,}/gi) || [],
    id: content.match(/\b[A-Z][0-9]{9}\b/g) || [],  // Taiwan ID example
  };
}
