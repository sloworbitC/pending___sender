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

// Regex patterns for each category
const patterns = {
  "credit Card": /\b(?:\d[ -]*?){13,16}\b/g,
  "phone": /(\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g,
  "email": /[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/g,
  "id": /\b[A-Z0-9]{6,12}\b/g,
  "birth": /\b\d{4}[\/.-]\d{1,2}[\/.-]\d{1,2}\b/g,
  "password": /\bpassword[:=]\s*\S+/gi,
  "address": /\d{1,5}\s+[A-Za-z0-9\s.,'-]+/g,
  "confidential": /\bconfidential\b/gi
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
