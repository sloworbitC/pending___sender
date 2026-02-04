import formidable from "formidable";
import fs from "fs/promises";
import path from "path";
import pdf from "pdf-parse";
import mammoth from "mammoth";
import xlsx from "xlsx";

export const config = {
  api: { bodyParser: false }
};

// Sensitive terms (used for context blocks or keyword detection)
const sensitiveTerms = [
  "name", "address", "id", "phone", "email",
  "birth", "credit card", "password", "confidential"
];

// Regex patterns — make sure they are global (/gi or /g)
const patterns = {
  "Phone Number": /(\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/gi,
  "Email": /[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/gi,
  "Credit Card": /\b(?:\d{4}[ -]?){3}\d{4}\b/gi,
  // Add more patterns if needed (e.g. ID, Password, etc.)
};

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

          // PDF
          if (ext === ".pdf") {
            const data = await pdf(buffer);
            content = data.text || "";
          }

          // DOCX — better to use convertToHtml for paragraphs
          else if (ext === ".docx") {
            const { value } = await mammoth.convertToHtml({ buffer });
            content = value
              .replace(/<[^>]+>/g, '')         // strip HTML tags
              .replace(/\n{3,}/g, '\n\n')      // normalize multiple newlines
              .trim();
          }

          // TXT / CSV
          else if (ext === ".txt" || ext === ".csv") {
            content = buffer.toString("utf-8");
          }

          // XLS / XLSX
          else if (ext === ".xls" || ext === ".xlsx") {
            const workbook = xlsx.read(buffer, { type: "buffer" });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            content = xlsx.utils.sheet_to_txt(sheet);
          }

          else {
            content = "[Unsupported file type]";
          }

          // Cleanup temp file
          await fs.unlink(file.filepath).catch(() => {});

          // Sensitive term scanning (simple keyword presence)
          const foundTerms = sensitiveTerms.filter(term =>
            content.toLowerCase().includes(term.toLowerCase())
          );

          // Regex scanning — collect separate matches
          const foundPatterns = {};
          for (const [name, regex] of Object.entries(patterns)) {
            // Use matchAll to get all matches as array
            const matchesIterator = content.matchAll(regex);
            const matches = Array.from(matchesIterator, m => m[0].trim());

            if (matches.length > 0) {
              // Remove duplicates and store as array
              foundPatterns[name] = [...new Set(matches)];
            }
          }

          // 1. Define a helper to collect context blocks around sensitive terms
function collectBlocks(text, terms) {
  const blocks = {};
  const lines = text.split(/\r\n|\r|\n/);

  terms.forEach(term => {
    const lowerTerm = term.toLowerCase();
    blocks[term] = [];
    lines.forEach((line, idx) => {
      if (line.toLowerCase().includes(lowerTerm)) {
        // Collect the line + 2 lines before/after for context
        const start = Math.max(0, idx - 2);
        const end = Math.min(lines.length, idx + 3);
        blocks[term].push(...lines.slice(start, end));
      }
    });
    // Remove duplicates and join later
    blocks[term] = [...new Set(blocks[term])];
  });

  return blocks;
}

// 2. Use it to collect blocks
const blocks = collectBlocks(content, sensitiveTerms);

// 3. Scan patterns INSIDE each block (context-aware)
const foundPatterns = {};
for (const [blockLabel, blockLines] of Object.entries(blocks)) {
  if (blockLines.length === 0) continue;

  const blockText = blockLines.join('\n');

  for (const [patternLabel, regex] of Object.entries(patterns)) {
    // Use matchAll to get all matches as separate items
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

// 4. Remove duplicates across all blocks
for (const key in foundPatterns) {
  foundPatterns[key] = [...new Set(foundPatterns[key])];
}

          return {
            filename: file.originalFilename,
            content: content.substring(0, 8000), // keep your limit
            sensitive_terms: foundTerms,
            sensitive_patterns: foundPatterns
          };
        } catch (err) {
          console.error("File processing error:", err);
          return {
            filename: file.originalFilename,
            content: "Error processing file: " + err.message,
            sensitive_terms: [],
            sensitive_patterns: {}
          };
        }
      })
    );

    return res.status(200).json(results);
  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).json({ error: "Scan failed: " + err.message });
  }
}
