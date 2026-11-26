import type { PluginHostProps } from "@getpaseo/plugin/client";
import { Markdown } from "@getpaseo/plugin/client/ui";
import { useMemo, type RefObject } from "react";
import { ScrollView, Text, View, type LayoutChangeEvent } from "react-native";
import { splitFrontMatter } from "./document";

export interface PreviewPaneProps {
  text: string;
  theme: PluginHostProps["theme"];
  scrollRef: RefObject<ScrollView | null>;
  emptyLabel: string;
  testID?: string;
  onLayout?: (event: LayoutChangeEvent) => void;
  onContentSizeChange?: (width: number, height: number) => void;
}

/**
 * The rendered document, using Paseo's own Markdown component: the same engine, typography, code
 * highlighting, tables, and link handling as agent messages and the built-in Markdown panel.
 */
export function PreviewPane({
  text,
  theme,
  scrollRef,
  emptyLabel,
  testID,
  onLayout,
  onContentSizeChange,
}: PreviewPaneProps) {
  const document = useMemo(() => splitFrontMatter(text), [text]);
  const styles = useMemo(() => createStyles(theme), [theme]);
  const empty = document.frontMatter.length === 0 && document.body.trim().length === 0;

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.scroll}
      contentContainerStyle={styles.content}
      testID={testID}
      onLayout={onLayout}
      scrollEventThrottle={32}
      onContentSizeChange={onContentSizeChange}
      showsVerticalScrollIndicator
    >
      <View style={styles.frame}>
        {document.frontMatter.length > 0 ? (
          <View style={styles.frontMatter} testID="live-markdown-front-matter">
            {document.frontMatter.map((row, index) => (
              <View key={row.key} style={[styles.frontMatterRow, index > 0 && styles.rowBorder]}>
                <View style={styles.frontMatterKeyCell}>
                  <Text selectable style={styles.frontMatterKey}>
                    {row.key}
                  </Text>
                </View>
                <View style={styles.frontMatterValueCell}>
                  <Text selectable style={styles.frontMatterValue}>
                    {row.value}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        ) : null}
        {empty ? <Text style={styles.empty}>{emptyLabel}</Text> : null}
        <Markdown>{document.body}</Markdown>
      </View>
    </ScrollView>
  );
}

function createStyles(theme: PluginHostProps["theme"]) {
  const { colors } = theme;
  return {
    scroll: { flex: 1, minHeight: 0, backgroundColor: colors.surface0 },
    content: { paddingHorizontal: 12, paddingVertical: 8 },
    frame: { width: "100%" as const, maxWidth: 820, alignSelf: "center" as const, padding: 12 },
    frontMatter: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      overflow: "hidden" as const,
      marginBottom: 20,
    },
    frontMatterRow: { flexDirection: "row" as const, alignItems: "stretch" as const },
    rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
    frontMatterKeyCell: {
      flexBasis: "30%" as const,
      maxWidth: 180,
      paddingHorizontal: 10,
      paddingVertical: 6,
      backgroundColor: colors.surface1,
    },
    frontMatterValueCell: { flex: 1, minWidth: 0, paddingHorizontal: 10, paddingVertical: 6 },
    frontMatterKey: {
      color: colors.foregroundMuted,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 12,
      lineHeight: 18,
    },
    frontMatterValue: { color: colors.foreground, fontSize: 13, lineHeight: 18 },
    empty: { color: colors.foregroundMuted, fontSize: 13, paddingVertical: 8 },
  };
}
