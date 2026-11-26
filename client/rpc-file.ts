import {
  PluginFileConflictError,
  PluginFileDeletedError,
  useRpc,
  type PluginFile,
  type PluginFileWriteOptions,
} from "@getpaseo/plugin/client";
import { useLayoutEffect, useMemo, useRef } from "react";
import {
  createMarkdownFileRpc,
  readMarkdownFileRpc,
  statMarkdownFileRpc,
  writeMarkdownFileRpc,
} from "../shared/markdown";

const WATCH_INTERVAL_MS = 3000;

/**
 * A `PluginFile` over the plugin's RPC file operations, so the Markdown workspace can reuse the
 * same read/save/conflict logic as a file tab. `watch` polls a cheap stat instead of the contents.
 */
export function useRpcMarkdownFile(
  workspaceId: string,
  initialPath: string | null,
  fileExistsMessage: string,
) {
  const create = useRpc(createMarkdownFileRpc);
  const read = useRpc(readMarkdownFileRpc);
  const statFile = useRpc(statMarkdownFileRpc);
  const write = useRpc(writeMarkdownFileRpc);
  const existsMessage = useRef(fileExistsMessage);
  useLayoutEffect(() => {
    existsMessage.current = fileExistsMessage;
  }, [fileExistsMessage]);

  return useMemo(() => {
    let path = initialPath;
    let destination: string | null = null;
    let size = 0;
    let revision: string | null = null;
    let observedRevision: string | null = null;
    let writing = 0;
    let generation = 0;

    const readText = async (): Promise<string> => {
      if (!path) return "";
      const result = await read({ workspaceId, path });
      if (result.status === "missing") throw new PluginFileDeletedError();
      size = result.size;
      observedRevision = revision = result.revision;
      return result.text;
    };

    const writeText = async (text: string, options?: PluginFileWriteOptions): Promise<void> => {
      writing += 1;
      generation += 1;
      try {
        if (!path) {
          const target = destination;
          if (!target) throw new Error("A destination is required.");
          const result = await create({ workspaceId, path: target, text });
          if (result.status === "exists") throw new Error(existsMessage.current);
          path = target;
          size = result.size;
          observedRevision = revision = result.revision;
          return;
        }
        const result = await write({
          workspaceId,
          path,
          text,
          expectedRevision: revision,
          force: options?.force ?? false,
        });
        if (result.status === "missing") throw new PluginFileDeletedError();
        if (result.status === "conflict") throw new PluginFileConflictError();
        size = result.size;
        observedRevision = revision = result.revision;
      } finally {
        writing -= 1;
      }
    };

    return {
      get name() {
        return path?.split("/").at(-1) ?? "";
      },
      get relativePath() {
        return path;
      },
      setDestination(next: string) {
        destination = next;
      },
      get size() {
        return size;
      },
      readText,
      writeText,
      watch(listener) {
        let stopped = false;
        let polling = false;
        let timer: ReturnType<typeof setInterval> | null = null;
        const stop = () => {
          stopped = true;
          if (timer !== null) clearInterval(timer);
        };
        timer = setInterval(async () => {
          if (stopped || polling || writing > 0 || !path) return;
          polling = true;
          const startedAt = generation;
          try {
            const result = await statFile({ workspaceId, path });
            // A write that started while the stat was in flight makes its answer stale.
            if (stopped || writing > 0 || startedAt !== generation) return;
            if (result.status === "missing") {
              stop();
              listener({ type: "deleted" });
              return;
            }
            if (result.revision !== observedRevision) {
              observedRevision = result.revision;
              listener({ type: "changed" });
            }
          } catch {
            // A transient RPC failure is not a file change.
          } finally {
            polling = false;
          }
        }, WATCH_INTERVAL_MS);
        return stop;
      },
    } satisfies Pick<PluginFile, "name" | "size" | "readText" | "writeText" | "watch"> & {
      relativePath: string | null;
      setDestination(path: string): void;
    };
  }, [create, initialPath, read, statFile, workspaceId, write]);
}
