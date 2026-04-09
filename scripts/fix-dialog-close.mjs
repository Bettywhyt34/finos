import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const B = 'C:/Users/digit/Projects/finos/finos-v5/app';

// Recursively find .tsx files
function findFiles(dir) {
  const results = [];
  for (const f of readdirSync(dir)) {
    const full = join(dir, f);
    if (statSync(full).isDirectory()) results.push(...findFiles(full));
    else if (f.endsWith('.tsx') || f.endsWith('.ts')) results.push(full);
  }
  return results;
}

let fixCount = 0;

for (const file of findFiles(B)) {
  let content = readFileSync(file, 'utf8');
  const original = content;

  // Replace: <DialogClose asChild>\n              <Button ... /Cancel Button>\n            </DialogClose>
  // With:    <DialogClose render={<Button ... />} onClick={...}>Cancel</DialogClose>
  // The pattern: <DialogClose asChild>\n                <Button type="button" variant="outline">Cancel</Button>\n              </DialogClose>
  content = content.replace(
    /<DialogClose asChild>\s*<Button([^>]*)>Cancel<\/Button>\s*<\/DialogClose>/g,
    (_, attrs) => {
      // Extract variant from attrs
      const variantMatch = attrs.match(/variant="([^"]+)"/);
      const variant = variantMatch ? variantMatch[1] : 'outline';
      const typeMatch = attrs.match(/type="([^"]+)"/);
      const type = typeMatch ? typeMatch[1] : 'button';
      return `<DialogClose render={<Button variant="${variant}" type="${type}" />}>Cancel</DialogClose>`;
    }
  );

  if (content !== original) {
    writeFileSync(file, content, 'utf8');
    console.log('Fixed:', file.replace(B, ''));
    fixCount++;
  }
}

console.log(`\nFixed ${fixCount} files`);
