import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';

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

export function useSpeechInput(options: {
  language: string;
  onTranscript: (text: string) => void;
}) {
  const { language, onTranscript } = options;
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<SpeechError>(null);

  // Held in a ref so the event subscriptions below are not re-created on
  // every keystroke in the parent.
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

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

  return { listening, error, start, stop };
}
