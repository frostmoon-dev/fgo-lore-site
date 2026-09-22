import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

// Reads every .md file in a folder. The block between --- lines at the top
// (frontmatter) holds settings; the rest is the text.
export function loadEntries(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((file) => {
      const raw = fs.readFileSync(path.join(dir, file), "utf8");
      const { data, content } = matter(raw);
      return {
        id: path.basename(file, ".md"),
        title: data.title ?? path.basename(file, ".md"),
        category: data.category ?? "Other",
        keywords: (data.keywords ?? []).map((k) => String(k).toLowerCase()),
        priority: Number(data.priority ?? 0),
        meta: data, // every frontmatter setting
        content: content.trim(),
      };
    });
}
