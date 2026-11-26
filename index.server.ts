import type { PluginHandlerContext, PluginServerContext } from "@getpaseo/plugin/server";
import {
  createMarkdownFileRpc,
  readMarkdownFileRpc,
  statMarkdownFileRpc,
  suggestMarkdownPathRpc,
  writeMarkdownFileRpc,
} from "./shared/markdown";
import {
  createMarkdownFile,
  readMarkdownFile,
  statMarkdownFile,
  suggestMarkdownPath,
  writeMarkdownFile,
} from "./server/markdown-files";

async function workspaceRoot(
  { paseo }: PluginHandlerContext,
  workspaceId: string,
): Promise<string> {
  const workspace = await paseo.workspaces.ref(workspaceId).refresh();
  if (!workspace?.workspaceDirectory) throw new Error("The workspace directory is not available.");
  return workspace.workspaceDirectory;
}

export default function contribute(server: PluginServerContext) {
  server.handle(suggestMarkdownPathRpc, async ({ workspaceId, base }, context) =>
    suggestMarkdownPath(await workspaceRoot(context, workspaceId), base),
  );
  server.handle(readMarkdownFileRpc, async ({ workspaceId, path }, context) =>
    readMarkdownFile(await workspaceRoot(context, workspaceId), path),
  );
  server.handle(statMarkdownFileRpc, async ({ workspaceId, path }, context) =>
    statMarkdownFile(await workspaceRoot(context, workspaceId), path),
  );
  server.handle(writeMarkdownFileRpc, async ({ workspaceId, ...input }, context) =>
    writeMarkdownFile({ ...input, root: await workspaceRoot(context, workspaceId) }),
  );
  server.handle(createMarkdownFileRpc, async ({ workspaceId, path, text }, context) =>
    createMarkdownFile(await workspaceRoot(context, workspaceId), path, text),
  );
  return () => {};
}
