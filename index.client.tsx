import type { PluginClientContext } from "@getpaseo/plugin/client";
import { messages } from "./client/messages";
import { LiveMarkdownPanel } from "./client/panel";
import { MarkdownWorkspacePanel } from "./client/workspace-panel";

export default function contribute(client: PluginClientContext) {
  client.addFilePanel({
    id: "live-markdown",
    title: messages.message("panelTitle"),
    icon: "FileText",
    files: { extensions: ["md", "markdown"] },
    Component: LiveMarkdownPanel,
  });
  // Workspace panels are what the new-tab (+) menu lists, next to Diff and Browser.
  client.addWorkspacePanel({
    id: "markdown",
    title: messages.message("panelTitle"),
    icon: "FileText",
    locations: ["workspace", "explorer"],
    Component: MarkdownWorkspacePanel,
  });
  return () => {};
}
