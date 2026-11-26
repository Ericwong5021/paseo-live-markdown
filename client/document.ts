import { parseDocument, stringify } from "yaml";

export interface FrontMatterRow {
  key: string;
  value: string;
}

export interface MarkdownPreviewDocument {
  frontMatter: readonly FrontMatterRow[];
  body: string;
}

export interface DocumentStats {
  /** Source lines, counting an empty document as one line like the editor does. */
  lines: number;
  /** Whitespace-free characters; a CJK character counts as one. */
  characters: number;
  /** CJK characters plus Latin/number word tokens. */
  words: number;
}

const FRONT_MATTER_PATTERN = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const CJK_PATTERN = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/g;
const WORD_PATTERN = /[A-Za-z0-9_]+(?:['’-][A-Za-z0-9_]+)*/g;

/**
 * Splits YAML front matter from the body the way Paseo's built-in Markdown panel does, so the
 * preview shows metadata as a table instead of a horizontal rule and a stray paragraph.
 * Invalid YAML leaves the source untouched.
 */
export function splitFrontMatter(source: string): MarkdownPreviewDocument {
  const match = FRONT_MATTER_PATTERN.exec(source);
  if (!match) return { frontMatter: [], body: source };

  try {
    const parsed = parseDocument(match[1] ?? "", { schema: "core" });
    if (parsed.errors.length > 0) return { frontMatter: [], body: source };
    const metadata = parsed.toJS({ maxAliasCount: 100 });
    if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
      return { frontMatter: [], body: source };
    }
    return {
      frontMatter: Object.entries(metadata).map(([key, value]) => ({
        key,
        value: formatValue(value),
      })),
      body: source.slice(match[0].length),
    };
  } catch {
    return { frontMatter: [], body: source };
  }
}

export function documentStats(text: string): DocumentStats {
  const lines = text.length === 0 ? 1 : text.split("\n").length;
  const characters = Array.from(text.replace(/\s/g, "")).length;
  const cjk = text.match(CJK_PATTERN)?.length ?? 0;
  const words = text.match(WORD_PATTERN)?.length ?? 0;
  return { lines, characters, words: cjk + words };
}

function isScalar(value: unknown): value is string | number | boolean | null {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function formatScalar(value: string | number | boolean | null): string {
  return value === null ? "null" : String(value);
}

function formatValue(value: unknown): string {
  if (Array.isArray(value) && value.every(isScalar)) {
    return value.map(formatScalar).join(", ");
  }
  if (isScalar(value)) return formatScalar(value);
  return stringify(value).trim();
}
