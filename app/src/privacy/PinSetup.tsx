import { useState } from 'react';

import { Body, Button, ErrorText, Field } from '../ui/kit';
import { isValidPin, PIN_MAX, PIN_MIN } from './pin';
import { setPin } from './pinStore';

/** Enter a new PIN twice. Calls onDone after it is saved. */
export function PinSetup({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!isValidPin(first)) return setError(`Use ${PIN_MIN}–${PIN_MAX} digits.`);
    if (first !== second) return setError("The two PINs don't match.");
    try {
      await setPin(first);
      onDone();
    } catch (e) {
      setError(String(e));
    }
  };

  const digits = (t: string) => t.replace(/\D/g, '');
  return (
    <>
      <Body muted>
        {PIN_MIN}–{PIN_MAX} digits. It can't be recovered if you forget it.
      </Body>
      <Field
        value={first}
        onChangeText={(t) => setFirst(digits(t))}
        placeholder="New PIN"
        keyboardType="number-pad"
        secureTextEntry
        maxLength={PIN_MAX}
        accessibilityLabel="New PIN"
      />
      <Field
        value={second}
        onChangeText={(t) => setSecond(digits(t))}
        placeholder="Same PIN again"
        keyboardType="number-pad"
        secureTextEntry
        maxLength={PIN_MAX}
        accessibilityLabel="Confirm PIN"
      />
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button label="Save PIN" onPress={save} />
      {onCancel ? <Button label="Cancel" kind="secondary" onPress={onCancel} /> : null}
    </>
  );
}
