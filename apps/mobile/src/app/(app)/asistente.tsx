import { useReducer, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Body, Button, Notice, Title } from '@/components/ui';
import { chatReducer, EMPTY_CHAT, isBusy, SUGGESTIONS, toolsLine, type ChatMessage } from '@/lib/chat';
import { useSession } from '@/lib/session';
import { space, useTheme } from '@/lib/theme';

let seq = 0;

export default function Asistente() {
  const { api } = useSession();
  const t = useTheme();
  const [state, dispatch] = useReducer(chatReducer, EMPTY_CHAT);
  const [draft, setDraft] = useState('');
  const list = useRef<FlatList<ChatMessage>>(null);
  const busy = isBusy(state);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    const id = `m${++seq}`;
    setDraft('');
    dispatch({ type: 'send', id, text: message });
    try {
      const client = await api('assistant');
      const { data, error } = await client.POST('/v1/assistant/messages', {
        body: { message, ...(state.conversationId ? { conversation_id: state.conversationId } : {}) },
      });
      if (data) dispatch({ type: 'reply', id, reply: data });
      else dispatch({ type: 'fail', id, code: (error as { code?: string } | undefined)?.code });
    } catch {
      dispatch({ type: 'fail', id, code: 'NETWORK' });
    }
  }

  async function clear() {
    const id = state.conversationId;
    dispatch({ type: 'clear' });
    if (id) {
      try {
        await (await api('assistant')).DELETE('/v1/assistant/conversations/{conversationId}', { params: { path: { conversationId: id } } });
      } catch {
        /* vence sola en 24 horas */
      }
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <Title>Asistente</Title>
          {state.conversationId ? <Button kind="quiet" label="Borrar conversación" onPress={() => void clear()} /> : null}
        </View>

        <FlatList
          ref={list}
          data={state.messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
          ListHeaderComponent={
            <View style={{ gap: space.sm }}>
              <Body muted>
                Pregunta por tu saldo, tus movimientos, tus gastos del mes o tus avisos. Solo puede leer tu información: no hace
                transferencias. Nunca escribas tu NIP ni contraseñas.
              </Body>
              {state.messages.length === 0 ? (
                <View style={styles.suggestions}>
                  {SUGGESTIONS.map((s) => (
                    <Pressable
                      key={s}
                      accessibilityRole="button"
                      onPress={() => void send(s)}
                      style={[styles.chip, { borderColor: t.line, backgroundColor: t.surface }]}
                    >
                      <Text style={{ color: t.text }}>{s}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          }
          renderItem={({ item }) => {
            const mine = item.role === 'user';
            const tools = toolsLine(item.tools);
            return (
              <View
                accessible
                accessibilityLabel={`${mine ? 'Tú' : 'Asistente'}: ${item.text}`}
                accessibilityLiveRegion={mine ? 'none' : 'polite'}
                style={[
                  styles.bubble,
                  mine
                    ? { alignSelf: 'flex-end', backgroundColor: t.accentFill }
                    : { alignSelf: 'flex-start', backgroundColor: t.surface, borderColor: t.line, borderWidth: StyleSheet.hairlineWidth },
                ]}
              >
                <Text style={{ color: mine ? t.onAccent : t.text, fontSize: 16, lineHeight: 22, opacity: item.pending ? 0.6 : 1 }}>{item.text}</Text>
                {item.notices?.map((n) => (
                  <Text key={n} style={[styles.meta, { color: mine ? t.onAccent : t.muted }]}>
                    {n}
                  </Text>
                ))}
                {tools ? <Text style={[styles.meta, { color: t.muted }]}>{tools}</Text> : null}
              </View>
            );
          }}
        />

        {state.error ? (
          <View style={{ paddingHorizontal: space.lg }}>
            <Notice tone="error">{state.error}</Notice>
          </View>
        ) : null}

        <View style={[styles.composer, { borderTopColor: t.line, backgroundColor: t.surface }]}>
          <TextInput
            testID="asistente-pregunta"
            accessibilityLabel="Tu pregunta"
            placeholder="Escribe tu pregunta"
            placeholderTextColor={t.muted}
            value={draft}
            onChangeText={setDraft}
            maxLength={1000}
            multiline
            editable={!busy}
            style={[styles.input, { color: t.text, backgroundColor: t.raised, borderColor: t.line }]}
          />
          <Button testID="asistente-enviar" label="Enviar" busy={busy} disabled={draft.trim().length === 0} onPress={() => void send(draft)} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, paddingTop: space.lg },
  list: { padding: space.lg, gap: space.md },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: space.md, paddingVertical: space.sm },
  bubble: { maxWidth: '88%', borderRadius: 14, paddingHorizontal: space.md, paddingVertical: space.sm, gap: 4 },
  meta: { fontSize: 12 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, padding: space.md, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, minHeight: 44, maxHeight: 120, borderWidth: 1, borderRadius: 10, paddingHorizontal: space.md, paddingVertical: space.sm, fontSize: 16 },
});
