import formidable from "formidable";
import fs from "fs/promises";
import path from "path";
import pdf from "pdf-parse";
import mammoth from "mammoth";
import xlsx from "xlsx";

export const config = {
  api: { bodyParser: false }
};

// Sensitive terms
const sensitiveTerms = [
  "name", "address", "id", "phone", "email",
  "birth", "credit card", "password", "confidential"
];

// Regex patterns — global flag is important
const patterns = {
  "Phone Number": /(\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/gi,
  "Email": /[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/gi,
  "Credit Card": /\b(?:\d{4}[ -]?){3}\d{4}\b/gi,
};

// Helper: collect lines around sensitive terms for context
function collectBlocks(text, terms) {
  const blocks = {};
  const lines = text.split(/\r\n|\r|\n/);

  terms.forEach(term => {
    const lowerTerm = term.toLowerCase();
    blocks[term] = [];
    lines.forEach((line, idx) => {
      if (line.toLowerCase().includes(lowerTerm)) {
        // Grab current line + 2 before + 2 after
        const start = Math.max(0, idx - 2);
        const end = Math.min(lines.length, idx + 3);
        blocks[term].push(...lines.slice(start, end));
      }
    });
    // Dedupe lines
    blocks[term] = [...new Set(blocks[term])];
  });

  return blocks;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const form = formidable({ multiples: true });
    const [fields, files] = await form.parse(req);

    const fileArray = Array.isArray(files.files)
      ? files.files
      : [files.files].filter(Boolean);

    if (!fileArray.length) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    const results = await Promise.all(
      fileArray.map(async (file) => {
        try {
          const buffer = await fs.readFile(file.filepath);
          const ext = path.extname(file.originalFilename).toLowerCase();

          let content = "";

          if (ext === ".pdf") {
            const data = await pdf(buffer);
            content = data.text || "";
          } else if (ext === ".docx") {
            const { value } = await mammoth.extractRawText({ buffer });
            content = value;
          } else if (ext === ".txt" || ext === ".csv") {
            content = buffer.toString("utf-8");
          } else if (ext === ".xls" || ext === ".xlsx") {
            const workbook = xlsx.read(buffer, { type: "buffer" });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            content = xlsx.utils.sheet_to_txt(sheet);
          } else {
            content = "[Unsupported file type]";
          }

          await fs.unlink(file.filepath).catch(() => {});

          // Sensitive keyword detection (global)
          const foundTerms = sensitiveTerms.filter(term =>
            content.toLowerCase().includes(term.toLowerCase())
          );

          // Context-aware pattern matching using blocks
          const blocks = collectBlocks(content, sensitiveTerms);

          const foundPatterns = {};
          for (const [blockLabel, blockLines] of Object.entries(blocks)) {
            if (blockLines.length === 0) continue;

            const blockText = blockLines.join("\n");

            for (const [patternLabel, regex] of Object.entries(patterns)) {
              // Use matchAll to get every individual match
              const matchIterator = blockText.matchAll(regex);
              const matches = Array.from(matchIterator, m => m[0].trim());

              if (matches.length > 0) {
                if (!foundPatterns[patternLabel]) {
                  foundPatterns[patternLabel] = [];
                }
                foundPatterns[patternLabel].push(...matches);
              }
            }
          }

          // Deduplicate
          for (const key in foundPatterns) {
            foundPatterns[key] = [...new Set(foundPatterns[key])];
          }

          // Debug log for Vercel functions
          console.log('Extracted patterns:', foundPatterns);

          return {
            filename: file.originalFilename,
            content: content.substring(0, 8000),
            sensitive_terms: foundTerms,
            sensitive_patterns: foundPatterns,
          };
        } catch (err) {
          console.error("File error:", err.message);
          return {
            filename: file.originalFilename,
            content: "Error processing file: " + err.message,
            sensitive_terms: [],
            sensitive_patterns: {},
          };
        }
      })
    );

    return res.status(200).json(results);
  } catch (err) {
    console.error("Handler error:", err.message);
    return res.status(500).json({ error: "Scan failed: " + err.message });
  }
}
