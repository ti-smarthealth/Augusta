import { useCallback, useRef, useState } from 'react';
import { Alert } from 'react-native';

type SpeechApi = typeof import('expo-speech-recognition');

interface ResultEvent { results: { transcript?: string }[] }
interface ErrorEvent { error: string; message?: string }

/** The three subscriptions this hook makes, typed without the module present. */
type EventHook = {
  (event: 'result', listener: (e: ResultEvent) => void): void;
  (event: 'end', listener: () => void): void;
  (event: 'error', listener: (e: ErrorEvent) => void): void;
};

/**
 * `expo-speech-recognition`, loaded defensively.
 *
 * **This is a guarded require rather than a static import because the static
 * import took the whole screen down.** The package resolves its native module
 * at *import* time, so on a binary that does not carry `ExpoSpeechRecognition`
 * it throws `Cannot find native module 'ExpoSpeechRecognition'` before a single
 * component renders — and because `appointment-form.tsx` imports this hook at
 * module scope, opening "new appointment" crashed the app outright.
 *
 * That is not hypothetical: TestFlight build 12 shipped without the pod (123
 * were installed and that one was silently absent), so *every* attempt to add
 * an appointment on that build was fatal. A native module that is missing is a
 * missing feature; it must not be a missing screen.
 *
 * Resolved once, and availability cannot change within a process — it is a
 * property of the binary. That is what makes swapping the event subscription
 * for a no-op below safe under the rules of hooks: the choice is constant for
 * the lifetime of the app, so the hook count never varies between renders.
 */
let cached: SpeechApi | null | undefined;
function loadSpeechRecognition(): SpeechApi | null {
  if (cached === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- the
      // whole point: a static import cannot be caught, and this one throws on
      // any binary without the native module.
      cached = require('expo-speech-recognition') as SpeechApi;
    } catch {
      cached = null;
    }
  }
  return cached;
}

const speech = loadSpeechRecognition();

/** The real subscription when the module is there, otherwise a no-op. */
const useSpeechEvent = (speech?.useSpeechRecognitionEvent ?? (() => {})) as EventHook;

/**
 * Whether dictation can work in this build at all. Screens should hide the
 * microphone rather than offer a control that can only apologise.
 */
export const dictationAvailable = speech !== null;

/**
 * Drives dictation for a single screen. Only one field can be listening at a
 * time since the underlying recognizer is a global singleton, so this hook is
 * meant to be instantiated once per screen and shared across fields.
 */
export function useVoiceDictation() {
  const [activeField, setActiveField] = useState<string | null>(null);
  const baseTextRef = useRef('');
  const onChangeTextRef = useRef<((text: string) => void) | null>(null);

  useSpeechEvent('result', (event) => {
    if (!onChangeTextRef.current) return;
    const transcript = event.results[0]?.transcript ?? '';
    const base = baseTextRef.current;
    onChangeTextRef.current(base ? `${base} ${transcript}` : transcript);
  });

  useSpeechEvent('end', () => {
    setActiveField(null);
    onChangeTextRef.current = null;
  });

  useSpeechEvent('error', (event) => {
    setActiveField(null);
    onChangeTextRef.current = null;
    if (event.error !== 'no-speech' && event.error !== 'aborted') {
      Alert.alert('Dictation Error', event.message || 'Could not transcribe speech.');
    }
  });

  const start = useCallback(async (fieldKey: string, baseText: string, onChangeText: (text: string) => void) => {
    // Belt and braces: callers are expected to hide the control when
    // `dictationAvailable` is false, but a stale render must not reach `.start`
    // on a module that is not there.
    if (!speech) {
      Alert.alert('Not Available', 'Speech recognition is not available in this version of the app.');
      return;
    }

    if (!speech.ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
      Alert.alert('Not Available', 'Speech recognition is not available on this device.');
      return;
    }

    const { granted } = await speech.ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!granted) {
      Alert.alert('Permission Required', 'Microphone and speech recognition access are needed for dictation.');
      return;
    }

    baseTextRef.current = baseText;
    onChangeTextRef.current = onChangeText;
    setActiveField(fieldKey);
    speech.ExpoSpeechRecognitionModule.start({ lang: 'en-US', interimResults: true });
  }, []);

  const stop = useCallback(() => {
    speech?.ExpoSpeechRecognitionModule.stop();
  }, []);

  return { activeField, start, stop, available: dictationAvailable };
}
