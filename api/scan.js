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

// Regex patterns
const patterns = {
  "Phone Number": /(\+?\d{1,3}[\s.-]?)?$$   ?\d{3}   $$?[\s.-]?\d{3}[\s.-]?\d{4}/gi,
  "Email": /[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/gi,
  "Credit Card": /\b(?:\d{4}[ -]?){3}\d{4}\b/gi,
};

// Helper: collect blocks around sensitive terms
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
    // Remove duplicates
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

          // PDF
          if (ext === ".pdf") {
            const data = await pdf(buffer);
            content = data.text || "";
          }

          // DOCX
          else if (ext === ".docx") {
            const { value } = await mammoth.extractRawText({ buffer });
            content = value;
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

          // Clean content for better regex detection
          const cleanContent = content;

          // Sensitive term scanning
          const foundTerms = sensitiveTerms.filter((term) =>
            cleanContent.toLowerCase().includes(term.toLowerCase())
          );

          // Collect blocks
          const blocks = collectBlocks(cleanContent, sensitiveTerms);

          // Regex scanning inside blocks
          const foundPatterns = {};
          for (const [label, lines] of Object.entries(blocks)) {
            const blockText = lines.join("\n");
            for (const [patternLabel, regex] of Object.entries(patterns)) {
              const matches = blockText.match(regex);
              if (matches) {
                if (!foundPatterns[patternLabel]) foundPatterns[patternLabel] = [];
                foundPatterns[patternLabel].push(...matches);
              }
            }
          }

          // Remove duplicates
          for (const key in foundPatterns) {
            foundPatterns[key] = [...new Set(foundPatterns[key])];
          }

          return {
            filename: file.originalFilename,
            content: cleanContent.substring(0, 8000),
            sensitive_terms: foundTerms,
            sensitive_patterns: foundPatterns,
          };
        } catch (err) {
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
    return res.status(500).json({ error: "Scan failed: " + err.message });
  }
}
