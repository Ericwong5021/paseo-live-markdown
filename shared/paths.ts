/** Relative workspace paths for Markdown documents. Slash-separated on every platform. */

const INVALID_SEGMENT = /[<>:"|?*\u0000-\u001f]/;
const RESERVED_SEGMENT = /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i;

/**
 * Normalizes user input to a workspace-relative `.md` / `.markdown` path, or null when the input
 * escapes the workspace or is not a Markdown path.
 */
export function normalizeMarkdownPath(input: string): string | null {
  const trimmed = input.trim().replace(/\\/g, "/");
  if (
    !trimmed ||
    trimmed.endsWith("/") ||
    trimmed.startsWith("/") ||
    /^[A-Za-z]:\//.test(trimmed)
  ) {
    return null;
  }
  const parts = trimmed.split("/").filter((part) => part !== "" && part !== ".");
  if (parts.length === 0) return null;
  if (
    parts.some(
      (part) => /[. ]$/.test(part) || INVALID_SEGMENT.test(part) || RESERVED_SEGMENT.test(part),
    )
  )
    return null;

  const last = parts.at(-1) ?? "";
  if (!last || last === ".md" || last === ".markdown") return null;
  const dot = last.lastIndexOf(".");
  const extension = dot >= 0 ? last.slice(dot + 1).toLowerCase() : "";
  if (extension === "") parts[parts.length - 1] = `${last}.md`;
  else if (extension !== "md" && extension !== "markdown") return null;

  const path = parts.join("/");
  return path.length <= 240 ? path : null;
}

/** The first free `untitled.md`, `untitled-2.md`, … given the paths that already exist. */
export function nextUntitledPath(existing: ReadonlySet<string>, base = "untitled"): string {
  const canonical = (path: string) => path.normalize("NFC").toLowerCase();
  const occupied = new Set(Array.from(existing, canonical));
  const first = `${base}.md`;
  if (!occupied.has(canonical(first))) return first;
  for (let index = 2; ; index += 1) {
    const candidate = `${base}-${index}.md`;
    if (!occupied.has(canonical(candidate))) return candidate;
  }
}

export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}
