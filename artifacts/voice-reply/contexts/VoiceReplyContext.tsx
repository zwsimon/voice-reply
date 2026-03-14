import React, {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  useEffect,
} from "react";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Only import expo-audio on native — web uses MediaRecorder
let useAudioRecorder: any;
let RecordingPresets: any;
let requestRecordingPermissionsAsync: any;
let setAudioModeAsync: any;
if (Platform.OS !== "web") {
  const expoAudio = require("expo-audio");
  useAudioRecorder = expoAudio.useAudioRecorder;
  RecordingPresets = expoAudio.RecordingPresets;
  requestRecordingPermissionsAsync = expoAudio.requestRecordingPermissionsAsync;
  setAudioModeAsync = expoAudio.setAudioModeAsync;
}

export type Tone = "friendly" | "formal" | "casual";

export type ReplySession = {
  id: string;
  context: string;
  transcript: string;
  reply: string;
  tone: Tone;
  createdAt: string;
};

type RecordingState = "idle" | "recording" | "processing" | "done" | "error";

type VoiceReplyContextType = {
  recordingState: RecordingState;
  transcript: string;
  generatedReply: string;
  conversationContext: string;
  tone: Tone;
  errorMessage: string;
  amplitude: number;
  history: ReplySession[];
  setConversationContext: (ctx: string) => void;
  setTone: (tone: Tone) => void;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  reset: () => void;
  setGeneratedReply: (reply: string) => void;
};

const VoiceReplyContext = createContext<VoiceReplyContextType | null>(null);

const API_BASE = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`
  : "/api";

const HISTORY_KEY = "voicereply_history";

// ── Helper: pick the best MIME type for web recording ──
function getWebMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "audio/webm";
  const types = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
    "audio/mp4",
  ];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) ?? "audio/webm";
}

function mimeToFormat(mime: string): string {
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("ogg")) return "ogg";
  return "webm";
}

// ── Helper: convert ArrayBuffer → base64 without stack overflow ──
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// ── Native recorder hook wrapper ──
function useNativeRecorder() {
  if (Platform.OS === "web") return null;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useAudioRecorder(RecordingPresets.HIGH_QUALITY);
}

export function VoiceReplyProvider({ children }: { children: React.ReactNode }) {
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [transcript, setTranscript] = useState("");
  const [generatedReply, setGeneratedReply] = useState("");
  const [conversationContext, setConversationContext] = useState("");
  const [tone, setTone] = useState<Tone>("friendly");
  const [errorMessage, setErrorMessage] = useState("");
  const [amplitude, setAmplitude] = useState(0);
  const [history, setHistory] = useState<ReplySession[]>([]);

  // Native recorder (null on web)
  const nativeRecorder = useNativeRecorder();

  // Web MediaRecorder refs
  const webMediaRecorder = useRef<MediaRecorder | null>(null);
  const webChunks = useRef<Blob[]>([]);
  const webStream = useRef<MediaStream | null>(null);
  const webMime = useRef<string>("audio/webm");

  const amplitudeInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(HISTORY_KEY)
      .then((raw) => { if (raw) setHistory(JSON.parse(raw)); })
      .catch(() => {});
  }, []);

  const saveToHistory = useCallback(async (session: ReplySession) => {
    setHistory((prev) => {
      const updated = [session, ...prev].slice(0, 50);
      AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  // ── Shared amplitude simulation ──
  const startAmplitudeSim = useCallback(() => {
    setAmplitude(0);
    amplitudeInterval.current = setInterval(() => {
      setAmplitude((prev) => {
        const noise = Math.random() * 0.3;
        const direction = Math.random() > 0.5 ? 0.1 : -0.1;
        return Math.max(0.1, Math.min(1, prev + direction + noise));
      });
    }, 120);
  }, []);

  const stopAmplitudeSim = useCallback(() => {
    if (amplitudeInterval.current) {
      clearInterval(amplitudeInterval.current);
      amplitudeInterval.current = null;
    }
    setAmplitude(0);
  }, []);

  // ── Shared: call API after we have a blob ──
  const processAudio = useCallback(
    async (blob: Blob, format: string) => {
      setRecordingState("processing");
      try {
        const arrayBuffer = await blob.arrayBuffer();
        const base64 = arrayBufferToBase64(arrayBuffer);

        const transcribeRes = await fetch(`${API_BASE}/voicereply/transcribe`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audio: base64, format }),
        });

        if (!transcribeRes.ok) {
          const err = await transcribeRes.json().catch(() => ({}));
          throw new Error((err as any).error || "Transcription failed");
        }
        const { transcript: t } = await transcribeRes.json();
        setTranscript(t);

        const replyRes = await fetch(`${API_BASE}/voicereply/generate-reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript: t, context: conversationContext || undefined, tone }),
        });

        if (!replyRes.ok) {
          const err = await replyRes.json().catch(() => ({}));
          throw new Error((err as any).error || "Reply generation failed");
        }
        const { reply } = await replyRes.json();
        setGeneratedReply(reply);
        setRecordingState("done");

        await saveToHistory({
          id: Date.now().toString() + Math.random().toString(36).substring(2, 7),
          context: conversationContext,
          transcript: t,
          reply,
          tone,
          createdAt: new Date().toISOString(),
        });
      } catch (err) {
        console.error("processAudio error:", err);
        setErrorMessage(err instanceof Error ? err.message : "Something went wrong.");
        setRecordingState("error");
      }
    },
    [conversationContext, tone, saveToHistory]
  );

  // ── Web cleanup helper ──
  const cleanupWebRecording = useCallback(() => {
    if (webMediaRecorder.current) {
      try {
        if (webMediaRecorder.current.state !== "inactive") {
          webMediaRecorder.current.stop();
        }
      } catch {}
      webMediaRecorder.current = null;
    }
    if (webStream.current) {
      webStream.current.getTracks().forEach((t) => t.stop());
      webStream.current = null;
    }
    webChunks.current = [];
  }, []);

  // ── startRecording ──
  const startRecording = useCallback(async () => {
    try {
      setErrorMessage("");
      setTranscript("");
      setGeneratedReply("");
      setRecordingState("idle");

      if (Platform.OS === "web") {
        // Always clean up any previous recording first
        cleanupWebRecording();

        // Browser MediaRecorder path
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        webStream.current = stream;
        const mimeType = getWebMimeType();
        webMime.current = mimeType;
        webChunks.current = [];

        const mr = new MediaRecorder(stream, { mimeType });
        webMediaRecorder.current = mr;

        mr.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) webChunks.current.push(e.data);
        };

        mr.onerror = () => {
          setErrorMessage("Recording failed. Please try again.");
          setRecordingState("error");
          cleanupWebRecording();
          stopAmplitudeSim();
        };

        mr.start(200); // collect data every 200ms
        setRecordingState("recording");
        startAmplitudeSim();
      } else {
        // Native expo-audio path
        const { granted } = await requestRecordingPermissionsAsync();
        if (!granted) {
          setErrorMessage("Microphone permission denied.");
          setRecordingState("error");
          return;
        }
        // Required on iOS: enable recording mode before calling record()
        await setAudioModeAsync({
          allowsRecording: true,
          playsInSilentMode: true,
        });
        await nativeRecorder.prepareToRecordAsync();
        nativeRecorder.record();
        setRecordingState("recording");
        startAmplitudeSim();
      }
    } catch (err) {
      console.error("startRecording error:", err);
      cleanupWebRecording();
      setErrorMessage("Could not access microphone. Please allow microphone access.");
      setRecordingState("error");
    }
  }, [nativeRecorder, startAmplitudeSim, cleanupWebRecording, stopAmplitudeSim]);

  // ── stopRecording ──
  const stopRecording = useCallback(async () => {
    stopAmplitudeSim();

    if (Platform.OS === "web") {
      const mr = webMediaRecorder.current;
      if (!mr) {
        setErrorMessage("No active recording.");
        setRecordingState("error");
        return;
      }

      // Wait for the MediaRecorder to fully stop and flush all chunks
      await new Promise<void>((resolve) => {
        mr.onstop = () => resolve();
        mr.stop();
      });

      // Stop all mic tracks
      webStream.current?.getTracks().forEach((t) => t.stop());
      webStream.current = null;

      const blob = new Blob(webChunks.current, { type: webMime.current });
      const format = mimeToFormat(webMime.current);
      webMediaRecorder.current = null;
      webChunks.current = [];

      await processAudio(blob, format);
    } else {
      // Native path
      setRecordingState("processing");
      await nativeRecorder.stop();
      // Restore audio mode so playback works normally after recording
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: false,
      });
      const uri = nativeRecorder.uri;
      if (!uri) {
        setErrorMessage("No recording found.");
        setRecordingState("error");
        return;
      }
      const response = await fetch(uri);
      const blob = await response.blob();
      await processAudio(blob, "m4a");
    }
  }, [nativeRecorder, stopAmplitudeSim, processAudio]);

  const reset = useCallback(() => {
    stopAmplitudeSim();
    cleanupWebRecording();
    setRecordingState("idle");
    setTranscript("");
    setGeneratedReply("");
    setErrorMessage("");
    setAmplitude(0);
  }, [stopAmplitudeSim, cleanupWebRecording]);

  return (
    <VoiceReplyContext.Provider
      value={{
        recordingState,
        transcript,
        generatedReply,
        conversationContext,
        tone,
        errorMessage,
        amplitude,
        history,
        setConversationContext,
        setTone,
        startRecording,
        stopRecording,
        reset,
        setGeneratedReply,
      }}
    >
      {children}
    </VoiceReplyContext.Provider>
  );
}

export function useVoiceReply() {
  const ctx = useContext(VoiceReplyContext);
  if (!ctx) throw new Error("useVoiceReply must be used inside VoiceReplyProvider");
  return ctx;
}
