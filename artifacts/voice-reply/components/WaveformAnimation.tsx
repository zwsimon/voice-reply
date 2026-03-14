import React, { useEffect, useRef } from "react";
import { View, StyleSheet } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withRepeat,
  withTiming,
  cancelAnimation,
  Easing,
} from "react-native-reanimated";

type Props = {
  amplitude: number;
  isActive: boolean;
  color: string;
  barCount?: number;
};

const NUM_BARS = 7;

function WaveBar({
  index,
  amplitude,
  isActive,
  color,
  total,
}: {
  index: number;
  amplitude: number;
  isActive: boolean;
  color: string;
  total: number;
}) {
  const height = useSharedValue(4);
  const opacity = useSharedValue(0.4);

  useEffect(() => {
    if (isActive) {
      const offset = Math.sin((index / total) * Math.PI);
      const targetH = 8 + amplitude * 44 * (0.5 + 0.5 * offset);

      height.value = withSpring(targetH, { damping: 8, stiffness: 200 });

      const delay = index * 60;
      opacity.value = withRepeat(
        withTiming(0.9, { duration: 400 + delay, easing: Easing.inOut(Easing.sine) }),
        -1,
        true
      );
    } else {
      cancelAnimation(height);
      cancelAnimation(opacity);
      height.value = withSpring(4, { damping: 12, stiffness: 150 });
      opacity.value = withTiming(0.4, { duration: 300 });
    }
  }, [isActive, amplitude]);

  const animStyle = useAnimatedStyle(() => ({
    height: height.value,
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        styles.bar,
        { backgroundColor: color, borderRadius: 4 },
        animStyle,
      ]}
    />
  );
}

export function WaveformAnimation({ amplitude, isActive, color, barCount = NUM_BARS }: Props) {
  return (
    <View style={styles.container}>
      {Array.from({ length: barCount }).map((_, i) => (
        <WaveBar
          key={i}
          index={i}
          amplitude={amplitude}
          isActive={isActive}
          color={color}
          total={barCount}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    height: 56,
  },
  bar: {
    width: 5,
    borderRadius: 4,
  },
});
