import assert from "node:assert/strict";
import { test } from "node:test";
import { nextUntitledPath, normalizeMarkdownPath } from "../shared/paths.ts";

test("normalizes relative Markdown paths", () => {
  assert.equal(normalizeMarkdownPath("notes/plan"), "notes/plan.md");
  assert.equal(normalizeMarkdownPath("  ./docs/guide.markdown  "), "docs/guide.markdown");
  assert.equal(normalizeMarkdownPath("a//b.md"), "a/b.md");
  assert.equal(normalizeMarkdownPath("README.MD"), "README.MD");
  assert.equal(normalizeMarkdownPath("docs\\notes.md"), "docs/notes.md");
});

test("rejects paths outside the workspace and non-Markdown files", () => {
  assert.equal(normalizeMarkdownPath("../escape.md"), null);
  assert.equal(normalizeMarkdownPath("/absolute.md"), null);
  assert.equal(normalizeMarkdownPath("C:\\notes.md"), null);
  assert.equal(normalizeMarkdownPath("photo.png"), null);
  assert.equal(normalizeMarkdownPath(".md"), null);
  assert.equal(normalizeMarkdownPath("notes/"), null);
  assert.equal(normalizeMarkdownPath(""), null);
  assert.equal(normalizeMarkdownPath("a/../../b.md"), null);
  assert.equal(normalizeMarkdownPath("drafts./notes.md"), null);
  assert.equal(normalizeMarkdownPath("NUL.md"), null);
});

test("picks the first free untitled name", () => {
  assert.equal(nextUntitledPath(new Set()), "untitled.md");
  assert.equal(nextUntitledPath(new Set(["untitled.md"])), "untitled-2.md");
  assert.equal(nextUntitledPath(new Set(["untitled.md", "untitled-2.md"]), "未命名"), "未命名.md");
});
