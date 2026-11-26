import {
  type PluginWorkspacePanelProps,
  useRpc,
  useTabState,
  useTranslation,
  useWorkspace,
} from "@getpaseo/plugin/client";
import { Loading } from "@getpaseo/plugin/client/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { z } from "zod";
import { suggestMarkdownPathRpc } from "../shared/markdown";
import { normalizeMarkdownPath } from "../shared/paths";
import { documentViewSchema, MarkdownDocumentView } from "./document-view";
import { messages } from "./messages";
import { useRpcMarkdownFile } from "./rpc-file";
import { useMarkdownDocument } from "./use-document";

const workspaceStateSchema = documentViewSchema.extend({ path: z.string().nullable() });

export function MarkdownWorkspacePanel(props: PluginWorkspacePanelProps) {
  const directory = useWorkspace(props.workspaceId, (workspace) => workspace.directory);
  if (!directory) return <Loading />;
  return <WorkspaceEditor key={props.workspaceId} {...props} />;
}

function WorkspaceEditor({ workspaceId, tab, theme, layout }: PluginWorkspacePanelProps) {
  const { t } = useTranslation(messages);
  const [state, setState] = useTabState(tab, workspaceStateSchema, {
    path: null,
    previewLeft: true,
    view: layout.platform === "web" ? "split" : "write",
  });
  const [initialPath] = useState(state.path);
  const file = useRpcMarkdownFile(workspaceId, initialPath, t("fileExists"));
  const path = file.relativePath;
  // A document without a path is a draft: nothing is written until the user saves it explicitly.
  const isDraft = useCallback(() => file.relativePath === null, [file]);
  const document = useMarkdownDocument(file, tab, { isDraft, blank: !initialPath });
  const suggestPath = useRpc(suggestMarkdownPathRpc);
  const untitled = `${t("untitledName")}.md`;
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [destination, setDestination] = useState<string | null>(null);
  const [invalidPath, setInvalidPath] = useState(false);
  const styles = useMemo(() => saveStyles(theme), [theme]);
  const saving = document.phase === "saving";
  const canSave =
    document.loaded &&
    !document.loadError &&
    !document.issue &&
    !saving &&
    document.phase !== "saved";

  useEffect(() => {
    if (path && path !== state.path) setState({ ...state, path });
  }, [path, setState, state]);

  useEffect(() => {
    if (path && showSaveForm) setShowSaveForm(false);
  }, [path, showSaveForm]);

  const suggestDestination = () => {
    if (destination) return;
    void suggestPath({ workspaceId, base: t("untitledName") })
      .then(({ path }) => setDestination((current) => current ?? path))
      .catch(() => {
        setDestination((current) => current ?? untitled);
      });
  };

  const requestSave = () => {
    if (!canSave) return;
    if (path) {
      document.saveNow();
      return;
    }
    setInvalidPath(false);
    setShowSaveForm(true);
    suggestDestination();
  };

  const saveDraft = () => {
    if (!document.loaded || saving) return;
    const normalized = normalizeMarkdownPath(destination ?? untitled);
    setInvalidPath(!normalized);
    if (!normalized) return;
    file.setDestination(normalized);
    document.saveNow();
  };

  return (
    <MarkdownDocumentView
      document={{ ...document, saveNow: requestSave }}
      size={file.size}
      view={state.view}
      onViewChange={(view) => setState({ ...state, path, view })}
      previewLeft={state.previewLeft}
      onSwapPanes={() => setState({ ...state, path, previewLeft: !state.previewLeft })}
      theme={theme}
      layout={layout}
      subtitle={path ?? t("draftTitle")}
      focusEditorOnMount={!initialPath}
      nativeEditor
      actions={
        <Pressable
          accessibilityRole="button"
          disabled={!canSave}
          onPress={requestSave}
          style={({ pressed }) => [styles.button, (!canSave || pressed) && styles.dimmed]}
          testID="live-markdown-save"
        >
          <Text style={styles.action}>{t("save")}</Text>
        </Pressable>
      }
      beforeEditor={
        !path && showSaveForm ? (
          <View style={styles.form} testID="live-markdown-save-form">
            <View style={styles.row}>
              <TextInput
                autoFocus
                autoCapitalize="none"
                autoCorrect={false}
                selectTextOnFocus
                accessibilityLabel={t("pathLabel")}
                placeholder="notes/plan.md"
                placeholderTextColor={theme.colors.foregroundMuted}
                value={destination ?? untitled}
                onChangeText={(value) => {
                  setDestination(value);
                  setInvalidPath(false);
                }}
                editable={!saving}
                onSubmitEditing={saveDraft}
                style={styles.input}
                testID="live-markdown-save-path"
              />
              <Pressable
                accessibilityRole="button"
                disabled={saving}
                onPress={saveDraft}
                style={styles.button}
                testID="live-markdown-confirm-save"
              >
                <Text style={styles.action}>{t("save")}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={saving}
                onPress={() => setShowSaveForm(false)}
                style={styles.button}
              >
                <Text style={styles.cancel}>{t("cancel")}</Text>
              </Pressable>
            </View>
            <Text style={invalidPath ? styles.error : styles.hint}>
              {t(invalidPath ? "invalidPath" : "pathHint")}
            </Text>
          </View>
        ) : null
      }
    />
  );
}

function saveStyles({ colors }: PluginWorkspacePanelProps["theme"]) {
  return {
    form: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      gap: 4,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.surface1,
    },
    row: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
    input: {
      flex: 1,
      minWidth: 0,
      color: colors.foreground,
      backgroundColor: colors.surface0,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 5,
      fontSize: 12,
    },
    button: { paddingHorizontal: 6, paddingVertical: 4 },
    dimmed: { opacity: 0.5 },
    action: { color: colors.accent, fontSize: 12, fontWeight: "600" as const },
    cancel: { color: colors.foregroundMuted, fontSize: 12 },
    hint: { color: colors.foregroundMuted, fontSize: 11 },
    error: { color: colors.statusDanger, fontSize: 11 },
  };
}
