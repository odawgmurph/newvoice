import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { addJournal, deleteJournal, journalEntries } from '../lesson/store';
import { useDb } from '../state/AppState';
import { Body, Button, Caption, Card, Field, Heading, Screen } from '../ui/kit';
import { radius, space, type, useTheme } from '../ui/theme';

// Journal (handbook §4.5 Journal{text, mood}; Stage 7). Encrypted with the
// rest of the database, never uploaded.

const MOODS = ['Rough', 'Low', 'Okay', 'Good', 'Great'];

export default function JournalScreen() {
  const db = useDb();
  const { c } = useTheme();
  const [entries, setEntries] = useState<Awaited<ReturnType<typeof journalEntries>>>([]);
  const [text, setText] = useState('');
  const [mood, setMood] = useState<number | null>(null);

  const load = useCallback(() => void journalEntries(db).then(setEntries), [db]);
  useFocusEffect(load);

  const save = async () => {
    await addJournal(db, { text: text.trim(), mood: mood != null ? mood + 1 : null });
    setText('');
    setMood(null);
    load();
  };
  const remove = (id: number) =>
    Alert.alert('Delete this entry?', 'It can’t be recovered.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void deleteJournal(db, id).then(load) },
    ]);

  return (
    <Screen>
      <Body muted>Only you can read this. It stays encrypted on this phone.</Body>
      <Card>
        <Field placeholder="How is your voice feeling? What did you notice today?" value={text} onChangeText={setText} multiline style={styles.input} />
        <Caption>Mood (optional)</Caption>
        <View style={styles.moods} accessibilityRole="radiogroup">
          {MOODS.map((m, i) => (
            <Pressable
              key={m}
              accessibilityRole="radio"
              accessibilityState={{ selected: mood === i }}
              onPress={() => setMood(mood === i ? null : i)}
              style={[styles.mood, { borderColor: mood === i ? c.brand : c.line, backgroundColor: mood === i ? c.brandTint : c.surface200 }]}
            >
              <Text style={[type.label, { color: c.ink }]}>{m}</Text>
            </Pressable>
          ))}
        </View>
        <Button label="Save entry" disabled={!text.trim()} onPress={() => void save()} />
      </Card>
      {entries.length ? <Heading>Earlier</Heading> : null}
      {entries.map((e) => (
        <Card key={e.id}>
          <Caption>
            {e.createdAt.toLocaleDateString()}
            {e.mood ? ` · ${MOODS[e.mood - 1]}` : ''}
          </Caption>
          {e.prompt ? <Caption>{e.prompt}</Caption> : null}
          <Body>{e.text}</Body>
          <Button label="Delete" kind="quiet" onPress={() => remove(e.id)} />
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: { minHeight: 110, textAlignVertical: 'top' },
  moods: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1], marginBottom: space[3] },
  mood: { borderWidth: 2, borderRadius: radius.sm, paddingHorizontal: space[3], minHeight: 44, justifyContent: 'center' },
});
