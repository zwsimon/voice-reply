import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Platform,
  useColorScheme,
  ScrollView,
  TextInput,
  Dimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";

import Colors from "@/constants/colors";
import { VoiceReplyProvider, useVoiceReply } from "@/contexts/VoiceReplyContext";
import { WaveformAnimation } from "@/components/WaveformAnimation";
import { ToneSelector } from "@/components/ToneSelector";
import { HistoryDrawer } from "@/components/HistoryDrawer";

const { height: SCREEN_H } = Dimensions.get("window");
const SHEET_HEIGHT = 380;

// iMessage color constants
const IM = {
  blue: "#1B84FF",
  bubbleReceived: "#E8E8EA",
  bubbleReceivedDark: "#3A3A3C",
  textReceived: "#000000",
  textReceivedDark: "#FFFFFF",
  background: "#FFFFFF",
  backgroundDark: "#000000",
  headerBg: "rgba(249,249,249,0.94)",
  headerBgDark: "rgba(28,28,30,0.94)",
  separator: "rgba(60,60,67,0.12)",
  separatorDark: "rgba(84,84,88,0.65)",
  composeBg: "rgba(242,242,247,1)",
  composeBgDark: "rgba(28,28,30,1)",
  inputBg: "#FFFFFF",
  inputBgDark: "#1C1C1E",
  inputBorder: "#C6C6C8",
  inputBorderDark: "#38383A",
  iconBlue: "#007AFF",
  timeText: "#8E8E93",
  deliveredText: "#8E8E93",
};

const MOCK_MESSAGES = [
  {
    id: 1,
    from: "them",
    text: "Hey! Are you coming to the team lunch tomorrow at 12:30?",
    time: "10:14 AM",
    tail: true,
  },
  {
    id: 2,
    from: "me",
    text: "What restaurant are we going to?",
    time: "10:15 AM",
    tail: true,
  },
  {
    id: 3,
    from: "them",
    text: "The new Italian place on 5th — La Trattoria. Everyone confirmed already, just need your RSVP!",
    time: "10:17 AM",
    tail: true,
  },
];

function IMessageBubble({
  msg,
  isDark,
  isLast,
}: {
  msg: (typeof MOCK_MESSAGES)[0];
  isDark: boolean;
  isLast: boolean;
}) {
  const isMe = msg.from === "me";
  const bubbleBg = isMe
    ? IM.blue
    : isDark
    ? IM.bubbleReceivedDark
    : IM.bubbleReceived;
  const textColor = isMe ? "#FFF" : isDark ? IM.textReceivedDark : IM.textReceived;

  return (
    <View style={[imStyles.msgGroup, isMe && imStyles.msgGroupMe]}>
      {/* Avatar placeholder for received — only on last in group */}
      {!isMe && (
        <View style={imStyles.avatarSlot}>
          {msg.tail ? (
            <View style={imStyles.imAvatar}>
              <Text style={imStyles.imAvatarText}>S</Text>
            </View>
          ) : null}
        </View>
      )}
      <View style={[imStyles.bubbleWrapper, isMe && imStyles.bubbleWrapperMe]}>
        <View
          style={[
            imStyles.bubble,
            { backgroundColor: bubbleBg },
            isMe ? imStyles.bubbleMe : imStyles.bubbleThem,
          ]}
        >
          <Text style={[imStyles.bubbleText, { color: textColor }]}>
            {msg.text}
          </Text>
        </View>
        {isLast && isMe && (
          <Text style={[imStyles.delivered, { color: IM.deliveredText }]}>
            Delivered
          </Text>
        )}
      </View>
    </View>
  );
}

function getColors(isDark: boolean) {
  return isDark ? Colors.dark : Colors.light;
}

function FloatingOverlay() {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const c = getColors(isDark);

  const {
    recordingState,
    transcript,
    generatedReply,
    tone,
    errorMessage,
    amplitude,
    history,
    setTone,
    setConversationContext,
    startRecording,
    stopRecording,
    reset,
  } = useVoiceReply();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [historyData, setHistoryData] = useState(history);
  const [copied, setCopied] = useState(false);
  const [fabDraft, setFabDraft] = useState("");

  useEffect(() => {
    setHistoryData(history);
  }, [history]);

  const sheetY = useSharedValue(SHEET_HEIGHT);
  const backdropOpacity = useSharedValue(0);

  const isRecording = recordingState === "recording";
  const isProcessing = recordingState === "processing";
  const isDone = recordingState === "done";
  const isError = recordingState === "error";

  // Format today's messages as conversation context for the AI
  const loadConversationContext = () => {
    const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const formatted = MOCK_MESSAGES.map((m) => {
      const sender = m.from === "me" ? "You" : "Simon";
      return `[${m.time}] ${sender}: ${m.text}`;
    }).join("\n");
    setConversationContext(`Conversation on ${today}:\n${formatted}`);
  };

  const openSheet = () => {
    loadConversationContext();
    setSheetOpen(true);
    sheetY.value = withSpring(0, { damping: 20, stiffness: 180 });
    backdropOpacity.value = withTiming(1, { duration: 250 });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const closeSheet = () => {
    sheetY.value = withSpring(SHEET_HEIGHT, { damping: 18, stiffness: 200 });
    backdropOpacity.value = withTiming(0, { duration: 200 });
    setTimeout(() => {
      setSheetOpen(false);
      if (isDone || isError) reset();
    }, 280);
  };

  const handleRecordPress = async () => {
    if (isRecording) {
      await stopRecording();
    } else if (!isDone && !isProcessing) {
      await startRecording();
    }
  };

  const handleCopy = async () => {
    await Clipboard.setStringAsync(generatedReply);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    setTimeout(() => closeSheet(), 1800);
  };

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetY.value }],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  const topPad = Platform.OS === "web" ? 52 : insets.top;
  const bottomPad = Platform.OS === "web" ? 20 : insets.bottom;

  const headerBg = isDark ? IM.headerBgDark : IM.headerBg;
  const separator = isDark ? IM.separatorDark : IM.separator;
  const chatBg = isDark ? IM.backgroundDark : IM.background;
  const composeBg = isDark ? IM.composeBgDark : IM.composeBg;
  const inputBg = isDark ? IM.inputBgDark : IM.inputBg;
  const inputBorder = isDark ? IM.inputBorderDark : IM.inputBorder;

  return (
    <View style={styles.root}>
      {/* ── iMessage-style background ── */}
      <View style={[styles.chatRoot, { backgroundColor: chatBg }]}>

        {/* iOS Status Bar mock */}
        <View style={[styles.statusBar, { paddingTop: topPad - 32, backgroundColor: headerBg }]}>
          <Text style={[styles.statusTime, { color: isDark ? "#FFF" : "#000" }]}>9:41</Text>
          <View style={styles.statusIcons}>
            <Ionicons name="cellular" size={14} color={isDark ? "#FFF" : "#000"} />
            <Ionicons name="wifi" size={14} color={isDark ? "#FFF" : "#000"} />
            <Ionicons name="battery-full" size={16} color={isDark ? "#FFF" : "#000"} />
          </View>
        </View>

        {/* iMessage navigation header */}
        <View style={[styles.imHeader, { backgroundColor: headerBg, borderBottomColor: separator, paddingTop: 4 }]}>
          {/* Back */}
          <Pressable style={styles.imBackBtn}>
            <Ionicons name="chevron-back" size={26} color={IM.iconBlue} />
            <Text style={[styles.imBackCount, { color: IM.iconBlue }]}>3</Text>
          </Pressable>

          {/* Center: avatar + name */}
          <Pressable style={styles.imHeaderCenter}>
            <View style={styles.imHeaderAvatarWrap}>
              <View style={styles.imHeaderAvatar}>
                <Text style={styles.imHeaderAvatarText}>SC</Text>
              </View>
              <View style={styles.imOnlineDot} />
            </View>
            <Text style={[styles.imContactName, { color: isDark ? "#FFF" : "#000" }]}>
              Simon Chen
            </Text>
          </Pressable>

          {/* Right actions */}
          <View style={styles.imHeaderRight}>
            <Pressable style={styles.imHeaderIcon}>
              <Ionicons name="videocam" size={22} color={IM.iconBlue} />
            </Pressable>
            <Pressable
              onPress={() => setShowHistory(true)}
              style={[styles.imHeaderIcon, { position: "relative" }]}
            >
              <Ionicons name="time-outline" size={22} color={IM.iconBlue} />
              {historyData.length > 0 && (
                <View style={[styles.historyBadge, { backgroundColor: IM.blue }]}>
                  <Text style={styles.historyBadgeText}>{Math.min(historyData.length, 9)}</Text>
                </View>
              )}
            </Pressable>
          </View>
        </View>

        {/* Messages */}
        <ScrollView
          style={styles.chatMessages}
          contentContainerStyle={[
            styles.chatMessagesContent,
            { paddingBottom: bottomPad + 72 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <Text style={[imStyles.timeLabel, { color: IM.timeText }]}>
            Today 10:14 AM
          </Text>
          {MOCK_MESSAGES.map((msg, i) => (
            <IMessageBubble
              key={msg.id}
              msg={msg}
              isDark={isDark}
              isLast={i === MOCK_MESSAGES.length - 1}
            />
          ))}
        </ScrollView>

        {/* iMessage compose bar */}
        <View
          style={[
            styles.imCompose,
            {
              paddingBottom: bottomPad + 6,
              backgroundColor: composeBg,
              borderTopColor: separator,
            },
          ]}
        >
          {/* + button */}
          <Pressable style={[styles.imComposeCircleBtn, { backgroundColor: isDark ? "#3A3A3C" : "#C7C7CC" }]}>
            <Ionicons name="add" size={20} color={isDark ? "#FFF" : "#3C3C43"} />
          </Pressable>

          {/* Text input */}
          <View
            style={[
              styles.imComposeInput,
              { backgroundColor: inputBg, borderColor: inputBorder },
            ]}
          >
            <TextInput
              placeholder="iMessage"
              placeholderTextColor={isDark ? "#636366" : "#8E8E93"}
              style={[
                styles.imComposeInputText,
                { color: isDark ? "#FFF" : "#000" },
              ]}
              value={fabDraft}
              onChangeText={setFabDraft}
            />
            <Pressable style={styles.imCameraBtn}>
              <Ionicons name="camera" size={18} color={isDark ? "#636366" : "#8E8E93"} />
            </Pressable>
          </View>

          {/* VoiceReply mic FAB — replaces the standard audio button */}
          <Pressable
            onPress={sheetOpen ? closeSheet : openSheet}
            style={[
              styles.imMicFab,
              {
                backgroundColor: sheetOpen ? "#FF3B30" : IM.blue,
              },
            ]}
          >
            <Ionicons
              name={sheetOpen ? "close" : "mic"}
              size={18}
              color="#FFFFFF"
            />
          </Pressable>
        </View>
      </View>

      {/* ── Backdrop ── */}
      {sheetOpen && (
        <Animated.View
          style={[styles.backdrop, backdropStyle, { pointerEvents: "box-none" }]}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={closeSheet} />
        </Animated.View>
      )}

      {/* ── Bottom sheet overlay ── */}
      <Animated.View
        style={[
          styles.sheet,
          {
            backgroundColor: isDark ? "#1C1C1E" : "#FFFFFF",
            paddingBottom: bottomPad + 12,
            shadowColor: "#000",
            pointerEvents: sheetOpen ? "box-none" : "none",
          },
          sheetStyle,
        ]}
      >
        <View style={[styles.sheetHandle, { backgroundColor: isDark ? "#48484A" : "#D1D1D6" }]} />

        {/* Sheet header */}
        <View style={styles.sheetHeader}>
          <View style={styles.sheetTitleRow}>
            <View
              style={[
                styles.sheetDot,
                { backgroundColor: isRecording ? "#FF3B30" : IM.blue },
              ]}
            />
            <Text style={[styles.sheetTitle, { color: isDark ? "#FFF" : "#000" }]}>
              {isRecording
                ? "Listening..."
                : isProcessing
                ? "Crafting reply..."
                : isDone
                ? "Your reply"
                : "VoiceReply"}
            </Text>
          </View>
          <Pressable
            onPress={closeSheet}
            style={({ pressed }) => [styles.sheetClose, { opacity: pressed ? 0.5 : 1 }]}
          >
            <Ionicons name="close-circle" size={24} color={isDark ? "#48484A" : "#C7C7CC"} />
          </Pressable>
        </View>

        {/* Conversation context pill — always visible */}
        {!isProcessing && (
          <View style={[styles.contextPill, { backgroundColor: isDark ? "#2C2C2E" : "#F2F2F7" }]}>
            <Ionicons name="chatbubbles-outline" size={13} color={isDark ? "#8E8E93" : "#6B6B6B"} />
            <Text style={[styles.contextPillText, { color: isDark ? "#8E8E93" : "#6B6B6B" }]}>
              Using {MOCK_MESSAGES.length} messages from today's conversation
            </Text>
          </View>
        )}

        {/* Tone selector — idle state only */}
        {!isDone && !isProcessing && (
          <View style={styles.toneRow}>
            <ToneSelector
              selected={tone}
              onSelect={setTone}
              primaryColor={IM.blue}
              textColor={isDark ? "#FFF" : "#000"}
              mutedColor={isDark ? "#8E8E93" : "#8E8E93"}
              cardColor={isDark ? "#2C2C2E" : "#F2F2F7"}
            />
          </View>
        )}

        {/* States */}
        {isProcessing ? (
          <View style={styles.processingSection}>
            <ActivityIndicator size="large" color={IM.blue} />
            <Text style={[styles.processingText, { color: isDark ? "#8E8E93" : "#6B6B6B" }]}>
              Generating your reply...
            </Text>
          </View>
        ) : isDone ? (
          <View style={styles.resultSection}>
            {transcript ? (
              <Text
                style={[styles.transcriptPreview, { color: isDark ? "#8E8E93" : "#8E8E93" }]}
                numberOfLines={2}
              >
                You said: "{transcript}"
              </Text>
            ) : null}
            <View
              style={[
                styles.replyBubble,
                { backgroundColor: IM.blue + "18", borderColor: IM.blue + "40" },
              ]}
            >
              <Text style={[styles.replyText, { color: isDark ? "#FFF" : "#000" }]}>
                {generatedReply}
              </Text>
            </View>
            <View style={styles.resultActions}>
              <Pressable
                onPress={handleCopy}
                style={({ pressed }) => [
                  styles.copyBtn,
                  {
                    backgroundColor: copied ? "#34C759" : IM.blue,
                    opacity: pressed ? 0.9 : 1,
                  },
                ]}
              >
                <Ionicons name={copied ? "checkmark" : "copy-outline"} size={16} color="#FFF" />
                <Text style={styles.copyBtnText}>{copied ? "Copied!" : "Copy reply"}</Text>
              </Pressable>
              <Pressable
                onPress={() => reset()}
                style={({ pressed }) => [
                  styles.retryBtn,
                  {
                    backgroundColor: isDark ? "#2C2C2E" : "#F2F2F7",
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <Ionicons name="mic-outline" size={18} color={isDark ? "#8E8E93" : "#6B6B6B"} />
              </Pressable>
            </View>
            <Text style={[styles.retryHint, { color: isDark ? "#48484A" : "#C7C7CC" }]}>
              Tap mic to record again
            </Text>
          </View>
        ) : (
          <View style={styles.recordSection}>
            {isRecording && (
              <WaveformAnimation amplitude={amplitude} isActive={isRecording} color="#FF3B30" barCount={9} />
            )}
            {isError && (
              <View style={styles.errorRow}>
                <Ionicons name="alert-circle" size={14} color="#FF3B30" />
                <Text style={[styles.errorText, { color: "#FF3B30" }]}>
                  {errorMessage || "Something went wrong."}
                </Text>
              </View>
            )}
            {!isRecording && !isError && (
              <Text style={[styles.recordHint, { color: isDark ? "#8E8E93" : "#8E8E93" }]}>
                Tap the mic and speak your reply
              </Text>
            )}
            <Pressable
              onPress={handleRecordPress}
              style={({ pressed }) => [
                styles.recordBtn,
                {
                  backgroundColor: isRecording ? "#FF3B30" : IM.blue,
                  transform: [{ scale: pressed ? 0.94 : 1 }],
                },
              ]}
            >
              <Ionicons name={isRecording ? "stop" : "mic"} size={26} color="#FFF" />
            </Pressable>
            {isRecording && (
              <Text style={[styles.tapToStop, { color: "#FF3B30" }]}>Tap to stop</Text>
            )}
          </View>
        )}
      </Animated.View>

      <HistoryDrawer
        visible={showHistory}
        onClose={() => setShowHistory(false)}
        history={historyData}
        colors={{
          background: c.background,
          card: c.backgroundCard,
          text: c.text,
          textSecondary: c.textSecondary,
          textMuted: c.textMuted,
          primary: IM.blue,
          border: c.border,
          inputBg: c.backgroundInput,
          success: "#34C759",
        }}
        onHistoryUpdate={setHistoryData}
      />
    </View>
  );
}

export default function HomeScreen() {
  return (
    <VoiceReplyProvider>
      <FloatingOverlay />
    </VoiceReplyProvider>
  );
}

// ── iMessage-specific bubble styles ──
const imStyles = StyleSheet.create({
  timeLabel: {
    fontSize: 12,
    textAlign: "center",
    marginBottom: 12,
    fontWeight: "400",
  },
  msgGroup: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginBottom: 2,
    paddingHorizontal: 8,
  },
  msgGroupMe: {
    justifyContent: "flex-end",
  },
  avatarSlot: {
    width: 28,
    marginRight: 4,
    alignItems: "center",
    justifyContent: "flex-end",
  },
  imAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#B0B0B5",
    alignItems: "center",
    justifyContent: "center",
  },
  imAvatarText: {
    color: "#FFF",
    fontSize: 11,
    fontWeight: "600",
  },
  bubbleWrapper: {
    maxWidth: "75%",
    alignItems: "flex-start",
  },
  bubbleWrapperMe: {
    alignItems: "flex-end",
  },
  bubble: {
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  bubbleMe: {
    borderRadius: 20,
    borderBottomRightRadius: 5,
  },
  bubbleThem: {
    borderRadius: 20,
    borderBottomLeftRadius: 5,
  },
  bubbleText: {
    fontSize: 16,
    lineHeight: 22,
  },
  delivered: {
    fontSize: 11,
    marginTop: 3,
    marginRight: 2,
  },
});

// ── Main layout styles ──
const styles = StyleSheet.create({
  root: { flex: 1 },

  // Chat background
  chatRoot: { flex: 1 },
  chatMessages: { flex: 1 },
  chatMessagesContent: {
    paddingTop: 10,
  },

  // iOS status bar mock
  statusBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    height: 44,
  },
  statusTime: {
    fontSize: 15,
    fontWeight: "600",
  },
  statusIcons: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },

  // iMessage header
  imHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    height: 52,
  },
  imBackBtn: {
    flexDirection: "row",
    alignItems: "center",
    minWidth: 48,
  },
  imBackCount: {
    fontSize: 17,
    fontWeight: "400",
    marginLeft: -4,
  },
  imHeaderCenter: {
    flex: 1,
    alignItems: "center",
    gap: 4,
  },
  imHeaderAvatarWrap: {
    position: "relative",
  },
  imHeaderAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#B0B0B5",
    alignItems: "center",
    justifyContent: "center",
  },
  imHeaderAvatarText: {
    color: "#FFF",
    fontSize: 11,
    fontWeight: "700",
  },
  imOnlineDot: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: "#34C759",
    borderWidth: 1.5,
    borderColor: "#FFF",
  },
  imContactName: {
    fontSize: 13,
    fontWeight: "600",
  },
  imHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    minWidth: 72,
    justifyContent: "flex-end",
    gap: 4,
  },
  imHeaderIcon: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  historyBadge: {
    position: "absolute",
    top: 2,
    right: 2,
    width: 14,
    height: 14,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  historyBadgeText: {
    color: "#FFF",
    fontSize: 9,
    fontWeight: "700",
  },

  // iMessage compose bar
  imCompose: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 10,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  imComposeCircleBtn: {
    width: 33,
    height: 33,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  imComposeInput: {
    flex: 1,
    minHeight: 36,
    maxHeight: 120,
    borderRadius: 18,
    borderWidth: 1,
    paddingLeft: 12,
    paddingRight: 36,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  imComposeInputText: {
    flex: 1,
    fontSize: 16,
    lineHeight: 20,
  },
  imCameraBtn: {
    position: "absolute",
    right: 10,
    bottom: 9,
  },
  imMicFab: {
    width: 33,
    height: 33,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
    shadowColor: "#1B84FF",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },

  // Backdrop
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.3)",
    zIndex: 10,
  },

  // Bottom sheet
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    zIndex: 20,
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 20,
    minHeight: SHEET_HEIGHT,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 16,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  sheetTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sheetDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: "600",
  },
  sheetClose: { padding: 2 },
  toneRow: { marginBottom: 16 },
  contextPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    alignSelf: "flex-start",
    marginBottom: 14,
  },
  contextPillText: {
    fontSize: 12,
    fontWeight: "400",
  },

  // Record state
  recordSection: {
    alignItems: "center",
    gap: 14,
    paddingVertical: 12,
    flex: 1,
  },
  recordHint: {
    fontSize: 14,
    textAlign: "center",
  },
  recordBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#1B84FF",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 14,
    elevation: 10,
  },
  tapToStop: {
    fontSize: 13,
    fontWeight: "500",
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  errorText: { fontSize: 13 },

  // Processing state
  processingSection: {
    alignItems: "center",
    gap: 14,
    paddingVertical: 24,
    flex: 1,
  },
  processingText: {
    fontSize: 15,
    fontWeight: "500",
  },

  // Result state
  resultSection: { gap: 10, flex: 1 },
  retryHint: {
    fontSize: 11,
    textAlign: "center",
    marginTop: -4,
  },
  transcriptPreview: {
    fontSize: 13,
    fontStyle: "italic",
    lineHeight: 18,
  },
  replyBubble: {
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
  },
  replyText: {
    fontSize: 16,
    lineHeight: 24,
  },
  resultActions: {
    flexDirection: "row",
    gap: 10,
  },
  copyBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 13,
    borderRadius: 14,
  },
  copyBtnText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#FFF",
  },
  retryBtn: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
});
