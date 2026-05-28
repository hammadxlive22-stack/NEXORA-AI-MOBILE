import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { Audio } from "expo-av";
import * as Haptics from "expo-haptics";
import { fetch } from "expo/fetch";
import * as Speech from "expo-speech";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  Alert,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  getListOpenaiConversationsQueryKey,
  useGetOpenaiConversation,
} from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  ts?: number;
}

let msgCounter = 0;
function genId(): string {
  msgCounter++;
  return `msg-${Date.now()}-${msgCounter}-${Math.random().toString(36).substr(2, 6)}`;
}

function getApiBase(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  return domain ? `https://${domain}` : "";
}

export default function ChatScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const conversationId = Number(id);
  const queryClient = useQueryClient();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [showTyping, setShowTyping] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isOffline, setIsOffline] = useState(false);

  const inputRef = useRef<TextInput>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const initializedRef = useRef(false);

  const { data: conversation } = useGetOpenaiConversation(conversationId);

  // Load messages once
  useEffect(() => {
    if (conversation?.messages && !initializedRef.current) {
      setMessages(
        conversation.messages.map((m) => ({
          id: genId(),
          role: m.role as "user" | "assistant",
          content: m.content,
          ts: new Date(m.createdAt).getTime(),
        }))
      );
      initializedRef.current = true;
    }
  }, [conversation?.messages]);

  // Offline check
  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch(`${getApiBase()}/api/healthz`, { method: "HEAD" });
        setIsOffline(!res.ok);
      } catch {
        setIsOffline(true);
      }
    };
    check();
    const t = setInterval(check, 12000);
    return () => clearInterval(t);
  }, []);

  // TTS
  const toggleSpeak = (msgId: string, text: string) => {
    Haptics.selectionAsync();
    if (speakingId === msgId) {
      Speech.stop();
      setSpeakingId(null);
    } else {
      Speech.stop();
      setSpeakingId(msgId);
      Speech.speak(text, {
        language: "en-US",
        rate: 0.95,
        onDone: () => setSpeakingId(null),
        onError: () => setSpeakingId(null),
        onStopped: () => setSpeakingId(null),
      });
    }
  };

  // Voice recording
  const startRecording = async () => {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission needed", "Microphone access is required for voice input.");
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      recordingRef.current = recording;
      setIsRecording(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {
      Alert.alert("Error", "Could not start recording.");
    }
  };

  const stopRecording = async () => {
    if (!recordingRef.current) return;
    setIsRecording(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    try {
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;
      if (uri) await transcribeAudio(uri);
    } catch {
      recordingRef.current = null;
    }
  };

  const transcribeAudio = async (uri: string) => {
    const formData = new FormData();
    formData.append("audio", { uri, type: "audio/m4a", name: "recording.m4a" } as unknown as Blob);

    try {
      const response = await fetch(`${getApiBase()}/api/openai/transcribe`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) throw new Error("Transcription failed");
      const data = await response.json() as { transcript: string };
      if (data.transcript?.trim()) {
        setInput((prev) => (prev ? `${prev} ${data.transcript.trim()}` : data.transcript.trim()));
        inputRef.current?.focus();
      }
    } catch {
      Alert.alert("Transcription failed", "Could not convert voice to text. Try again.");
    }
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setInput("");
    Speech.stop();
    setSpeakingId(null);

    if (isOffline) {
      setMessages((prev) => [
        ...prev,
        { id: genId(), role: "user", content: text, ts: Date.now() },
        { id: genId(), role: "assistant", content: "You're currently offline. Please check your internet connection to use Nexora AI. Your message has been noted and you can resend it when you're back online.", ts: Date.now() },
      ]);
      return;
    }

    const currentMessages = [...messages];
    setMessages((prev) => [...prev, { id: genId(), role: "user", content: text, ts: Date.now() }]);
    setIsStreaming(true);
    setShowTyping(true);

    try {
      const response = await fetch(`${getApiBase()}/api/openai/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ content: text }),
      });

      if (!response.ok) throw new Error("Stream failed");

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No body");

      const decoder = new TextDecoder();
      let fullContent = "";
      let buffer = "";
      let assistantId = "";
      let assistantAdded = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data) as { content?: string };
            if (parsed.content) {
              fullContent += parsed.content;
              if (!assistantAdded) {
                assistantId = genId();
                setShowTyping(false);
                setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: fullContent, ts: Date.now() }]);
                assistantAdded = true;
              } else {
                setMessages((prev) => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last) updated[updated.length - 1] = { ...last, content: fullContent };
                  return updated;
                });
              }
            }
          } catch {}
        }
      }

      queryClient.invalidateQueries({ queryKey: getListOpenaiConversationsQueryKey() });
    } catch {
      setShowTyping(false);
      setMessages((prev) => [
        ...prev,
        { id: genId(), role: "assistant", content: "Something went wrong. Please try again.", ts: Date.now() },
      ]);
    } finally {
      setIsStreaming(false);
      setShowTyping(false);
      inputRef.current?.focus();
    }
  };

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;
  const s = makeStyles(colors);
  const reversed = [...messages].reverse();

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior="padding" keyboardVerticalOffset={0}>
      <View style={[s.container, { paddingTop: topPad }]}>
        {/* Header */}
        <View style={s.header}>
          <Pressable style={({ pressed }) => [s.backBtn, { opacity: pressed ? 0.6 : 1 }]} onPress={() => router.back()}>
            <Feather name="arrow-left" size={22} color={colors.foreground} />
          </Pressable>
          <View style={s.headerCenter}>
            <View style={s.aiDot} />
            <Text style={s.headerTitle} numberOfLines={1}>{conversation?.title ?? "Chat"}</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>

        {/* Offline banner */}
        {isOffline && (
          <View style={s.offlineBanner}>
            <Feather name="wifi-off" size={14} color="#fff" />
            <Text style={s.offlineText}>You are offline — AI responses unavailable</Text>
          </View>
        )}

        {/* Messages */}
        <FlatList
          data={reversed}
          keyExtractor={(item) => item.id}
          inverted={messages.length > 0}
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 12 }}
          ListHeaderComponent={
            showTyping ? (
              <View style={s.typingRow}>
                <View style={s.aiAvatar}>
                  <Text style={s.aiAvatarText}>N</Text>
                </View>
                <View style={s.typingBubble}>
                  <View style={s.dots}>
                    <View style={[s.dot, s.dot1]} />
                    <View style={[s.dot, s.dot2]} />
                    <View style={[s.dot, s.dot3]} />
                  </View>
                </View>
              </View>
            ) : null
          }
          ListFooterComponent={
            messages.length === 0 ? (
              <View style={s.emptyState}>
                <View style={s.emptyLogo}>
                  <Text style={s.emptyLogoText}>N</Text>
                </View>
                <Text style={s.emptyTitle}>How can I help you today?</Text>
                <Text style={s.emptySubtitle}>Ask anything — I'm powered by GPT-4o</Text>
                <View style={s.suggestions}>
                  {["Explain quantum computing", "Write a Python script", "Plan my week"].map((s2) => (
                    <Pressable key={s2} style={({ pressed }) => [s.suggChip, { opacity: pressed ? 0.7 : 1 }]} onPress={() => setInput(s2)}>
                      <Text style={s.suggText}>{s2}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <View style={[s.msgRow, item.role === "user" && s.msgRowUser]}>
              {item.role === "assistant" && (
                <View style={s.aiAvatar}>
                  <Text style={s.aiAvatarText}>N</Text>
                </View>
              )}
              <View style={[s.bubble, item.role === "user" ? s.userBubble : s.aiBubble]}>
                <Text style={[s.bubbleText, item.role === "user" ? s.userText : s.aiText]}>
                  {item.content}
                </Text>
                {item.role === "assistant" && (
                  <Pressable style={s.speakBtn} onPress={() => toggleSpeak(item.id, item.content)}>
                    <Feather
                      name={speakingId === item.id ? "volume-x" : "volume-2"}
                      size={14}
                      color={speakingId === item.id ? colors.primary : colors.mutedForeground}
                    />
                  </Pressable>
                )}
              </View>
            </View>
          )}
        />

        {/* Input bar */}
        <View style={[s.inputBar, { paddingBottom: bottomPad + 8 }]}>
          <Pressable
            style={({ pressed }) => [s.micBtn, isRecording && s.micActive, { opacity: pressed ? 0.8 : 1 }]}
            onPressIn={startRecording}
            onPressOut={stopRecording}
          >
            {isRecording ? (
              <ActivityIndicator color={colors.primary} size="small" />
            ) : (
              <Feather name="mic" size={20} color={isRecording ? colors.primary : colors.mutedForeground} />
            )}
          </Pressable>
          <TextInput
            ref={inputRef}
            style={s.input}
            placeholder={isOffline ? "You're offline..." : "Message Nexora..."}
            placeholderTextColor={colors.mutedForeground}
            value={input}
            onChangeText={setInput}
            multiline
            maxLength={4000}
            blurOnSubmit={false}
          />
          <Pressable
            style={({ pressed }) => [s.sendBtn, { opacity: !input.trim() || isStreaming ? 0.4 : pressed ? 0.8 : 1 }]}
            onPress={handleSend}
            disabled={!input.trim() || isStreaming}
          >
            {isStreaming ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Feather name="arrow-up" size={20} color="#fff" />
            )}
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function makeStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.border },
    backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
    headerCenter: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
    aiDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: "#22CC55" },
    headerTitle: { color: c.foreground, fontSize: 16, fontWeight: "600" as const, fontFamily: "Inter_600SemiBold" },
    offlineBanner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#E03030", paddingHorizontal: 16, paddingVertical: 8 },
    offlineText: { color: "#fff", fontSize: 13, fontFamily: "Inter_500Medium", fontWeight: "500" as const },
    msgRow: { flexDirection: "row", alignItems: "flex-end", marginVertical: 5, gap: 8 },
    msgRowUser: { justifyContent: "flex-end" },
    aiAvatar: { width: 30, height: 30, borderRadius: 10, backgroundColor: c.primary, alignItems: "center", justifyContent: "center", flexShrink: 0 },
    aiAvatarText: { color: "#fff", fontSize: 14, fontWeight: "700" as const, fontFamily: "Inter_700Bold" },
    bubble: { maxWidth: "78%", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10 },
    userBubble: { backgroundColor: c.primary, borderBottomRightRadius: 6 },
    aiBubble: { backgroundColor: c.card, borderBottomLeftRadius: 6, borderWidth: 1, borderColor: c.border },
    bubbleText: { fontSize: 15, lineHeight: 22, fontFamily: "Inter_400Regular" },
    userText: { color: "#fff" },
    aiText: { color: c.foreground },
    speakBtn: { marginTop: 6, alignSelf: "flex-end" },
    typingRow: { flexDirection: "row", alignItems: "flex-end", gap: 8, marginBottom: 8 },
    typingBubble: { backgroundColor: c.card, borderRadius: 20, borderBottomLeftRadius: 6, padding: 14, borderWidth: 1, borderColor: c.border },
    dots: { flexDirection: "row", gap: 4 },
    dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: c.mutedForeground },
    dot1: {}, dot2: { opacity: 0.6 }, dot3: { opacity: 0.3 },
    emptyState: { alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 12 },
    emptyLogo: { width: 68, height: 68, borderRadius: 22, backgroundColor: c.primary, alignItems: "center", justifyContent: "center", marginBottom: 4 },
    emptyLogoText: { color: "#fff", fontSize: 32, fontWeight: "700" as const, fontFamily: "Inter_700Bold" },
    emptyTitle: { color: c.foreground, fontSize: 22, fontWeight: "600" as const, fontFamily: "Inter_600SemiBold" },
    emptySubtitle: { color: c.mutedForeground, fontSize: 14, fontFamily: "Inter_400Regular" },
    suggestions: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center", marginTop: 4, paddingHorizontal: 20 },
    suggChip: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
    suggText: { color: c.foreground, fontSize: 13, fontFamily: "Inter_400Regular" },
    inputBar: { flexDirection: "row", alignItems: "flex-end", paddingHorizontal: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.background, gap: 8 },
    micBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, alignItems: "center", justifyContent: "center" },
    micActive: { borderColor: c.primary, backgroundColor: c.primary + "20" },
    input: { flex: 1, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 11, color: c.foreground, fontSize: 15, fontFamily: "Inter_400Regular", maxHeight: 130, minHeight: 46 },
    sendBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: c.primary, alignItems: "center", justifyContent: "center" },
  });
}
