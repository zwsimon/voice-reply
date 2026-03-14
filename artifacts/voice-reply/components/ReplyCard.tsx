import React, { useEffect } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  TextInput,
  Alert,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  Easing,
} from "react-native-reanimated";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Feather } from "@expo/vector-icons";

type Props = {
  reply: string;
  transcript: string;
  onEdit: (newReply: string) => void;
  onReset: () => void;
  colors: {
    background: string;
    card: string;
    text: string;
    textSecondary: string;
    textMuted: string;
    primary: string;
    border: string;
    success: string;
    inputBg: string;
  };
};

export function ReplyCard({ reply, transcript, onEdit, onReset, colors }: Props) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(20);
  const [copied, setCopied] = React.useState(false);
  const [isEditing, setIsEditing] = React.useState(false);
  const [editValue, setEditValue] = React.useState(reply);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) });
    translateY.value = withSpring(0, { damping: 16, stiffness: 200 });
    setEditValue(reply);
  }, [reply]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  const handleCopy = async () => {
    await Clipboard.setStringAsync(isEditing ? editValue : reply);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveEdit = () => {
    onEdit(editValue);
    setIsEditing(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  return (
    <Animated.View style={[styles.container, animStyle]}>
      {transcript ? (
        <View style={[styles.transcriptSection, { backgroundColor: colors.inputBg }]}>
          <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>
            You said
          </Text>
          <Text style={[styles.transcriptText, { color: colors.textSecondary }]}>
            "{transcript}"
          </Text>
        </View>
      ) : null}

      <View style={[styles.replySection, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.replyHeader}>
          <View style={styles.replyTitleRow}>
            <View style={[styles.dot, { backgroundColor: colors.primary }]} />
            <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>
              Generated reply
            </Text>
          </View>
          <Pressable
            onPress={() => {
              setIsEditing(!isEditing);
              setEditValue(reply);
              Haptics.selectionAsync();
            }}
            style={({ pressed }) => [styles.editBtn, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Feather
              name={isEditing ? "x" : "edit-2"}
              size={16}
              color={colors.textMuted}
            />
          </Pressable>
        </View>

        {isEditing ? (
          <TextInput
            value={editValue}
            onChangeText={setEditValue}
            multiline
            style={[
              styles.editInput,
              {
                color: colors.text,
                backgroundColor: colors.inputBg,
                borderColor: colors.primary,
                fontFamily: "Inter_400Regular",
              },
            ]}
            autoFocus
          />
        ) : (
          <Text style={[styles.replyText, { color: colors.text }]}>
            {reply}
          </Text>
        )}

        <View style={styles.actions}>
          {isEditing ? (
            <Pressable
              onPress={handleSaveEdit}
              style={({ pressed }) => [
                styles.actionBtn,
                styles.saveBtn,
                { backgroundColor: colors.primary, opacity: pressed ? 0.9 : 1 },
              ]}
            >
              <Feather name="check" size={16} color="#FFFFFF" />
              <Text style={[styles.actionBtnText, { color: "#FFFFFF" }]}>
                Save edit
              </Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={handleCopy}
              style={({ pressed }) => [
                styles.actionBtn,
                styles.copyBtn,
                {
                  backgroundColor: copied ? colors.success : colors.primary,
                  opacity: pressed ? 0.9 : 1,
                },
              ]}
            >
              <Feather
                name={copied ? "check" : "copy"}
                size={16}
                color="#FFFFFF"
              />
              <Text style={[styles.actionBtnText, { color: "#FFFFFF" }]}>
                {copied ? "Copied!" : "Copy reply"}
              </Text>
            </Pressable>
          )}

          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onReset();
            }}
            style={({ pressed }) => [
              styles.actionBtn,
              styles.retryBtn,
              {
                backgroundColor: colors.inputBg,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <Feather name="refresh-cw" size={16} color={colors.textMuted} />
            <Text style={[styles.actionBtnText, { color: colors.textMuted }]}>
              New reply
            </Text>
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  transcriptSection: {
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 4,
  },
  replySection: {
    borderRadius: 16,
    padding: 16,
    gap: 12,
    borderWidth: 1,
  },
  replyHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  replyTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  sectionLabel: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  editBtn: {
    padding: 4,
  },
  transcriptText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
    fontStyle: "italic",
  },
  replyText: {
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    lineHeight: 24,
  },
  editInput: {
    fontSize: 16,
    lineHeight: 24,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    minHeight: 80,
    textAlignVertical: "top",
  },
  actions: {
    flexDirection: "row",
    gap: 10,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  copyBtn: {
    flex: 2,
    justifyContent: "center",
  },
  retryBtn: {
    flex: 1,
    justifyContent: "center",
  },
  saveBtn: {
    flex: 2,
    justifyContent: "center",
  },
  actionBtnText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
});
