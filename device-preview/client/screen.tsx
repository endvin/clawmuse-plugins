import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image, View, type GestureResponderEvent, type LayoutChangeEvent } from "react-native";
import type { InputAction, PreviewImage } from "../shared/contracts.js";
import { GestureTracker } from "./gestures.js";
import { nativePoint } from "../shared/geometry.js";

interface ScreenProps {
  image: PreviewImage;
  enabled: boolean;
  send(action: InputAction): void;
  displayed(sequence: number): void;
  decodeFailed(): void;
}
export function DeviceScreen({ image, enabled, send, displayed, decodeFailed }: ScreenProps) {
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const tracker = useRef(new GestureTracker());
  const loaded = useRef<string | null>(null);
  const turned = image.rotation % 180 !== 0;
  const viewWidth = turned ? image.height : image.width,
    viewHeight = turned ? image.width : image.height;
  const ratio = Math.min(bounds.width / viewWidth, bounds.height / viewHeight);
  const width = Math.max(0, viewWidth * ratio),
    height = Math.max(0, viewHeight * ratio);
  const rootStyle = useMemo(
    () => ({
      flex: 1,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      minHeight: 100,
    }),
    [],
  );
  const screenStyle = useMemo(() => ({ width, height }), [width, height]);
  const imageStyle = useMemo(
    () => ({
      width: image.width * ratio,
      height: image.height * ratio,
      position: "absolute" as const,
      left: (width - image.width * ratio) / 2,
      top: (height - image.height * ratio) / 2,
      transform: [{ rotate: `${image.rotation}deg` }],
    }),
    [width, height, image.width, image.height, image.rotation, ratio],
  );
  const source = useMemo(() => ({ uri: `data:${image.mime};base64,${image.base64}` }), [image]);
  const layout = useCallback((event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout;
    if (next.width > 0 && next.height > 0) setBounds({ width: next.width, height: next.height });
  }, []);
  const update = useCallback(
    (event: GestureResponderEvent) => {
      if (!enabled || width <= 0 || height <= 0) return;
      const points = event.nativeEvent.touches.map((touch) =>
        nativePoint(
          Math.min(1, Math.max(0, touch.locationX / width)),
          Math.min(1, Math.max(0, touch.locationY / height)),
          image.rotation,
        ),
      );
      for (const action of tracker.current.update(points, image.geometry)) send(action);
    },
    [enabled, width, height, image.geometry, image.rotation, send],
  );
  const release = useCallback(() => {
    for (const action of tracker.current.release()) send(action);
  }, [send]);
  const canRespond = useCallback(() => enabled, [enabled]);
  const onLoad = useCallback(() => {
    loaded.current = image.base64;
    displayed(image.sequence);
  }, [image.base64, image.sequence, displayed]);
  useEffect(() => {
    if (loaded.current === image.base64) displayed(image.sequence);
  }, [image.base64, image.sequence, displayed]);
  useEffect(() => {
    if (!enabled) release();
  }, [enabled, release]);
  return (
    <View style={rootStyle} onLayout={layout}>
      <View
        style={screenStyle}
        onStartShouldSetResponder={canRespond}
        onMoveShouldSetResponder={canRespond}
        onResponderGrant={update}
        onResponderStart={update}
        onResponderMove={update}
        onResponderEnd={update}
        onResponderRelease={release}
        onResponderTerminate={release}
      >
        <View pointerEvents="none" style={screenStyle}>
          <Image
            source={source}
            style={imageStyle}
            resizeMode="contain"
            accessibilityLabel="主机模拟器实时画面"
            onLoad={onLoad}
            onError={decodeFailed}
          />
        </View>
      </View>
    </View>
  );
}
