import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const workspaceInput = z.object({ workspaceId: z.string().min(1) });
const fileInput = workspaceInput.extend({ path: z.string().min(1) });
const fileMetadata = z.object({
  size: z.number(),
  modifiedAt: z.number(),
  revision: z.string(),
});
const missing = z.object({ status: z.literal("missing") });

export const suggestMarkdownPathRpc = defineRpc({
  name: "live-markdown.suggest_path",
  input: workspaceInput.extend({ base: z.string().min(1) }),
  output: z.object({ path: z.string() }),
});

export const readMarkdownFileRpc = defineRpc({
  name: "live-markdown.read_file",
  input: fileInput,
  output: z.discriminatedUnion("status", [
    fileMetadata.extend({ status: z.literal("ok"), text: z.string() }),
    missing,
  ]),
});

export const statMarkdownFileRpc = defineRpc({
  name: "live-markdown.stat_file",
  input: fileInput,
  output: z.discriminatedUnion("status", [
    fileMetadata.extend({ status: z.literal("ok") }),
    missing,
  ]),
});

export const writeMarkdownFileRpc = defineRpc({
  name: "live-markdown.write_file",
  input: fileInput.extend({
    text: z.string(),
    expectedRevision: z.string().nullable(),
    force: z.boolean().default(false),
  }),
  output: z.discriminatedUnion("status", [
    fileMetadata.extend({ status: z.literal("ok") }),
    z.object({ status: z.literal("conflict") }),
    missing,
  ]),
});

export const createMarkdownFileRpc = defineRpc({
  name: "live-markdown.create_file",
  input: fileInput.extend({ text: z.string() }),
  output: z.discriminatedUnion("status", [
    fileMetadata.extend({ status: z.literal("created") }),
    z.object({ status: z.literal("exists") }),
  ]),
});
