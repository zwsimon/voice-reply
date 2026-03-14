import React, { useEffect } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withRepeat,
  withTiming,
  cancelAnimation,
  Easing,
} from "react-native-reanimated";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

type Props = {
  isRecording: boolean;
  onPress: () => void;
  color: string;
  size?: number;
  disabled?: boolean;
};

export function RecordButton({ isRecording, onPress, color, size = 80, disabled }: Props) {
  const scale = useSharedValue(1);
  const pulseScale = useSharedValue(1);
  const pulseOpacity = useSharedValue(0);

  useEffect(() => {
    if (isRecording) {
      pulseOpacity.value = withRepeat(
        withTiming(0, { duration: 1200, easing: Easing.out(Easing.ease) }),
        -1,
        false
      );
      pulseScale.value = withRepeat(
        withTiming(1.6, { duration: 1200, easing: Easing.out(Easing.ease) }),
        -1,
        false
      );
    } else {
      cancelAnimation(pulseOpacity);
      cancelAnimation(pulseScale);
      pulseOpacity.value = withTiming(0, { duration: 300 });
      pulseScale.value = withTiming(1, { duration: 300 });
    }
  }, [isRecording]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
    opacity: pulseOpacity.value,
  }));

  const buttonStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePress = () => {
    if (disabled) return;
    scale.value = withSpring(0.9, { damping: 10 }, () => {
      scale.value = withSpring(1, { damping: 10 });
    });
    Haptics.impactAsync(
      isRecording
        ? Haptics.ImpactFeedbackStyle.Heavy
        : Haptics.ImpactFeedbackStyle.Medium
    );
    onPress();
  };

  return (
    <View style={[styles.wrapper, { width: size * 2, height: size * 2 }]}>
      <Animated.View
        style={[
          styles.pulse,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: color,
          },
          pulseStyle,
        ]}
      />
      <Animated.View style={buttonStyle}>
        <Pressable
          onPress={handlePress}
          disabled={disabled}
          style={[
            styles.button,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: isRecording ? "#FF3B5C" : color,
            },
          ]}
        >
          <Feather
            name={isRecording ? "square" : "mic"}
            size={size * 0.35}
            color="#FFFFFF"
          />
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: "center",
    justifyContent: "center",
  },
  pulse: {
    position: "absolute",
  },
  button: {
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
});
