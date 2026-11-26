import {
  PluginFileConflictError,
  PluginFileDeletedError,
  type PluginFile,
  type PluginTab,
} from "@getpaseo/plugin/client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/** How long after the last keystroke the file is written. */
export const SAVE_DELAY_MS = 600;

export type SavePhase = "saved" | "dirty" | "saving" | "error";
export type DocumentIssue = "conflict" | "deleted" | null;
const neverDraft = () => false;

export interface MarkdownDocument {
  /** The live buffer: the text the editor shows and the preview renders. */
  text: string;
  loaded: boolean;
  /** Increments whenever the buffer is replaced from disk instead of typed. */
  replaceVersion: number;
  phase: SavePhase;
  issue: DocumentIssue;
  error: string | null;
  loadError: string | null;
  change(text: string): void;
  reloadFromDisk(): void;
  overwrite(): void;
  saveNow(): void;
  retryLoad(): void;
}

/**
 * Reads the file once, writes shortly after the last edit, and follows the disk while nothing is
 * unsaved. A disk change with unsaved edits is a conflict the user resolves explicitly.
 */
export function useMarkdownDocument(
  file: Pick<PluginFile, "readText" | "writeText" | "watch">,
  tab: PluginTab,
  { isDraft = neverDraft, blank = false } = {},
): MarkdownDocument {
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(blank);
  const [replaceVersion, setReplaceVersion] = useState(0);
  const [phase, setPhase] = useState<SavePhase>("saved");
  const [issue, setIssue] = useState<DocumentIssue>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const alive = useRef(true);
  const latest = useRef("");
  const unsaved = useRef(false);
  const saving = useRef(false);
  const issueRef = useRef<DocumentIssue>(null);
  const issueVersion = useRef(0);
  const readVersion = useRef(0);
  const editVersion = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The host recreates `tab` when the pane's persisted state changes (for example on every view
  // switch). Reading the callback through a ref keeps the file watcher and save loop mounted for
  // as long as the file is, instead of flushing and re-reading on each view change.
  const setModified = useRef(tab.setModified);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    setModified.current = tab.setModified;
  });

  const markModified = useCallback((modified: boolean) => {
    setModified.current(modified);
  }, []);

  const reportIssue = useCallback((next: DocumentIssue) => {
    issueVersion.current += 1;
    issueRef.current = next;
    setIssue(next);
    if (next) clearTimeout(saveTimer.current);
  }, []);

  const applyDiskText = useCallback(
    (next: string) => {
      latest.current = next;
      unsaved.current = false;
      setText(next);
      setReplaceVersion((version) => version + 1);
      setPhase("saved");
      reportIssue(null);
      setError(null);
      setLoadError(null);
      markModified(false);
    },
    [markModified, reportIssue],
  );

  const load = useCallback(
    async (discardEdits = false) => {
      const request = ++readVersion.current;
      const edits = editVersion.current;
      try {
        const next = await file.readText();
        if (!alive.current || request !== readVersion.current) return;
        if (edits !== editVersion.current || (!discardEdits && unsaved.current)) {
          reportIssue("conflict");
          return;
        }
        applyDiskText(next);
        setLoaded(true);
      } catch (cause) {
        if (!alive.current || request !== readVersion.current) return;
        if (unsaved.current) {
          reportIssue(cause instanceof PluginFileDeletedError ? "deleted" : "conflict");
          return;
        }
        setLoadError(messageOf(cause));
        setLoaded(true);
      }
    },
    [applyDiskText, file, reportIssue],
  );

  const persist = useCallback(
    async (force: boolean) => {
      if (!alive.current || saving.current || !unsaved.current || issueRef.current === "deleted") {
        return;
      }
      if (!force && issueRef.current) return;
      saving.current = true;
      try {
        // Keep writing while edits arrive during a write, so the disk ends on the buffer.
        do {
          const next = latest.current;
          const previousIssue = issueVersion.current;
          if (alive.current) {
            setPhase("saving");
            setError(null);
          }
          await file.writeText(next, force ? { force: true } : undefined);
          if (alive.current && force && issueVersion.current === previousIssue) reportIssue(null);
          force = false;
          if (latest.current === next) {
            unsaved.current = false;
            if (!alive.current) return;
            setPhase("saved");
            setError(null);
            markModified(false);
          } else if (alive.current && issueRef.current) {
            setPhase("dirty");
          }
        } while (alive.current && !isDraft() && unsaved.current && !issueRef.current);
      } catch (cause) {
        if (!alive.current) return;
        if (cause instanceof PluginFileConflictError) {
          reportIssue("conflict");
          setPhase("dirty");
        } else if (cause instanceof PluginFileDeletedError) {
          reportIssue("deleted");
          setPhase("dirty");
        } else {
          setError(messageOf(cause));
          setPhase("error");
        }
      } finally {
        saving.current = false;
      }
    },
    [file, isDraft, markModified, reportIssue],
  );

  const scheduleSave = useCallback(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void persist(false), SAVE_DELAY_MS);
  }, [persist]);

  const change = useCallback(
    (next: string) => {
      editVersion.current += 1;
      latest.current = next;
      unsaved.current = true;
      setText(next);
      if (!saving.current) setPhase("dirty");
      markModified(true);
      if (!isDraft() && !issueRef.current) scheduleSave();
    },
    [isDraft, markModified, scheduleSave],
  );

  const reloadFromDisk = useCallback(() => {
    clearTimeout(saveTimer.current);
    void load(true);
  }, [load]);

  const overwrite = useCallback(() => {
    clearTimeout(saveTimer.current);
    void persist(true);
  }, [persist]);

  const saveNow = useCallback(() => {
    clearTimeout(saveTimer.current);
    void persist(false);
  }, [persist]);

  const retryLoad = useCallback(() => {
    setLoadError(null);
    void load();
  }, [load]);

  useEffect(() => {
    if (!blank) void load();
    const unwatch = file.watch((event) => {
      if (event.type === "deleted") {
        readVersion.current += 1;
        reportIssue("deleted");
        return;
      }
      if (!unsaved.current) void load();
      else reportIssue("conflict");
    });
    return () => {
      unwatch();
      // Unmount also follows an explicit "Close without saving" action in Paseo.
      clearTimeout(saveTimer.current);
      readVersion.current += 1;
    };
  }, [blank, file, load, reportIssue]);

  return {
    text,
    loaded,
    replaceVersion,
    phase,
    issue,
    error,
    loadError,
    change,
    reloadFromDisk,
    overwrite,
    saveNow,
    retryLoad,
  };
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
