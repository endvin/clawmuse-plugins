import type { PluginClientContext } from "@getpaseo/plugin/client";
import { PreviewPanel } from "./client/panel.js";

export default function contribute(client: PluginClientContext) {
  const panel = client.addWorkspacePanel({
    id: "preview",
    title: "设备预览",
    icon: "Smartphone",
    locations: ["workspace", "explorer"],
    Component: PreviewPanel,
  });
  const command = client.addCommandCenterItem({
    id: "open-preview",
    title: "打开设备预览",
    icon: "Smartphone",
    keywords: ["iOS", "Android", "simulator", "emulator"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("preview", { location: "explorer" });
    },
  });
  return () => {
    command();
    panel();
  };
}
