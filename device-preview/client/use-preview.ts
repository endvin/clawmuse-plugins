import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AppState } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import {
  capabilitiesRpc,
  listRpc,
  startRpc,
  frameRpc,
  inputRpc,
  stopRpc,
  qualityPresets,
  type Platform,
  type Quality,
  type Device,
  type OperationStatus,
  type PreviewImage,
  type InputAction,
} from "../shared/contracts.js";
import { InputQueue } from "./gestures.js";

export function usePreview(platform: Platform, quality: Quality, visible = true) {
  const capabilities = useRpc(capabilitiesRpc),
    list = useRpc(listRpc),
    start = useRpc(startRpc),
    frame = useRpc(frameRpc),
    input = useRpc(inputRpc),
    stop = useRpc(stopRpc);
  const [operation, setOperation] = useState<OperationStatus | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [foreground, setForeground] = useState(AppState.currentState !== "background");
  const [decodeError, setDecodeError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [controlPending, setControlPending] = useState(false);
  const [controlNotice, setControlNotice] = useState<string | null>(null);
  const decoded = useRef(0),
    waitingSince = useRef(0);
  const latestStatus = useRef<OperationStatus | null>(null);
  const generation = useRef(0),
    active = useRef<string | null>(null),
    image = useRef<PreviewImage | null>(null),
    queue = useRef<InputQueue | null>(null);
  const caps = useQuery({
    queryKey: ["device-preview", "capabilities"],
    queryFn: () => capabilities({}),
    staleTime: 60_000,
    retry: false,
  });
  const devices = useQuery({
    queryKey: ["device-preview", "list", platform],
    queryFn: () => list({ platform }),
    enabled: caps.data?.[platform].available === true,
    staleTime: 0,
    retry: false,
    refetchInterval: 10_000,
  });
  const frames = useQuery({
    queryKey: ["device-preview", "frame", operation?.operationId],
    enabled: operation !== null && foreground && visible,
    retry: false,
    gcTime: 0,
    staleTime: 0,
    queryFn: async () => {
      const id = operation!.operationId;
      if (image.current && decoded.current < image.current.sequence) {
        if (Date.now() - waitingSince.current > 5000)
          throw new Error("画面解码超时，请停止预览后选择省流画质重试");
        return {
          status: latestStatus.current ?? operation!,
          image: image.current,
          unchanged: true,
        };
      }
      const received = await frame({
        operationId: id,
        afterSequence: image.current?.sequence ?? 0,
      });
      if (active.current !== id) return { status: received.status, image: null, unchanged: true };
      if (received.image) {
        image.current = received.image;
        waitingSince.current = Date.now();
      }
      latestStatus.current = received.status;
      return { ...received, image: image.current };
    },
    refetchInterval: (query) => {
      if (query.state.error) return false;
      if (decodeError) return false;
      // Wait for the native Image decoder before admitting another image.
      if (image.current && decoded.current < image.current.sequence) {
        return 100;
      }
      const phase = query.state.data?.status.phase;
      if (phase === "failed" || phase === "stopped") return false;
      return phase === "ready" ? 1000 / qualityPresets[quality].fps : 500;
    },
  });
  const disconnect = useMutation({
    mutationFn: async () => {
      generation.current++;
      setStarting(false);
      queue.current?.close();
      queue.current = null;
      const id = active.current;
      active.current = null;
      image.current = null;
      latestStatus.current = null;
      decoded.current = 0;
      setDecodeError(null);
      setOperation(null);
      setInputError(null);
      setControlPending(false);
      setControlNotice(null);
      if (id) await stop({ operationId: id });
      await devices.refetch();
    },
  });
  const connect = useMutation({
    mutationFn: async (device: Device) => {
      const token = ++generation.current;
      setStarting(true);
      let connected: OperationStatus;
      try {
        connected = await start({ platform, deviceId: device.id, quality });
      } finally {
        if (token === generation.current) setStarting(false);
      }
      if (token !== generation.current) {
        await stop({ operationId: connected.operationId });
        return;
      }
      active.current = connected.operationId;
      image.current = null;
      latestStatus.current = null;
      decoded.current = 0;
      setDecodeError(null);
      setInputError(null);
      setControlPending(false);
      setControlNotice(null);
      setOperation(connected);
      queue.current?.close();
      queue.current = new InputQueue(
        async (action) => {
          const control = action.type !== "touch";
          if (control) {
            setControlPending(true);
            setControlNotice(null);
          }
          try {
            await input({ operationId: connected.operationId, action });
            if (control && active.current === connected.operationId) setControlNotice("操作已发送");
          } finally {
            if (control && active.current === connected.operationId) setControlPending(false);
          }
        },
        (error) => {
          if (active.current !== connected.operationId) return;
          setInputError(error instanceof Error ? error.message : "输入失败，请重新连接");
        },
      );
    },
  });
  useEffect(
    () => () => {
      generation.current++;
      queue.current?.close();
      const id = active.current;
      active.current = null;
      if (id) void stop({ operationId: id }).catch(() => {});
    },
    [stop],
  );
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setForeground(state === "active"),
    );
    return () => subscription.remove();
  }, []);
  const send = useCallback((action: InputAction) => {
    queue.current?.push(action);
  }, []);
  const status = frames.data?.status ?? operation;
  const error = disconnect.error ?? connect.error ?? frames.error ?? devices.error ?? caps.error;
  const refresh = useCallback(() => {
    void caps.refetch();
    void devices.refetch();
  }, [caps, devices]);
  const retryFrames = useCallback(() => {
    void frames.refetch();
  }, [frames]);
  const displayed = useCallback((sequence: number) => {
    decoded.current = sequence;
  }, []);
  const decodeFailed = useCallback(
    () => setDecodeError("画面解码失败，请停止预览后选择省流画质重试"),
    [],
  );
  return {
    caps,
    devices,
    connect,
    disconnect,
    starting,
    controlPending,
    controlNotice,
    status,
    image: frames.data?.image ?? null,
    send,
    inputError: inputError ?? decodeError,
    error,
    refresh,
    retryFrames,
    displayed,
    decodeFailed,
    active: foreground && visible,
  };
}
