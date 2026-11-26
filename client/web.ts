import type { PluginFilePanelProps } from "@getpaseo/plugin/client";
import type { EditorView, EditorViewConfig } from "@codemirror/view";
import { Platform } from "react-native";

export interface MarkdownEditorOptions {
  text: string;
  theme: PluginFilePanelProps["theme"];
  placeholder: string;
  ariaLabel: string;
  onChange(text: string): void;
  /** Fraction (0–1) of the editor's scrollable height, for keeping a preview in step. */
  onScrollRatio?(ratio: number): void;
  /** Cmd/Ctrl+S inside the editor. */
  onSave?(): void;
}

export interface MarkdownEditorHandle {
  /** Replaces the editor's text without reporting it as an edit. */
  setText(text: string): void;
  focus(): void;
  blur(): void;
  destroy(): void;
}

const MONO_FONT =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

/** DOM code stays here so native never evaluates CodeMirror. */
export function mountMarkdownEditor(
  parent: unknown,
  options: MarkdownEditorOptions,
): MarkdownEditorHandle | null {
  if (Platform.OS !== "web" || !parent) return null;

  const { EditorState } = require("@codemirror/state") as typeof import("@codemirror/state");
  const {
    EditorView,
    drawSelection,
    highlightActiveLine,
    highlightActiveLineGutter,
    keymap,
    lineNumbers,
    placeholder,
  } = require("@codemirror/view") as typeof import("@codemirror/view");
  const { defaultKeymap, history, historyKeymap, indentWithTab } =
    require("@codemirror/commands") as typeof import("@codemirror/commands");
  const { markdown } =
    require("@codemirror/lang-markdown") as typeof import("@codemirror/lang-markdown");
  const { HighlightStyle, syntaxHighlighting } =
    require("@codemirror/language") as typeof import("@codemirror/language");
  const { tags } = require("@lezer/highlight") as typeof import("@lezer/highlight");

  const colors = options.theme.colors;
  const selection = withAlpha(colors.accent, "3d") ?? colors.surface2;
  const highlightStyle = HighlightStyle.define([
    {
      tag: [
        tags.heading1,
        tags.heading2,
        tags.heading3,
        tags.heading4,
        tags.heading5,
        tags.heading6,
      ],
      color: colors.foreground,
      fontWeight: "700",
    },
    { tag: tags.strong, color: colors.foreground, fontWeight: "700" },
    { tag: tags.emphasis, fontStyle: "italic" },
    { tag: tags.strikethrough, textDecoration: "line-through", color: colors.foregroundMuted },
    { tag: tags.link, color: colors.accent, textDecoration: "underline" },
    { tag: tags.url, color: colors.foregroundMuted },
    { tag: tags.monospace, fontFamily: MONO_FONT, color: colors.foreground },
    { tag: tags.quote, color: colors.foregroundMuted, fontStyle: "italic" },
    { tag: tags.list, color: colors.foregroundMuted },
    {
      tag: [tags.processingInstruction, tags.meta, tags.contentSeparator],
      color: colors.foregroundMuted,
    },
  ]);

  let applyingHostText = false;
  const view: EditorView = new EditorView({
    parent: parent as EditorViewConfig["parent"],
    state: EditorState.create({
      doc: options.text,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        history(),
        drawSelection(),
        markdown(),
        syntaxHighlighting(highlightStyle),
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              options.onSave?.();
              return true;
            },
          },
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        EditorView.lineWrapping,
        EditorState.tabSize.of(2),
        placeholder(options.placeholder),
        EditorView.contentAttributes.of({ "aria-label": options.ariaLabel }),
        EditorView.theme({
          "&": {
            height: "100%",
            backgroundColor: colors.surface0,
            color: colors.foreground,
            fontSize: "13px",
          },
          "&.cm-focused": { outline: "none" },
          ".cm-scroller": { overflow: "auto", fontFamily: MONO_FONT, lineHeight: "1.7" },
          ".cm-content": { padding: "16px 18px 40vh", caretColor: colors.accent },
          ".cm-gutters": {
            backgroundColor: colors.surface0,
            color: colors.foregroundMuted,
            border: "none",
            opacity: "0.7",
          },
          ".cm-activeLine": { backgroundColor: colors.surface1 },
          ".cm-activeLineGutter": { backgroundColor: colors.surface1, color: colors.foreground },
          "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
            backgroundColor: selection,
          },
          ".cm-cursor, .cm-dropCursor": {
            borderLeftColor: colors.accent,
            borderLeftWidth: "2px",
          },
          ".cm-placeholder": { color: colors.foregroundMuted },
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !applyingHostText) options.onChange(update.state.doc.toString());
        }),
      ],
    }),
  });

  const scroller = view.scrollDOM;
  const handleScroll = () => {
    if (!options.onScrollRatio) return;
    const max = scroller.scrollHeight - scroller.clientHeight;
    options.onScrollRatio(max > 0 ? scroller.scrollTop / max : 0);
  };
  scroller.addEventListener("scroll", handleScroll, { passive: true });

  return {
    setText(next) {
      if (view.state.doc.toString() === next) return;
      applyingHostText = true;
      try {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: next },
          selection: { anchor: 0 },
        });
      } finally {
        applyingHostText = false;
      }
    },
    focus() {
      view.focus();
    },
    blur() {
      view.contentDOM.blur();
    },
    destroy() {
      scroller.removeEventListener("scroll", handleScroll);
      view.destroy();
    },
  };
}

/** CodeMirror selection needs a translucent fill; opaque theme accents would hide the text. */
function withAlpha(color: string, alpha: string): string | null {
  return /^#[0-9a-f]{6}$/i.test(color) ? `${color}${alpha}` : null;
}
