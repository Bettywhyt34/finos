import { readFileSync, writeFileSync } from "fs";

const files = [
  "app/(dashboard)/settings/organization/branding/branding-client.tsx",
  "app/(dashboard)/settings/organization/locations/locations-client.tsx",
  "app/(dashboard)/settings/orgprofile/org-profile-client.tsx",
  "components/settings/settings-shell.tsx",
];

for (const f of files) {
  const original = readFileSync(f, "utf8");
  const updated = original
    // Tailwind arbitrary-value classes: bg-[#4088f4] → bg-[var(--finos-accent)]
    .replaceAll("[#4088f4]", "[var(--finos-accent)]")
    // JS/JSX string literals: "#4088f4" → "var(--finos-accent)"
    .replaceAll('"#4088f4"', '"var(--finos-accent)"')
    .replaceAll("'#4088f4'", "'var(--finos-accent)'");

  if (updated !== original) {
    writeFileSync(f, updated);
    const n = (original.match(/#4088f4/g) ?? []).length;
    console.log(`✓ ${f}  (${n} replaced)`);
  }
}
console.log("Done.");
