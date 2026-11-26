import { type PluginFilePanelProps, useTabState } from "@getpaseo/plugin/client";
import { useCallback } from "react";
import {
  defaultNativeView,
  defaultWebView,
  documentViewSchema,
  MarkdownDocumentView,
  type PanelView,
} from "./document-view";
import { useMarkdownDocument } from "./use-document";

/** A Markdown file tab: the shared writing surface over Paseo's file handle. */
export function LiveMarkdownPanel({ file, tab, theme, layout }: PluginFilePanelProps) {
  const isWeb = layout.platform === "web";
  const [state, setState] = useTabState(
    tab,
    documentViewSchema,
    isWeb ? defaultWebView : defaultNativeView,
  );
  const document = useMarkdownDocument(file, tab);
  const setView = useCallback((view: PanelView) => setState({ ...state, view }), [setState, state]);

  return (
    <MarkdownDocumentView
      document={document}
      size={file.size}
      view={state.view}
      onViewChange={setView}
      previewLeft={state.previewLeft}
      onSwapPanes={() => setState({ ...state, previewLeft: !state.previewLeft })}
      theme={theme}
      layout={layout}
    />
  );
}
