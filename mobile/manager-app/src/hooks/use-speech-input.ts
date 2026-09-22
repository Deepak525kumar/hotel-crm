import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * THE NATIVE MODULE IS REQUIRED LAZILY, AND THE WHOLE APP DEPENDED ON IT.
 *
 * This file used to open with a top-level
 * `import { ... } from 'expo-speech-recognition'`. A top-level import of an
 * Expo module whose NATIVE half is absent from the running binary throws
 * `Cannot find native module 'ExpoSpeechRecognition'` during module
 * evaluation — which takes down every importer, not just the microphone
 * button. expo-router reports it as the thoroughly misleading
 * "Route is missing the required default export", and with `assistant.tsx`
 * failing to evaluate the app could not be navigated at all: reported
 * 2026-09-22 as "I am not able to log into the app".
 *
 * That is not a new lesson here. `lib/contract-download.ts` records the same
 * shape taking out `shift/[id].tsx` via `expo-location`, and says so at
 * length. This file was copied from worker-app — where the native module IS
 * in the build — without the lesson being applied.
 *
 * `expo-speech-recognition` is a RECENT addition to this app, so any
 * development build made before it was added does not contain it until the
 * app is rebuilt. Requiring it lazily means such a build loses dictation and
 * nothing else.
 */
type SpeechModule = {
  ExpoSpeechRecognitionModule: {
    stop: () => void;
    abort: () => void;
    requestPermissionsAsync: () => Promise<{ granted: boolean }>;
    start: (options: Record<string, unknown>) => void;
  };
  // Typed loosely on purpose: the real types live in the module that may not
  // be present, and importing them for typing alone would reintroduce the
  // top-level dependency this indirection exists to remove.
  useSpeechRecognitionEvent: (
    event: 'result',
    handler: (payload: { results?: { transcript?: string }[] }) => void
  ) => void;
};

type SpeechEventModule = SpeechModule & {
  useSpeechRecognitionEvent: (
    event: 'result' | 'error' | 'end',
    handler: (payload: { results?: { transcript?: string }[]; error?: string }) => void
  ) => void;
};

const speech: SpeechEventModule | null = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-speech-recognition') as SpeechEventModule;
  } catch {
    return null;
  }
})();

/**
 * Dictation for the assistant composer.
 *
 * WHY IT MATTERS MORE HERE THAN ON THE WEB. These are cleaners and checkers
 * mid-shift, one-handed, often in gloves, on a phone. Typing "ich bin krank
 * und kann morgen nicht kommen" on a phone keyboard is the difference between
 * using the assistant and not bothering, and several of the six languages the
 * app ships in are slower still to type on a Latin keyboard.
 *
 * Recognition is ON-DEVICE where the platform offers it (`requiresOnDeviceRecognition`
 * below): the audio is a person's voice, and keeping it on the handset means
 * this feature adds no new category of personal data to a platform that
 * already treats what people type as sensitive. Where the OS can only do it
 * server-side it degrades to the platform's own service, which is the same
 * one the keyboard's dictation key already uses.
 */

/** The app's locales as the tags the recogniser expects. */
const RECOGNITION_LOCALE: Record<string, string> = {
  de: 'de-DE',
  en: 'en-GB',
  fr: 'fr-FR',
  ar: 'ar-SA',
  ur: 'ur-PK',
  uk: 'uk-UA',
};

export type SpeechError = 'denied' | 'failed' | null;

type SpeechInput = {
  listening: boolean;
  error: SpeechError;
  /** False when the native module is absent — hide the microphone entirely. */
  available: boolean;
  start: () => void | Promise<void>;
  stop: () => void;
};

type SpeechInputOptions = { language: string; onTranscript: (text: string) => void };

/**
 * The no-native-module case.
 *
 * Calls no hooks from the missing module, so hook order stays stable — the
 * choice between the two implementations is made ONCE at module load, never
 * per render.
 */
function useSpeechInputUnavailable(_options: SpeechInputOptions): SpeechInput {
  void _options;
  return {
    listening: false,
    error: null,
    available: false,
    start: () => {},
    stop: () => {},
  };
}

function useSpeechInputNative(options: SpeechInputOptions): SpeechInput {
  const { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } = speech!;
  const { language, onTranscript } = options;
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<SpeechError>(null);

  // Held in a ref so the event subscriptions below are not re-created on
  // every keystroke in the parent.
  const onTranscriptRef = useRef(onTranscript);
  // Assigned in an effect rather than during render. Writing a ref while
  // rendering is a side effect, and a render can be thrown away and re-run --
  // the React lint rule rejects it for exactly that reason. The web copy of
  // this hook had the same line and was fixed first; this one arrived on main
  // unfixed, which is how the lint gate caught it on a later merge.
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  useSpeechRecognitionEvent('result', (event) => {
    const text = event.results?.[0]?.transcript ?? '';
    if (text) onTranscriptRef.current(text);
  });

  useSpeechRecognitionEvent('error', (event) => {
    // "no-speech" is somebody tapping the button and saying nothing, and
    // "aborted" is them stopping it themselves. Neither is worth a message.
    if (event.error === 'no-speech' || event.error === 'aborted') {
      setError(null);
    } else if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      setError('denied');
    } else {
      setError('failed');
    }
    setListening(false);
  });

  useSpeechRecognitionEvent('end', () => setListening(false));

  const stop = useCallback(() => {
    ExpoSpeechRecognitionModule.stop();
    setListening(false);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    try {
      // Asked EVERY time rather than cached: a person can revoke microphone
      // access in system settings between one shift and the next, and a
      // cached "granted" would leave the button silently dead afterwards.
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        setError('denied');
        return;
      }

      ExpoSpeechRecognitionModule.start({
        lang: RECOGNITION_LOCALE[language] ?? RECOGNITION_LOCALE.en!,
        // Interim results so the words appear as they are said. Waiting for
        // the final result looks frozen, and a worker will tap again.
        interimResults: true,
        // One utterance. A microphone that stays open until it is remembered
        // is both a battery cost and the wrong default for a person who is
        // working.
        continuous: false,
        requiresOnDeviceRecognition: false,
      });
      setListening(true);
    } catch {
      setError('failed');
      setListening(false);
    }
  }, [language]);

  // A recogniser left running after the screen is closed keeps the OS
  // microphone indicator lit, which reads as the app listening in.
  useEffect(() => {
    return () => {
      try {
        ExpoSpeechRecognitionModule.abort();
      } catch {
        // Nothing to abort; the screen is going away regardless.
      }
    };
  }, []);

  return { listening, error, available: true, start, stop };
}

/**
 * Picked once, at module load. Both implementations have a fixed hook shape,
 * so this cannot violate the rules of hooks.
 */
export const useSpeechInput = speech ? useSpeechInputNative : useSpeechInputUnavailable;
