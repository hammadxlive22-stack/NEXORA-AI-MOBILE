import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  getListOpenaiConversationsQueryKey,
  useCreateOpenaiConversation,
  useDeleteOpenaiConversation,
  useListOpenaiConversations,
} from "@workspace/api-client-react";
import { useTheme } from "@/contexts/ThemeContext";
import { useColors } from "@/hooks/useColors";

export default function HomeScreen() {
  const colors = useColors();
  const { isDark, setMode, mode } = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");

  const { data: conversations, isLoading, refetch, isRefetching } = useListOpenaiConversations();
  const createConversation = useCreateOpenaiConversation();
  const deleteConversation = useDeleteOpenaiConversation();

  const filtered = (conversations ?? []).filter((c) =>
    c.title.toLowerCase().includes(search.toLowerCase())
  );

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const handleNew = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    createConversation.mutate(
      { data: { title: "New Chat" } },
      {
        onSuccess: (conv) => {
          queryClient.invalidateQueries({ queryKey: getListOpenaiConversationsQueryKey() });
          router.push(`/chat/${conv.id}`);
        },
      }
    );
  };

  const handleDelete = (id: number, title: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    Alert.alert("Delete Chat", `Delete "${title}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          deleteConversation.mutate({ id }, {
            onSuccess: () => queryClient.invalidateQueries({ queryKey: getListOpenaiConversationsQueryKey() }),
          });
        },
      },
    ]);
  };

  const toggleTheme = () => {
    Haptics.selectionAsync();
    setMode(isDark ? "light" : "dark");
  };

  const s = makeStyles(colors);

  return (
    <View style={[s.container, { paddingTop: topPad }]}>
      {/* Header */}
      <View style={s.header}>
        <View style={s.logoRow}>
          <View style={s.logoBox}>
            <Text style={s.logoN}>N</Text>
          </View>
          <View>
            <Text style={s.logoName}>Nexora AI</Text>
            <Text style={s.logoSub}>Powered by GPT-4o</Text>
          </View>
        </View>
        <View style={s.headerRight}>
          <Pressable style={({ pressed }) => [s.iconBtn, { opacity: pressed ? 0.6 : 1 }]} onPress={toggleTheme}>
            <Feather name={isDark ? "sun" : "moon"} size={20} color={colors.mutedForeground} />
          </Pressable>
          <Pressable style={({ pressed }) => [s.iconBtn, { opacity: pressed ? 0.6 : 1 }]} onPress={() => router.push("/image")}>
            <Feather name="image" size={20} color={colors.mutedForeground} />
          </Pressable>
          <Pressable
            style={({ pressed }) => [s.newBtn, { opacity: pressed ? 0.8 : 1 }]}
            onPress={handleNew}
            disabled={createConversation.isPending}
          >
            {createConversation.isPending ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Feather name="edit-2" size={18} color="#fff" />
            )}
          </Pressable>
        </View>
      </View>

      {/* Search */}
      <View style={s.searchWrap}>
        <Feather name="search" size={16} color={colors.mutedForeground} style={{ marginRight: 8 }} />
        <TextInput
          style={s.searchInput}
          placeholder="Search conversations..."
          placeholderTextColor={colors.mutedForeground}
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch("")} hitSlop={8}>
            <Feather name="x-circle" size={16} color={colors.mutedForeground} />
          </Pressable>
        )}
      </View>

      {/* List */}
      {isLoading ? (
        <View style={s.center}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={s.emptyText}>Loading your chats...</Text>
        </View>
      ) : filtered.length === 0 ? (
        <View style={s.center}>
          <View style={s.emptyIcon}>
            <Feather name="message-circle" size={36} color={colors.primary} />
          </View>
          <Text style={s.emptyTitle}>{search ? "No results found" : "No conversations yet"}</Text>
          <Text style={s.emptyText}>{search ? `Nothing matches "${search}"` : "Tap + to start a new chat"}</Text>
          {!search && (
            <Pressable style={({ pressed }) => [s.startBtn, { opacity: pressed ? 0.8 : 1 }]} onPress={handleNew}>
              <Feather name="plus" size={16} color="#fff" />
              <Text style={s.startBtnText}>Start Chatting</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ paddingBottom: bottomPad + 20, paddingTop: 4 }}
          onRefresh={refetch}
          refreshing={isRefetching}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [s.row, { opacity: pressed ? 0.75 : 1 }]}
              onPress={() => {
                Haptics.selectionAsync();
                router.push(`/chat/${item.id}`);
              }}
              onLongPress={() => handleDelete(item.id, item.title)}
            >
              <View style={s.rowAvatar}>
                <Feather name="cpu" size={18} color={colors.primary} />
              </View>
              <View style={s.rowContent}>
                <Text style={s.rowTitle} numberOfLines={1}>{item.title}</Text>
                <Text style={s.rowDate}>{new Date(item.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</Text>
              </View>
              <Pressable onPress={() => handleDelete(item.id, item.title)} hitSlop={10} style={s.deleteBtn}>
                <Feather name="trash-2" size={15} color={colors.mutedForeground} />
              </Pressable>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

function makeStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 14 },
    logoRow: { flexDirection: "row", alignItems: "center", gap: 12 },
    logoBox: { width: 40, height: 40, borderRadius: 13, backgroundColor: c.primary, alignItems: "center", justifyContent: "center" },
    logoN: { color: "#fff", fontSize: 20, fontWeight: "700" as const, fontFamily: "Inter_700Bold" },
    logoName: { color: c.foreground, fontSize: 18, fontWeight: "700" as const, fontFamily: "Inter_700Bold" },
    logoSub: { color: c.mutedForeground, fontSize: 11, fontFamily: "Inter_400Regular" },
    headerRight: { flexDirection: "row", alignItems: "center", gap: 4 },
    iconBtn: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
    newBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: c.primary, alignItems: "center", justifyContent: "center" },
    searchWrap: { flexDirection: "row", alignItems: "center", backgroundColor: c.card, borderRadius: 14, marginHorizontal: 16, marginBottom: 12, paddingHorizontal: 14, paddingVertical: 11, borderWidth: 1, borderColor: c.border },
    searchInput: { flex: 1, color: c.foreground, fontSize: 15, fontFamily: "Inter_400Regular" },
    center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 40 },
    emptyIcon: { width: 72, height: 72, borderRadius: 24, backgroundColor: c.primary + "18", alignItems: "center", justifyContent: "center", marginBottom: 6 },
    emptyTitle: { color: c.foreground, fontSize: 20, fontWeight: "600" as const, fontFamily: "Inter_600SemiBold" },
    emptyText: { color: c.mutedForeground, fontSize: 14, textAlign: "center", fontFamily: "Inter_400Regular" },
    startBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: c.primary, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 24, marginTop: 8 },
    startBtnText: { color: "#fff", fontSize: 15, fontWeight: "600" as const, fontFamily: "Inter_600SemiBold" },
    row: { flexDirection: "row", alignItems: "center", marginHorizontal: 14, marginVertical: 4, backgroundColor: c.card, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 14, borderWidth: 1, borderColor: c.border },
    rowAvatar: { width: 40, height: 40, borderRadius: 13, backgroundColor: c.primary + "18", alignItems: "center", justifyContent: "center", marginRight: 12 },
    rowContent: { flex: 1, gap: 3 },
    rowTitle: { color: c.foreground, fontSize: 15, fontWeight: "500" as const, fontFamily: "Inter_500Medium" },
    rowDate: { color: c.mutedForeground, fontSize: 12, fontFamily: "Inter_400Regular" },
    deleteBtn: { padding: 4 },
  });
}

