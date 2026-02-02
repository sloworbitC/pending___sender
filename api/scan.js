import formidable from 'formidable';
import fs from 'fs/promises';
import pdf from 'pdf-parse';

export const config = {
  api: {
    bodyParser: false
  }
};

export default async function handler(req, res) {
  console.log('Function started - method:', req.method);

  if (req.method !== 'POST') {
    console.log('Method not POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('Starting formidable parse');
    const form = formidable({ multiples: true });
    const [fields, files] = await form.parse(req);
    console.log('Parse complete - files:', Object.keys(files));

    const fileArray = Array.isArray(files.files) ? files.files : [files.files].filter(Boolean);

    if (!fileArray.length) {
      console.log('No files');
      return res.status(400).json({ error: 'No files uploaded' });
    }

    console.log('Processing', fileArray.length, 'files');

    const results = await Promise.all(
      fileArray.map(async (file) => {
        console.log('Processing file:', file.originalFilename, 'mimetype:', file.mimetype);

        try {
          const buffer = await fs.readFile(file.filepath);
          console.log('File read - buffer length:', buffer.length);

          let content = '';

          if (file.mimetype === 'application/pdf') {
            console.log('Parsing PDF');
            const data = await pdf(buffer);
            content = data.text || '';
          } else if (file.mimetype === 'text/plain') {
            console.log('Parsing TXT');
            content = buffer.toString('utf-8');
          } else {
            console.log('Unsupported mimetype');
            content = 'Unsupported file type';
          }

          console.log('Deleting temp file');
          await fs.unlink(file.filepath).catch(() => {});

          console.log('Scanning');
          const sensitive_terms = scanKeywords(content);
          const sensitive_patterns = scanPatterns(content);

          return {
            content: content.substring(0, 8000),
            sensitive_terms,
            sensitive_patterns
          };
        } catch (fileErr) {
          console.error('File error:', fileErr.message, fileErr.stack);
          return {
            content: 'Error processing file: ' + fileErr.message,
            sensitive_terms: [],
            sensitive_patterns: {}
          };
        }
      })
    );

    console.log('Sending results');
    res.status(200).json(results);
  } catch (err) {
    console.error('Handler crash:', err.message, err.stack);
    res.status(500).json({ error: 'Scan failed: ' + err.message });
  }
}

function scanKeywords(content) {
  const keywords = ['password', 'secret', 'confidential', 'private', 'ssn', 'credit card'];
  return keywords.filter(kw => content.toLowerCase().includes(kw));
}

function scanPatterns(content) {
  return {
    email: content.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g) || [],
    phone: content.match(/\b\+?\d{1,3}?[-. (]?\d{3}[-. )]?\d{3}[-. ]?\d{4}\b/g) || [],
    password: content.match(/(?i)password\s*[:=]\s*[\w\d@!#$%*]{8,}/g) || [],
    id: content.match(/\b[A-Z][0-9]{9}\b/g) || []
  };
}
