import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View, type LayoutChangeEvent } from "react-native";
import type { PluginHostProps, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Modal } from "@getpaseo/plugin/client/ui";
import { usePreview } from "./use-preview.js";
import { DeviceScreen } from "./screen.js";
import type { Device, Platform, Quality, InputAction } from "../shared/contracts.js";

interface ActionProps extends PluginHostProps {
  title: string;
  onPress(): void;
  disabled?: boolean;
}
function Action({ theme, layout, title, onPress, disabled = false }: ActionProps) {
  const style = useMemo(
    () => ({
      paddingHorizontal: layout.compact ? 12 : 10,
      paddingVertical: layout.compact ? 12 : 8,
      borderRadius: 6,
      backgroundColor: theme.colors.surface1,
      opacity: disabled ? 0.45 : 1,
    }),
    [theme, layout.compact, disabled],
  );
  const text = useMemo(() => ({ color: theme.colors.foreground, fontSize: 13 }), [theme]);
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={style}>
      <Text style={text}>{title}</Text>
    </Pressable>
  );
}
const phases = {
  preparing: "正在准备设备与原生画面流…",
  ready: "已连接",
  failed: "连接失败",
  stopped: "预览已停止",
} as const;
const labels = { back: "返回", home: "Home", recents: "最近任务", rotate: "旋转" } as const;

interface DeviceRowProps extends PluginHostProps {
  device: Device;
  disabled: boolean;
  onSelect(device: Device): void;
}
function DeviceRow({ device, disabled, onSelect, theme, layout, host }: DeviceRowProps) {
  const style = useMemo(
    () => ({ gap: layout.compact ? 6 : 8, paddingVertical: layout.compact ? 10 : 12 }),
    [layout.compact],
  );
  const title = useMemo(() => ({ color: theme.colors.foreground, fontSize: 14 }), [theme]);
  const detail = useMemo(() => ({ color: theme.colors.foregroundMuted, fontSize: 12 }), [theme]);
  let state = "未启动";
  if (device.state === "booted") state = "已启动";
  if (device.state === "unavailable") state = "不可用";
  if (device.busy) state = "占用";
  const select = useCallback(() => onSelect(device), [onSelect, device]);
  return (
    <View style={style}>
      <Text style={title}>
        {device.name} · {state}
      </Text>
      {device.reason && <Text style={detail}>{device.reason}</Text>}
      <Action
        title={device.state === "booted" ? "预览" : "启动并预览"}
        onPress={select}
        disabled={disabled || device.busy || device.state === "unavailable"}
        theme={theme}
        layout={layout}
        host={host}
      />
    </View>
  );
}

interface ControlsProps extends PluginHostProps {
  controls: string[];
  send(action: InputAction): void;
  disabled: boolean;
}
interface ControlButtonProps extends PluginHostProps {
  action: keyof typeof labels;
  send(action: InputAction): void;
  disabled: boolean;
}
function ControlButton({ action, send, ...props }: ControlButtonProps) {
  const press = useCallback(() => send({ type: action }), [action, send]);
  return <Action {...props} title={labels[action]} onPress={press} />;
}
function Controls({ controls, send, disabled, theme, layout, host }: ControlsProps) {
  const [menu, setMenu] = useState(false);
  const row = useMemo(
    () => ({
      flexDirection: "row" as const,
      flexWrap: "wrap" as const,
      gap: layout.compact ? 8 : 6,
    }),
    [layout.compact],
  );
  const content = useMemo(() => ({ gap: layout.compact ? 12 : 8 }), [layout.compact]);
  const toggle = useCallback(() => setMenu((value) => !value), []);
  const close = useCallback(() => setMenu(false), []);
  const available: (keyof typeof labels)[] = ["back", "home", "recents", "rotate"];
  const buttons = available
    .filter((key) => controls.includes(key))
    .map((key) => (
      <ControlButton
        key={key}
        action={key}
        send={send}
        disabled={disabled}
        theme={theme}
        layout={layout}
        host={host}
      />
    ));
  const dark = useCallback(() => send({ type: "appearance", dark: true }), [send]);
  const light = useCallback(() => send({ type: "appearance", dark: false }), [send]);
  if (controls.includes("appearance"))
    buttons.push(
      <Action
        key="light"
        title="浅色"
        onPress={light}
        disabled={disabled}
        theme={theme}
        layout={layout}
        host={host}
      />,
      <Action
        key="dark"
        title="深色"
        onPress={dark}
        disabled={disabled}
        theme={theme}
        layout={layout}
        host={host}
      />,
    );
  if (!layout.compact) return <View style={row}>{buttons}</View>;
  return (
    <View>
      <Action
        title="设备操作"
        onPress={toggle}
        disabled={disabled}
        theme={theme}
        layout={layout}
        host={host}
      />
      <Modal open={menu} onOpenChange={setMenu} title="设备操作">
        <Modal.Content contentContainerStyle={content}>
          {buttons}
          <Action title="关闭" onPress={close} theme={theme} layout={layout} host={host} />
        </Modal.Content>
      </Modal>
    </View>
  );
}

interface PickerProps extends PluginHostProps {
  quality: Quality;
  setQuality(quality: Quality): void;
  preview: ReturnType<typeof usePreview>;
  busy: boolean;
}
function DevicePicker({ theme, layout, host, quality, setQuality, preview, busy }: PickerProps) {
  const row = useMemo(
    () => ({
      flexDirection: "row" as const,
      flexWrap: "wrap" as const,
      gap: layout.compact ? 8 : 6,
    }),
    [layout.compact],
  );
  const scroll = useMemo(() => ({ flex: 1 }), []);
  const muted = useMemo(() => ({ color: theme.colors.foregroundMuted, fontSize: 12 }), [theme]);
  const saving = useCallback(() => setQuality("saving"), [setQuality]),
    balanced = useCallback(() => setQuality("balanced"), [setQuality]),
    clear = useCallback(() => setQuality("clear"), [setQuality]);
  const connect = useCallback(
    (device: Device) => preview.connect.mutate(device),
    [preview.connect],
  );
  return (
    <ScrollView style={scroll}>
      {!preview.status && (
        <View style={row}>
          <Action
            title={quality === "saving" ? "✓ 省流" : "省流"}
            onPress={saving}
            theme={theme}
            layout={layout}
            host={host}
          />
          <Action
            title={quality === "balanced" ? "✓ 均衡" : "均衡"}
            onPress={balanced}
            theme={theme}
            layout={layout}
            host={host}
          />
          <Action
            title={quality === "clear" ? "✓ 清晰" : "清晰"}
            onPress={clear}
            theme={theme}
            layout={layout}
            host={host}
          />
        </View>
      )}
      {preview.devices.data?.devices.map((device) => (
        <DeviceRow
          key={device.id}
          device={device}
          disabled={busy}
          onSelect={connect}
          theme={theme}
          layout={layout}
          host={host}
        />
      ))}
      {preview.devices.data?.devices.length === 0 && (
        <Text style={muted}>
          没有已配置的可用设备。请在主机的 Xcode 或 Android Studio 中准备模拟器，再刷新。
        </Text>
      )}
      {preview.devices.data?.notes.map((note) => (
        <Text key={note} style={muted}>
          {note}
        </Text>
      ))}
    </ScrollView>
  );
}
interface ConnectionProps extends PluginHostProps {
  preview: ReturnType<typeof usePreview>;
}
function ConnectionStatus({ preview, theme, layout, host }: ConnectionProps) {
  const text = useMemo(() => ({ color: theme.colors.foreground, fontSize: 14 }), [theme]);
  let status = "选择设备";
  if (preview.status) status = `${phases[preview.status.phase]} · ${preview.status.deviceId}`;
  if (preview.starting) status = "正在请求预览…";
  if (preview.controlPending) status = "正在发送设备操作…";
  else if (preview.controlNotice) status = `${status} · ${preview.controlNotice}`;
  const error = preview.inputError ?? preview.error?.message ?? preview.status?.reason;
  const stop = useCallback(() => preview.disconnect.mutate(), [preview.disconnect]);
  const canStop = preview.status !== null || preview.starting;
  return (
    <View>
      <Text style={text}>{status}</Text>
      {error && (
        <Text style={text} accessibilityRole="alert">
          {error}
        </Text>
      )}
      {canStop && (
        <Action
          title={preview.disconnect.isPending ? "正在停止…" : "停止预览"}
          onPress={stop}
          disabled={preview.disconnect.isPending}
          theme={theme}
          layout={layout}
          host={host}
        />
      )}
    </View>
  );
}

export function PreviewPanel(props: PluginWorkspacePanelProps) {
  const { theme, layout, host } = props;
  const [platform, setPlatform] = useState<Platform>("ios"),
    [quality, setQuality] = useState<Quality>("balanced");
  const [visible, setVisible] = useState(true);
  const preview = usePreview(platform, quality, visible);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const bounds = event.nativeEvent.layout;
    setVisible(bounds.width > 0 && bounds.height > 0);
  }, []);
  const style = useMemo(
    () => ({
      flex: 1,
      padding: layout.compact ? 12 : 16,
      gap: layout.compact ? 8 : 12,
      backgroundColor: theme.colors.surface0,
    }),
    [theme, layout.compact],
  );
  const row = useMemo(
    () => ({
      flexDirection: "row" as const,
      flexWrap: "wrap" as const,
      gap: layout.compact ? 8 : 6,
      alignItems: "center" as const,
    }),
    [layout.compact],
  );
  const text = useMemo(() => ({ color: theme.colors.foreground, fontSize: 14 }), [theme]);
  const muted = useMemo(() => ({ color: theme.colors.foregroundMuted, fontSize: 12 }), [theme]);
  const busy = preview.starting || preview.status !== null || preview.disconnect.isPending;
  const ready =
    preview.status?.phase === "ready" && !preview.inputError && !preview.error && preview.active;
  const ios = useCallback(() => setPlatform("ios"), []),
    android = useCallback(() => setPlatform("android"), []);
  const capability = preview.caps.data?.[platform];
  return (
    <View style={style} onLayout={onLayout}>
      <Text style={text}>设备预览 · {host.label}</Text>
      <View style={row}>
        <Action
          title={platform === "ios" ? "✓ iOS" : "iOS"}
          onPress={ios}
          disabled={busy}
          theme={theme}
          layout={layout}
          host={host}
        />
        <Action
          title={platform === "android" ? "✓ Android" : "Android"}
          onPress={android}
          disabled={busy}
          theme={theme}
          layout={layout}
          host={host}
        />
        <Action
          title="刷新"
          onPress={preview.refresh}
          disabled={busy}
          theme={theme}
          layout={layout}
          host={host}
        />
      </View>
      <Text style={muted}>{capability?.reason ?? "正在检测主机能力…"}</Text>
      <ConnectionStatus preview={preview} theme={theme} layout={layout} host={host} />
      {preview.status && (
        <Controls
          controls={preview.status.controls}
          send={preview.send}
          disabled={!ready || preview.controlPending}
          theme={theme}
          layout={layout}
          host={host}
        />
      )}
      {preview.image ? (
        <DeviceScreen
          image={preview.image}
          enabled={ready}
          send={preview.send}
          displayed={preview.displayed}
          decodeFailed={preview.decodeFailed}
        />
      ) : (
        <DevicePicker
          quality={quality}
          setQuality={setQuality}
          preview={preview}
          busy={busy}
          theme={theme}
          layout={layout}
          host={host}
        />
      )}
      <Text style={muted}>设备始终运行在主机。关闭或停止预览会释放占用，保留模拟器运行。</Text>
    </View>
  );
}
