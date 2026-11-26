import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import {
  createMarkdownFile,
  statMarkdownFile,
  suggestMarkdownPath,
  readMarkdownFile,
  writeMarkdownFile,
} from "../server/markdown-files.ts";

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "live-markdown-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("suggests a root-level name, accounting for occupied files and directories", async () => {
  const root = await makeRoot();
  await mkdir(join(root, "docs", "nested"), { recursive: true });
  await mkdir(join(root, "untitled-2.md"));
  await writeFile(join(root, "UNTITLED.md"), "Existing");
  await writeFile(join(root, "docs", "nested", "untitled-3.md"), "Does not occupy a root name");
  assert.deepEqual(await suggestMarkdownPath(root, "untitled"), { path: "untitled-3.md" });
  assert.deepEqual(await suggestMarkdownPath(root, "未命名"), { path: "未命名.md" });
});

test("preserves a UTF-8 byte order mark when saving edits", async () => {
  const root = await makeRoot();
  const path = join(root, "notes.md");
  await writeFile(path, "\uFEFF# Hi\n");
  const result = await readMarkdownFile(root, "notes.md");
  assert.equal(result.status, "ok");
  assert.equal(result.text, "\uFEFF# Hi\n");
  const updated = await writeMarkdownFile({
    root,
    path: "notes.md",
    text: result.text.replace("Hi", "Hello"),
    expectedRevision: result.revision,
    force: false,
  });
  assert.equal(updated.status, "ok");
  assert.equal(await readFile(path, "utf8"), "\uFEFF# Hello\n");
});

test("reports a missing file instead of throwing", async () => {
  const root = await makeRoot();
  assert.deepEqual(await readMarkdownFile(root, "missing.md"), { status: "missing" });
});

test("protects an external edit even when it preserves the old modification time", async () => {
  const root = await makeRoot();
  const path = join(root, "notes.md");
  await writeFile(path, "first");
  const read = await readMarkdownFile(root, "notes.md");
  assert.equal(read.status, "ok");
  if (read.status !== "ok") return;

  const timestamp = new Date("2020-01-01T00:00:00Z");
  await utimes(path, timestamp, timestamp);
  const before = await readMarkdownFile(root, "notes.md");
  assert.equal(before.status, "ok");
  await new Promise((done) => setTimeout(done, 5));
  await writeFile(path, "other");
  await utimes(path, timestamp, timestamp);
  const after = await statMarkdownFile(root, "notes.md");
  assert.equal(after.status, "ok");
  assert.equal(after.modifiedAt, before.modifiedAt);
  assert.equal(after.size, before.size);

  const conflict = await writeMarkdownFile({
    root,
    path: "notes.md",
    text: "second",
    expectedRevision: before.revision,
    force: false,
  });
  assert.equal(conflict.status, "conflict");
  assert.equal(await readFile(path, "utf8"), "other");

  const forced = await writeMarkdownFile({
    root,
    path: "notes.md",
    text: "second",
    expectedRevision: before.revision,
    force: true,
  });
  assert.equal(forced.status, "ok");
  assert.equal(await readFile(path, "utf8"), "second");
});

test("refuses to write a file that is gone", async () => {
  const root = await makeRoot();
  const result = await writeMarkdownFile({
    root,
    path: "missing.md",
    text: "x",
    expectedRevision: null,
    force: false,
  });
  assert.deepEqual(result, { status: "missing" });
});

test("creates parent directories and reports existing files", async () => {
  const root = await makeRoot();
  const created = await createMarkdownFile(root, "notes/today.md", "# My draft");
  assert.equal(created.status, "created");
  assert.equal(await readFile(join(root, "notes", "today.md"), "utf8"), "# My draft");
  const info = await stat(join(root, "notes", "today.md"));
  assert.ok(info.isFile());

  const again = await createMarkdownFile(root, "notes/today.md", "# Other draft");
  assert.equal(again.status, "exists");
  assert.equal(await readFile(join(root, "notes", "today.md"), "utf8"), "# My draft");
});

test("never escapes the workspace root", async () => {
  const root = await makeRoot();
  await assert.rejects(() => readMarkdownFile(root, "../outside.md"));
  await assert.rejects(() => createMarkdownFile(root, "../outside.md", ""));
  await assert.rejects(() =>
    writeMarkdownFile({
      root,
      path: "../outside.md",
      text: "x",
      expectedRevision: null,
      force: true,
    }),
  );
});

test("only creates Markdown files", async () => {
  const root = await makeRoot();
  await assert.rejects(() => createMarkdownFile(root, "script.sh", ""));
});

test("concurrent first saves leave exactly one complete draft at the destination", async () => {
  const root = await makeRoot();
  const drafts = ["# First draft", "# Second draft"];
  const results = await Promise.all(
    drafts.map((draft) => createMarkdownFile(root, "notes/today.md", draft)),
  );
  assert.deepEqual(results.map((result) => result.status).sort(), ["created", "exists"]);
  assert.equal(
    await readFile(join(root, "notes", "today.md"), "utf8"),
    drafts[results.findIndex((result) => result.status === "created")],
  );
});

test("refuses to create a draft through a directory symlink outside the workspace", async () => {
  const root = await makeRoot();
  const outside = await makeRoot();
  await symlink(outside, join(root, "linked"), "dir");
  await assert.rejects(() => createMarkdownFile(root, "linked/new/notes.md", "Draft"));
  await assert.rejects(() => stat(join(outside, "new")), { code: "ENOENT" });
});

test("rejects out-of-workspace directory symlinks and does not open file symlinks", async () => {
  const root = await makeRoot();
  const outside = await makeRoot();
  await writeFile(join(outside, "private.md"), "outside");
  await symlink(outside, join(root, "linked"), "dir");
  await symlink(join(outside, "private.md"), join(root, "alias.md"));
  for (const path of ["linked/private.md", "alias.md"]) {
    await assert.rejects(() => readMarkdownFile(root, path));
    await assert.rejects(() => statMarkdownFile(root, path));
    await assert.rejects(() =>
      writeMarkdownFile({ root, path, text: "x", expectedRevision: null, force: true }),
    );
  }
  assert.equal(await readFile(join(outside, "private.md"), "utf8"), "outside");
  assert.deepEqual(await createMarkdownFile(root, "alias.md", "draft"), { status: "exists" });
});

test("allows only one of two saves based on the same revision", async () => {
  const root = await makeRoot();
  const created = await createMarkdownFile(root, "draft.md", "Initial draft");
  assert.equal(created.status, "created");
  const results = await Promise.all(
    ["First edit", "Second edit"].map((text) =>
      writeMarkdownFile({
        root,
        path: "draft.md",
        text,
        expectedRevision: created.revision,
        force: false,
      }),
    ),
  );
  assert.deepEqual(results.map(({ status }) => status).sort(), ["conflict", "ok"]);
  const winner = results.findIndex(({ status }) => status === "ok");
  assert.equal(
    await readFile(join(root, "draft.md"), "utf8"),
    ["First edit", "Second edit"][winner],
  );
});

test("saving keeps existing file permissions", { skip: process.platform === "win32" }, async () => {
  const root = await makeRoot();
  const path = join(root, "notes.md");
  await writeFile(path, "before", { mode: 0o640 });
  const before = await readMarkdownFile(root, "notes.md");
  assert.equal(before.status, "ok");
  const result = await writeMarkdownFile({
    root,
    path: "notes.md",
    text: "after",
    expectedRevision: before.revision,
    force: false,
  });
  assert.equal(result.status, "ok");
  assert.equal((await stat(path)).mode & 0o777, 0o640);
});

test(
  "does not bypass the write permissions of an existing file",
  {
    skip: process.platform === "win32" || process.getuid?.() === 0,
  },
  async () => {
    const root = await makeRoot();
    const path = join(root, "read-only.md");
    await writeFile(path, "protected");
    await chmod(path, 0o444);
    try {
      const before = await readMarkdownFile(root, "read-only.md");
      assert.equal(before.status, "ok");
      await assert.rejects(
        () =>
          writeMarkdownFile({
            root,
            path: "read-only.md",
            text: "updated",
            expectedRevision: before.revision,
            force: true,
          }),
        { code: "EACCES" },
      );
      assert.equal(await readFile(path, "utf8"), "protected");
    } finally {
      await chmod(path, 0o644);
    }
  },
);
