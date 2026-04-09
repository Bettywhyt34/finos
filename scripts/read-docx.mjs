import { execSync } from "child_process";

const xml = execSync(
  'unzip -p "/c/Users/digit/Projects/finos/FINOS_Phase2_Build.md.docx" word/document.xml'
).toString();

let text = xml
  .replace(/<w:br[^/]*\/>/g, "\n")
  .replace(/<\/w:p>/g, "\n")
  .replace(/<w:p[ >][^>]*/g, "")
  .replace(/<[^>]+>/g, "")
  .replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&#13;/g, "")
  .replace(/\n{3,}/g, "\n\n");

const lines = text
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l.length > 0 && !l.match(/^w1[0-9a-z]:/));

console.log(lines.join("\n"));
