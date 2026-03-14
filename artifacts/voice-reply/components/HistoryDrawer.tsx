import React, { useState } from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  FlatList,
  StyleSheet,
  Alert,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ReplySession } from "@/contexts/VoiceReplyContext";

type Props = {
  visible: boolean;
  onClose: () => void;
  history: ReplySession[];
  colors: {
    background: string;
    card: string;
    text: string;
    textSecondary: string;
    textMuted: string;
    primary: string;
    border: string;
    inputBg: string;
    success: string;
  };
  onHistoryUpdate: (sessions: ReplySession[]) => void;
};

function HistoryItem({
  session,
  colors,
  onDelete,
}: {
  session: ReplySession;
  colors: Props["colors"];
  onDelete: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await Clipboard.setStringAsync(session.reply);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const date = new Date(session.createdAt);
  const timeStr = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const dateStr = date.toLocaleDateString([], { month: "short", day: "numeric" });

  return (
    <View style={[styles.historyItem, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.historyItemHeader}>
        <Text style={[styles.historyTime, { color: colors.textMuted }]}>
          {dateStr} · {timeStr}
        </Text>
        <View style={styles.historyItemActions}>
          <Pressable
            onPress={handleCopy}
            style={({ pressed }) => [styles.historyAction, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Feather
              name={copied ? "check" : "copy"}
              size={15}
              color={copied ? colors.success : colors.textMuted}
            />
          </Pressable>
          <Pressable
            onPress={onDelete}
            style={({ pressed }) => [styles.historyAction, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Feather name="trash-2" size={15} color={colors.textMuted} />
          </Pressable>
        </View>
      </View>

      {session.context ? (
        <Text
          numberOfLines={2}
          style={[styles.historyContext, { color: colors.textMuted }]}
        >
          Re: "{session.context}"
        </Text>
      ) : null}

      <Text numberOfLines={3} style={[styles.historyReply, { color: colors.text }]}>
        {session.reply}
      </Text>

      <View style={[styles.toneTag, { backgroundColor: colors.inputBg }]}>
        <Text style={[styles.toneTagText, { color: colors.textSecondary }]}>
          {session.tone}
        </Text>
      </View>
    </View>
  );
}

export function HistoryDrawer({ visible, onClose, history, colors, onHistoryUpdate }: Props) {
  const insets = useSafeAreaInsets();

  const handleDelete = async (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const updated = history.filter((s) => s.id !== id);
    onHistoryUpdate(updated);
    await AsyncStorage.setItem("voicereply_history", JSON.stringify(updated));
  };

  const handleClearAll = () => {
    Alert.alert(
      "Clear History",
      "Remove all saved replies?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear All",
          style: "destructive",
          onPress: async () => {
            onHistoryUpdate([]);
            await AsyncStorage.removeItem("voicereply_history");
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          },
        },
      ]
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.modal, { backgroundColor: colors.background, paddingBottom: insets.bottom }]}>
        <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
          <Text style={[styles.modalTitle, { color: colors.text }]}>History</Text>
          <View style={styles.modalHeaderActions}>
            {history.length > 0 && (
              <Pressable
                onPress={handleClearAll}
                style={({ pressed }) => [styles.clearBtn, { opacity: pressed ? 0.6 : 1 }]}
              >
                <Text style={[styles.clearBtnText, { color: colors.primary }]}>
                  Clear all
                </Text>
              </Pressable>
            )}
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [styles.closeBtn, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Feather name="x" size={22} color={colors.text} />
            </Pressable>
          </View>
        </View>

        {history.length === 0 ? (
          <View style={styles.emptyState}>
            <Feather name="clock" size={40} color={colors.textMuted} />
            <Text style={[styles.emptyText, { color: colors.textMuted }]}>
              No replies yet
            </Text>
            <Text style={[styles.emptySubtext, { color: colors.textMuted }]}>
              Your generated replies will appear here
            </Text>
          </View>
        ) : (
          <FlatList
            data={history}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => (
              <HistoryItem
                session={item}
                colors={colors}
                onDelete={() => handleDelete(item.id)}
              />
            )}
            ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modal: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalTitle: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
  },
  modalHeaderActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  clearBtn: {
    padding: 4,
  },
  clearBtnText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  closeBtn: {
    padding: 4,
  },
  listContent: {
    padding: 16,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingBottom: 80,
  },
  emptyText: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
  },
  emptySubtext: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    maxWidth: 240,
  },
  historyItem: {
    borderRadius: 14,
    padding: 14,
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  historyItemHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  historyTime: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  historyItemActions: {
    flexDirection: "row",
    gap: 12,
  },
  historyAction: {
    padding: 2,
  },
  historyContext: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    fontStyle: "italic",
    lineHeight: 18,
  },
  historyReply: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },
  toneTag: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  toneTagText: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    textTransform: "capitalize",
  },
});
