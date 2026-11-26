import {
  useTranslation,
  type PluginFilePanelProps,
  type PluginHostProps,
} from "@getpaseo/plugin/client";
import { Loading } from "@getpaseo/plugin/client/ui";
import {
  useCallback,
  useDeferredValue,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Pressable, ScrollView, Text, TextInput, View, type LayoutChangeEvent } from "react-native";
import { z } from "zod";
import { documentStats } from "./document";
import { formatBytes } from "./format";
import { type MarkdownEditorHandle, mountMarkdownEditor } from "./web";
import { messages } from "./messages";
import { PreviewPane } from "./preview";
import type { MarkdownDocument } from "./use-document";

export const documentViewSchema = z.object({
  view: z.enum(["write", "split", "preview", "source"]),
  previewLeft: z.boolean().default(true),
});
export type PanelView = z.infer<typeof documentViewSchema>["view"];
type WebView = "write" | "split" | "preview";
type NativeView = "preview" | "source";

export const defaultWebView = { view: "split", previewLeft: true } as const;
export const defaultNativeView = { view: "preview", previewLeft: true } as const;

/** Below this width a side-by-side split gets too narrow to write in. */
const STACK_BREAKPOINT = 680;
const MONO_FONT = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';

export interface MarkdownDocumentViewProps {
  document: MarkdownDocument;
  /** Current byte size of the file, for the toolbar readout. */
  size: number;
  view: PanelView;
  onViewChange(view: PanelView): void;
  previewLeft: boolean;
  onSwapPanes(): void;
  theme: PluginHostProps["theme"];
  layout: PluginFilePanelProps["layout"];
  actions?: ReactNode;
  beforeEditor?: ReactNode;
  focusEditorOnMount?: boolean;
  nativeEditor?: boolean;
  /** Workspace-relative path, shown instead of the stats in narrow tabs. */
  subtitle?: string;
}

/**
 * The writing surface shared by the file panel and the Markdown workspace: CodeMirror on web, a
 * live preview through Paseo's Markdown component, and source-only readbacks on native.
 */
export function MarkdownDocumentView({
  document,
  size,
  view: requestedView,
  onViewChange,
  previewLeft,
  onSwapPanes,
  theme,
  layout,
  actions,
  beforeEditor,
  focusEditorOnMount = false,
  nativeEditor = false,
  subtitle,
}: MarkdownDocumentViewProps) {
  const { t } = useTranslation(messages);
  const isWeb = layout.platform === "web";

  // A tab can move between clients, so a desktop view can arrive on a phone and vice versa.
  const webView: WebView = requestedView === "source" ? "write" : requestedView;
  const nativeView: NativeView = requestedView === "source" ? "source" : "preview";
  const nativeWrite = !isWeb && nativeEditor && requestedView !== "preview";
  const view: PanelView = isWeb ? webView : nativeWrite ? "write" : nativeView;
  const split = isWeb && webView === "split";
  const showEditor = isWeb && webView !== "preview";
  const showSource = !isWeb && !nativeWrite && nativeView === "source";
  const showPreview = !nativeWrite && !showSource && (!isWeb || webView !== "write");
  const canMountEditor = isWeb && document.loaded && !document.loadError;

  const [width, setWidth] = useState(0);
  const stacked = width > 0 ? width < STACK_BREAKPOINT : layout.compact;
  const stats = useMemo(() => documentStats(document.text), [document.text]);
  const previewText = useDeferredValue(document.text);

  const editorHost = useRef<View>(null);
  const editor = useRef<MarkdownEditorHandle | null>(null);
  const textRef = useRef(document.text);
  const changeRef = useRef(document.change);
  const saveRef = useRef(document.saveNow);
  const splitRef = useRef(split);
  const shouldFocus = useRef(focusEditorOnMount && showEditor);
  const labelsRef = useRef({ placeholder: t("placeholder"), ariaLabel: t("editorLabel") });
  const previewScroll = useRef<ScrollView | null>(null);
  const previewContentHeight = useRef(0);
  const previewViewportHeight = useRef(0);
  const lastReplaceVersion = useRef(-1);
  const { accent, foreground, foregroundMuted, surface0, surface1, surface2 } = theme.colors;

  useLayoutEffect(() => {
    textRef.current = document.text;
    changeRef.current = document.change;
    saveRef.current = document.saveNow;
    splitRef.current = split;
    labelsRef.current = { placeholder: t("placeholder"), ariaLabel: t("editorLabel") };
  });

  const scrollPreview = useCallback((ratio: number) => {
    const range = Math.max(0, previewContentHeight.current - previewViewportHeight.current);
    previewScroll.current?.scrollTo({ y: ratio * range, animated: false });
  }, []);

  useLayoutEffect(() => {
    if (!canMountEditor || !editorHost.current) return;
    const handle = mountMarkdownEditor(editorHost.current, {
      text: textRef.current,
      theme,
      placeholder: labelsRef.current.placeholder,
      ariaLabel: labelsRef.current.ariaLabel,
      onChange: (next) => changeRef.current(next),
      onSave: () => saveRef.current(),
      onScrollRatio: (ratio) => {
        if (splitRef.current) scrollPreview(ratio);
      },
    });
    editor.current = handle;
    if (shouldFocus.current && handle) {
      shouldFocus.current = false;
      handle.focus();
    }
    return () => {
      handle?.destroy();
      editor.current = null;
    };
  }, [
    accent,
    canMountEditor,
    foreground,
    foregroundMuted,
    scrollPreview,
    surface0,
    surface1,
    surface2,
  ]);

  // Disk reads and conflict rewrites replace the buffer; push that into the editor without
  // feeding it back as an edit.
  useLayoutEffect(() => {
    if (!isWeb || !document.loaded) return;
    if (document.replaceVersion === lastReplaceVersion.current) return;
    lastReplaceVersion.current = document.replaceVersion;
    editor.current?.setText(textRef.current);
  }, [document.loaded, document.replaceVersion, isWeb]);

  const chooseView = useCallback(
    (next: PanelView) => {
      onViewChange(next);
      if (!isWeb) return;
      if (next === "preview") editor.current?.blur();
      else setTimeout(() => editor.current?.focus(), 0);
    },
    [isWeb, onViewChange],
  );

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width);
  }, []);
  const handlePreviewLayout = useCallback((event: LayoutChangeEvent) => {
    previewViewportHeight.current = event.nativeEvent.layout.height;
  }, []);
  const handlePreviewContentSize = useCallback((_width: number, height: number) => {
    previewContentHeight.current = height;
  }, []);

  const styles = useMemo(
    () => createStyles(theme, split && stacked, split && previewLeft),
    [previewLeft, split, stacked, theme],
  );

  const modes = isWeb
    ? ([
        { value: "write" as const, label: t("write"), description: t("writeView") },
        { value: "split" as const, label: t("split"), description: t("splitView") },
        { value: "preview" as const, label: t("preview"), description: t("previewView") },
      ] as const)
    : ([
        ...(nativeEditor
          ? [{ value: "write" as const, label: t("write"), description: t("writeView") }]
          : []),
        { value: "preview" as const, label: t("preview"), description: t("previewView") },
        ...(!nativeEditor
          ? [{ value: "source" as const, label: t("readOnlySource"), description: t("sourceView") }]
          : []),
      ] as const);
  const showStats = !subtitle || width === 0 || width >= 720;

  return (
    <View style={styles.panel} onLayout={handleLayout}>
      <View style={styles.toolbar}>
        <View style={styles.metadata}>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
          {showStats ? (
            <>
              <Text style={styles.whisper} numberOfLines={1}>
                {formatBytes(size)}
              </Text>
              <Text style={styles.whisper} numberOfLines={1}>
                {t("lines", { count: stats.lines })}
              </Text>
              <Text style={styles.whisper} numberOfLines={1}>
                {t("words", { count: stats.words })}
              </Text>
            </>
          ) : null}
        </View>
        <View style={styles.status}>
          {document.phase === "dirty" ? <View style={styles.dirtyDot} /> : null}
          {document.phase === "saving" ? (
            <Text style={styles.statusText}>{t("saving")}</Text>
          ) : null}
          {document.phase === "error" ? (
            <Text style={styles.errorText}>{t("saveFailed")}</Text>
          ) : null}
        </View>
        {actions}
        {split ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={stacked ? t("swapStackedPanes") : t("swapPanes")}
            onPress={onSwapPanes}
            style={({ pressed }) => [styles.swap, pressed && styles.segmentPressed]}
            testID="live-markdown-swap-panes"
          >
            <Text style={styles.segmentLabel}>{stacked ? "⇅" : "⇄"}</Text>
          </Pressable>
        ) : null}
        <View style={styles.switch} testID="live-markdown-view-switch">
          {modes.map((mode) => {
            const selected = mode.value === view;
            return (
              <Pressable
                key={mode.value}
                accessibilityRole="button"
                accessibilityLabel={mode.description}
                accessibilityState={{ selected }}
                onPress={() => chooseView(mode.value)}
                testID={`live-markdown-view-${mode.value}`}
                style={({ pressed }) => [
                  styles.segment,
                  selected && styles.segmentSelected,
                  pressed && styles.segmentPressed,
                ]}
              >
                <Text style={[styles.segmentLabel, selected && styles.segmentLabelSelected]}>
                  {mode.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {beforeEditor}

      {document.issue === "conflict" ? (
        <View style={styles.banner} testID="live-markdown-conflict">
          <Text style={styles.bannerText}>{t("conflict")}</Text>
          <Pressable accessibilityRole="button" onPress={document.reloadFromDisk}>
            <Text style={styles.action}>{t("reload")}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={document.overwrite}>
            <Text style={styles.action}>{t("overwrite")}</Text>
          </Pressable>
        </View>
      ) : null}
      {document.issue === "deleted" ? (
        <View style={styles.banner} testID="live-markdown-deleted">
          <Text style={styles.bannerText}>{t("deleted")}</Text>
        </View>
      ) : null}
      {document.phase === "error" && document.error ? (
        <View style={styles.errorBar}>
          <Text style={styles.errorText} numberOfLines={2}>
            {document.error}
          </Text>
        </View>
      ) : null}

      {document.loadError ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{t("loadFailed")}</Text>
          <Text style={styles.errorDetail} numberOfLines={3}>
            {document.loadError}
          </Text>
          <Pressable accessibilityRole="button" onPress={document.retryLoad}>
            <Text style={styles.action}>{t("retry")}</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.body}>
          {isWeb ? (
            <View
              style={[
                styles.editorPane,
                split && styles.editorDivider,
                !showEditor && styles.hidden,
              ]}
              testID="live-markdown-editor-pane"
            >
              <View ref={editorHost} style={styles.editorHost} />
            </View>
          ) : null}
          {nativeWrite ? (
            <TextInput
              multiline
              autoFocus={focusEditorOnMount}
              editable={document.loaded}
              textAlignVertical="top"
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel={t("editorLabel")}
              placeholder={t("placeholder")}
              placeholderTextColor={foregroundMuted}
              value={document.text}
              onChangeText={document.change}
              style={styles.nativeEditor}
            />
          ) : showSource ? (
            <ScrollView style={styles.sourceScroll} contentContainerStyle={styles.sourceContent}>
              <Text selectable style={styles.sourceText}>
                {document.text}
              </Text>
            </ScrollView>
          ) : showPreview ? (
            <View style={split ? styles.previewSplit : styles.previewFill}>
              <PreviewPane
                text={previewText}
                theme={theme}
                scrollRef={previewScroll}
                emptyLabel={t("emptyDocument")}
                testID="live-markdown-preview"
                onLayout={handlePreviewLayout}
                onContentSizeChange={handlePreviewContentSize}
              />
            </View>
          ) : null}
          {document.loaded ? null : <Loading />}
        </View>
      )}
    </View>
  );
}

function createStyles(theme: PluginHostProps["theme"], stacked: boolean, previewFirst: boolean) {
  const { colors } = theme;
  return {
    panel: { flex: 1, minHeight: 0, backgroundColor: colors.surface0 },
    toolbar: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
      paddingHorizontal: 12,
      height: 36,
      flexShrink: 0,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    metadata: {
      flex: 1,
      minWidth: 0,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
      overflow: "hidden" as const,
    },
    subtitle: { color: colors.foreground, fontSize: 12, flexShrink: 1 },
    whisper: { color: colors.foregroundMuted, fontSize: 12, flexShrink: 1 },
    status: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
    statusText: { color: colors.foregroundMuted, fontSize: 12 },
    dirtyDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.foregroundMuted },
    errorText: { color: colors.statusDanger, fontSize: 12 },
    errorDetail: { color: colors.foregroundMuted, fontSize: 12, textAlign: "center" as const },
    switch: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 2,
      padding: 2,
      borderRadius: 7,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface1,
      flexShrink: 0,
    },
    swap: {
      alignItems: "center" as const,
      minWidth: 28,
      paddingVertical: 4,
      borderRadius: 5,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface1,
    },
    segment: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 5,
      borderWidth: 1,
      borderColor: "transparent",
    },
    segmentSelected: {
      backgroundColor: colors.surface0,
      borderWidth: 1,
      borderColor: colors.border,
    },
    segmentPressed: { opacity: 0.75 },
    segmentLabel: { color: colors.foregroundMuted, fontSize: 12 },
    segmentLabelSelected: { color: colors.foreground, fontWeight: "600" as const },
    banner: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 12,
      paddingHorizontal: 12,
      paddingVertical: 8,
      flexShrink: 0,
      backgroundColor: colors.surface1,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    bannerText: { flex: 1, color: colors.foreground, fontSize: 12 },
    action: { color: colors.accent, fontSize: 12, fontWeight: "600" as const },
    errorBar: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      backgroundColor: colors.surface1,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    center: {
      flex: 1,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      gap: 10,
      padding: 24,
    },
    body: {
      flex: 1,
      minHeight: 0,
      flexDirection: stacked
        ? previewFirst
          ? ("column-reverse" as const)
          : ("column" as const)
        : previewFirst
          ? ("row-reverse" as const)
          : ("row" as const),
    },
    editorPane: { flex: 1, minWidth: 0, minHeight: 0, backgroundColor: colors.surface0 },
    editorDivider: {
      borderColor: colors.border,
      borderLeftWidth: !stacked && previewFirst ? 1 : 0,
      borderRightWidth: !stacked && !previewFirst ? 1 : 0,
      borderTopWidth: stacked && previewFirst ? 1 : 0,
      borderBottomWidth: stacked && !previewFirst ? 1 : 0,
    },
    editorHost: { flex: 1, minHeight: 0 },
    previewSplit: { flex: 1, minWidth: 0, minHeight: 0, backgroundColor: colors.surface0 },
    previewFill: { flex: 1, minWidth: 0, minHeight: 0, backgroundColor: colors.surface0 },
    hidden: { display: "none" as const },
    sourceScroll: { flex: 1, minHeight: 0, backgroundColor: colors.surface0 },
    sourceContent: { padding: 16 },
    nativeEditor: { flex: 1, padding: 16, color: colors.foreground, fontFamily: "monospace" },
    sourceText: {
      color: colors.foreground,
      fontFamily: MONO_FONT,
      fontSize: 12,
      lineHeight: 20,
    },
  };
}
