import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import type { Tone } from "@/contexts/VoiceReplyContext";

type ToneOption = {
  value: Tone;
  label: string;
  icon: keyof typeof Feather.glyphMap;
};

const TONE_OPTIONS: ToneOption[] = [
  { value: "friendly", label: "Friendly", icon: "smile" },
  { value: "formal", label: "Formal", icon: "briefcase" },
  { value: "casual", label: "Casual", icon: "coffee" },
];

type Props = {
  selected: Tone;
  onSelect: (tone: Tone) => void;
  primaryColor: string;
  textColor: string;
  mutedColor: string;
  cardColor: string;
};

export function ToneSelector({
  selected,
  onSelect,
  primaryColor,
  textColor,
  mutedColor,
  cardColor,
}: Props) {
  return (
    <View style={styles.container}>
      {TONE_OPTIONS.map((option) => {
        const isSelected = selected === option.value;
        return (
          <Pressable
            key={option.value}
            onPress={() => {
              Haptics.selectionAsync();
              onSelect(option.value);
            }}
            style={({ pressed }) => [
              styles.option,
              {
                backgroundColor: isSelected ? primaryColor : cardColor,
                borderColor: isSelected ? primaryColor : "transparent",
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <Feather
              name={option.icon}
              size={16}
              color={isSelected ? "#FFFFFF" : mutedColor}
            />
            <Text
              style={[
                styles.label,
                {
                  color: isSelected ? "#FFFFFF" : mutedColor,
                  fontFamily: isSelected ? "Inter_600SemiBold" : "Inter_400Regular",
                },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    gap: 8,
  },
  option: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  label: {
    fontSize: 13,
  },
});
