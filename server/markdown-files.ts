import { constants } from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import type { BigIntStats } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isMarkdownPath, nextUntitledPath, normalizeMarkdownPath } from "../shared/paths";

const pendingWrites = new Map<string, Promise<unknown>>();

export async function suggestMarkdownPath(root: string, base: string) {
  if (normalizeMarkdownPath(base) !== `${base}.md` || base.includes("/")) {
    throw new Error("Choose a Markdown file name without a directory.");
  }
  // Only the root's names matter, including directories and symlinks that already occupy a name.
  const names = await readdir(await requireRoot(root));
  return { path: nextUntitledPath(new Set(names), base) };
}

export async function readMarkdownFile(root: string, path: string) {
  const absolute = await locateFile(root, path);
  if (!absolute || !(await inspectFile(absolute))) return { status: "missing" as const };

  const file = await open(
    absolute,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  ).catch((cause) => {
    if (isMissing(cause)) return null;
    throw cause;
  });
  if (!file) return { status: "missing" as const };
  try {
    const before = await file.stat({ bigint: true });
    if (!before.isFile()) return { status: "missing" as const };
    const text = await file.readFile("utf8");
    const after = await file.stat({ bigint: true });
    if (revisionOf(before) !== revisionOf(after)) {
      throw new Error("The file changed while it was being read. Try again.");
    }
    return { status: "ok" as const, text, ...fileMetadata(after) };
  } finally {
    await file.close();
  }
}

export async function statMarkdownFile(root: string, path: string) {
  const absolute = await locateFile(root, path);
  const info = absolute && (await inspectFile(absolute));
  return info ? { status: "ok" as const, ...fileMetadata(info) } : { status: "missing" as const };
}

export async function writeMarkdownFile(input: {
  root: string;
  path: string;
  text: string;
  expectedRevision: string | null;
  force: boolean;
}) {
  const absolute = await locateFile(input.root, input.path);
  if (!absolute) return { status: "missing" as const };

  return serializeWrite(absolute, async () => {
    const info = await inspectFile(absolute);
    if (!info) return { status: "missing" as const };
    if (!input.force && input.expectedRevision !== revisionOf(info)) {
      return { status: "conflict" as const };
    }

    return stageText(dirname(absolute), input.text, async (stagedFile) => {
      await chmod(stagedFile, Number(info.mode & 0o777n));
      // Recheck after staging so a slow write cannot clobber an edit that arrived while staging.
      const current = await inspectFile(absolute);
      if (!current) return { status: "missing" as const };
      if (revisionOf(current) !== revisionOf(info)) return { status: "conflict" as const };

      await rename(stagedFile, absolute);
      const written = await inspectFile(absolute);
      if (!written) return { status: "missing" as const };
      return { status: "ok" as const, ...fileMetadata(written) };
    });
  });
}

export async function createMarkdownFile(root: string, path: string, text: string) {
  const absoluteRoot = await requireRoot(root);
  const absolute = resolveMarkdownPath(absoluteRoot, path);
  const parent = await ensureDirectoryInside(absoluteRoot, dirname(absolute));
  const target = join(parent, basename(absolute));

  return serializeWrite(target, async () => {
    const created = await stageText(parent, text, async (stagedFile) => {
      try {
        // Publish the complete draft exclusively, even when two tabs save to the same path.
        await link(stagedFile, target);
        return true;
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === "EEXIST") return false;
        throw cause;
      }
    });
    if (!created) return { status: "exists" as const };
    // Removing the staging link changes ctime, so read the revision after cleanup.
    const info = await inspectFile(target);
    if (!info) throw new Error("The file was removed immediately after saving.");
    return { status: "created" as const, ...fileMetadata(info) };
  });
}

async function serializeWrite<T>(path: string, write: () => Promise<T>): Promise<T> {
  const pending = pendingWrites.get(path);
  const current = pending ? pending.catch(() => {}).then(write) : write();
  pendingWrites.set(path, current);
  try {
    return await current;
  } finally {
    if (pendingWrites.get(path) === current) pendingWrites.delete(path);
  }
}

async function stageText<T>(parent: string, text: string, publish: (file: string) => Promise<T>) {
  const staging = await mkdtemp(join(parent, ".live-markdown-"));
  const file = join(staging, "draft");
  try {
    await writeFile(file, text, "utf8");
    return await publish(file);
  } finally {
    await rm(staging, { recursive: true, force: true }).catch((cause) => {
      console.warn("Could not remove the Markdown save directory.", cause);
    });
  }
}

async function locateFile(root: string, path: string): Promise<string | null> {
  const absoluteRoot = await requireRoot(root);
  const absolute = resolveMarkdownPath(absoluteRoot, path);
  const parent = await realpath(dirname(absolute)).catch((cause) => {
    if (isMissing(cause)) return null;
    throw cause;
  });
  return parent ? join(requireInside(absoluteRoot, parent), basename(absolute)) : null;
}

async function inspectFile(path: string): Promise<BigIntStats | null> {
  const info = await lstat(path, { bigint: true }).catch((cause) => {
    if (isMissing(cause)) return null;
    throw cause;
  });
  if (info?.isSymbolicLink()) throw new Error("The Markdown file must not be a symlink.");
  return info?.isFile() ? info : null;
}

async function ensureDirectoryInside(root: string, directory: string): Promise<string> {
  const actual = await realpath(directory).catch((cause) => {
    if (isMissing(cause)) return null;
    throw cause;
  });
  if (actual) return requireInside(root, actual);
  if (directory === root) throw new Error("The workspace directory is not available.");

  const parent = await ensureDirectoryInside(root, dirname(directory));
  const child = join(parent, basename(directory));
  await mkdir(child, { recursive: true });
  return requireInside(root, await realpath(child));
}

async function requireRoot(root: string): Promise<string> {
  const absolute = await realpath(root);
  if (!(await stat(absolute)).isDirectory())
    throw new Error("The workspace directory is not available.");
  return absolute;
}

function resolveMarkdownPath(root: string, path: string): string {
  const normalized = normalizeMarkdownPath(path);
  if (!normalized || !isMarkdownPath(path)) {
    throw new Error("Choose a relative .md or .markdown path inside the workspace.");
  }
  return requireInside(root, resolve(root, normalized));
}

function requireInside(root: string, path: string): string {
  const fromRoot = relative(root, path);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error("The file is outside the workspace.");
  }
  return path;
}

function isMissing(cause: unknown): boolean {
  const code = (cause as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

function revisionOf(info: BigIntStats): string {
  return [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(":");
}

function fileMetadata(info: BigIntStats) {
  return {
    size: Number(info.size),
    modifiedAt: Number(info.mtimeNs) / 1_000_000,
    revision: revisionOf(info),
  };
}
