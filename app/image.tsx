import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { fetch } from "expo/fetch";
import { Image } from "expo-image";
import { router } from "expo-router";
import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

const { width: SW } = Dimensions.get("window");

function getApiBase(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  return domain ? `https://${domain}` : "";
}

const PRESETS = [
  "A futuristic city at night with neon lights",
  "A serene mountain lake at golden hour",
  "Abstract AI brain with glowing neural networks",
  "A cyberpunk street market in the rain",
];

export default function ImageScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [prompt, setPrompt] = useState("");
  const [imageData, setImageData] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;
  const imgSize = Math.min(SW - 48, 380);
  const s = makeStyles(colors);

  const handleGenerate = async () => {
    if (!prompt.trim() || isLoading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsLoading(true);
    setError(null);
    setImageData(null);

    try {
      const response = await fetch(`${getApiBase()}/api/openai/generate-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim(), size: "1024x1024" }),
      });
      if (!response.ok) throw new Error("Failed");
      const data = await response.json() as { b64_json: string };
      setImageData(data.b64_json);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      setError("Failed to generate image. Please try again.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={0}>
      <View style={[s.container, { paddingTop: topPad }]}>
        <View style={s.header}>
          <Pressable style={({ pressed }) => [s.backBtn, { opacity: pressed ? 0.6 : 1 }]} onPress={() => router.back()}>
            <Feather name="arrow-left" size={22} color={colors.foreground} />
          </Pressable>
          <View style={s.headerCenter}>
            <Feather name="image" size={18} color={colors.primary} />
            <Text style={s.headerTitle}>Image Generation</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={[s.content, { paddingBottom: bottomPad + 16 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {/* Preview area */}
          {imageData ? (
            <View style={[s.imageBox, { width: imgSize, height: imgSize }]}>
              <Image source={{ uri: `data:image/png;base64,${imageData}` }} style={{ width: imgSize, height: imgSize, borderRadius: 20 }} contentFit="cover" />
            </View>
          ) : isLoading ? (
            <View style={[s.placeholder, { width: imgSize, height: imgSize }]}>
              <ActivityIndicator color={colors.primary} size="large" />
              <Text style={s.placeholderTitle}>Creating your image...</Text>
              <Text style={s.placeholderSub}>This may take 15–30 seconds</Text>
            </View>
          ) : error ? (
            <View style={[s.placeholder, { width: imgSize, height: imgSize }]}>
              <Feather name="alert-circle" size={44} color={colors.destructive} />
              <Text style={[s.placeholderTitle, { color: colors.destructive }]}>Generation failed</Text>
              <Text style={s.placeholderSub}>{error}</Text>
            </View>
          ) : (
            <View style={[s.placeholder, { width: imgSize, height: imgSize }]}>
              <Feather name="zap" size={44} color={colors.primary} style={{ opacity: 0.5 }} />
              <Text style={s.placeholderTitle}>AI Image Generator</Text>
              <Text style={s.placeholderSub}>Describe any image and I'll create it</Text>
            </View>
          )}

          {/* Presets */}
          {!imageData && !isLoading && (
            <View style={s.presetWrap}>
              <Text style={s.presetLabel}>Quick prompts</Text>
              {PRESETS.map((p) => (
                <Pressable key={p} style={({ pressed }) => [s.presetChip, { opacity: pressed ? 0.7 : 1 }]} onPress={() => setPrompt(p)}>
                  <Feather name="arrow-right" size={14} color={colors.primary} />
                  <Text style={s.presetText}>{p}</Text>
                </Pressable>
              ))}
            </View>
          )}

          {/* Input */}
          <View style={s.inputRow}>
            <TextInput
              ref={inputRef}
              style={s.input}
              placeholder="Describe the image you want..."
              placeholderTextColor={colors.mutedForeground}
              value={prompt}
              onChangeText={setPrompt}
              multiline
              maxLength={500}
            />
            <Pressable
              style={({ pressed }) => [s.genBtn, { opacity: !prompt.trim() || isLoading ? 0.4 : pressed ? 0.8 : 1 }]}
              onPress={handleGenerate}
              disabled={!prompt.trim() || isLoading}
            >
              <Feather name="zap" size={20} color="#fff" />
            </Pressable>
          </View>
        </ScrollView>
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
    headerTitle: { color: c.foreground, fontSize: 17, fontWeight: "600" as const, fontFamily: "Inter_600SemiBold" },
    content: { alignItems: "center", paddingHorizontal: 24, paddingTop: 24, gap: 20 },
    imageBox: { borderRadius: 20, overflow: "hidden" },
    placeholder: { borderRadius: 20, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, alignItems: "center", justifyContent: "center", gap: 12 },
    placeholderTitle: { color: c.foreground, fontSize: 18, fontWeight: "600" as const, fontFamily: "Inter_600SemiBold" },
    placeholderSub: { color: c.mutedForeground, fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", paddingHorizontal: 24 },
    presetWrap: { width: "100%", gap: 8 },
    presetLabel: { color: c.mutedForeground, fontSize: 13, fontFamily: "Inter_500Medium", fontWeight: "500" as const, marginBottom: 2 },
    presetChip: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10 },
    presetText: { color: c.foreground, fontSize: 14, fontFamily: "Inter_400Regular", flex: 1 },
    inputRow: { flexDirection: "row", alignItems: "flex-end", gap: 10, width: "100%" },
    input: { flex: 1, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 12, color: c.foreground, fontSize: 15, fontFamily: "Inter_400Regular", maxHeight: 120, minHeight: 52 },
    genBtn: { width: 52, height: 52, borderRadius: 16, backgroundColor: c.primary, alignItems: "center", justifyContent: "center" },
  });
}
