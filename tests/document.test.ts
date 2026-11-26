import assert from "node:assert/strict";
import { test } from "node:test";
import { documentStats, splitFrontMatter } from "../client/document.ts";

test("splits YAML front matter into rows and keeps the body", () => {
  const source = "---\ntitle: Release notes\ntags: [desktop, mobile]\ndraft: false\n---\n# Hello\n";
  const document = splitFrontMatter(source);
  assert.deepEqual(document.frontMatter, [
    { key: "title", value: "Release notes" },
    { key: "tags", value: "desktop, mobile" },
    { key: "draft", value: "false" },
  ]);
  assert.equal(document.body, "# Hello\n");
});

test("leaves a document without front matter untouched", () => {
  const source = "# Heading\n\nBody with --- inside.\n";
  const document = splitFrontMatter(source);
  assert.deepEqual(document.frontMatter, []);
  assert.equal(document.body, source);
});

test("falls back to the whole source when front matter is not valid YAML", () => {
  const source = "---\ntitle: [unclosed\n---\nBody\n";
  const document = splitFrontMatter(source);
  assert.deepEqual(document.frontMatter, []);
  assert.equal(document.body, source);
});

test("ignores a front matter block that is not a mapping", () => {
  const source = "---\n- one\n- two\n---\nBody\n";
  const document = splitFrontMatter(source);
  assert.deepEqual(document.frontMatter, []);
  assert.equal(document.body, source);
});

test("counts lines, CJK characters, and Latin words", () => {
  const stats = documentStats("第一行 hello world\n第二行 2 words");
  assert.equal(stats.lines, 2);
  assert.equal(stats.words, 10);
  assert.equal(stats.characters, Array.from("第一行helloworld第二行2words").length);
});

test("counts an empty document as one line with no words", () => {
  assert.deepEqual(documentStats(""), { lines: 1, characters: 0, words: 0 });
});
