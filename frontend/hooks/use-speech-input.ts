"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Dictation for the composer, on top of the browser's own speech recognition.
 *
 * WHY THE BROWSER'S. Sending audio to a server would mean recording a person
 * mid-shift, shipping their voice somewhere, and holding it long enough to
 * transcribe — a new category of personal data on a platform that already
 * treats what people type as sensitive. `SpeechRecognition` keeps the audio
 * inside the browser and hands back text, so nothing new is stored and the
 * privacy posture does not change.
 *
 * IT IS NOT EVERYWHERE, and the component must cope rather than assume:
 * Chrome and Edge implement it, Safari implements it prefixed, and Firefox
 * does not implement it at all. `supported` is false there and the button is
 * simply not rendered — a dead microphone is worse than no microphone.
 */

/** The shape we use, declared locally: TS's DOM lib does not ship it. */
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

type Ctor = new () => SpeechRecognitionLike;

function getConstructor(): Ctor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * The app's locales as BCP-47 tags the recogniser understands.
 *
 * Dictating in the language the app is set to is the whole point: a cleaner
 * whose app is in Urdu is not going to be understood by an English model, and
 * `navigator.language` describes the browser, not the choice they made in the
 * app.
 */
const RECOGNITION_LOCALE: Record<string, string> = {
  de: "de-DE",
  en: "en-GB",
  fr: "fr-FR",
  ar: "ar-SA",
  ur: "ur-PK",
  uk: "uk-UA",
};

export type SpeechError = "denied" | "no-speech" | "failed" | null;

export function useSpeechInput(options: {
  /** App locale ("de", "en", …). */
  language: string;
  /** Called with the best transcript so far, interim included. */
  onTranscript: (text: string, isFinal: boolean) => void;
}) {
  const { language, onTranscript } = options;
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<SpeechError>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // Kept in a ref so restarting does not re-create the recogniser every time
  // the parent re-renders on a keystroke.
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  // Detected after mount, never during render: the server has no `window`,
  // and deciding this during render would make the button's presence differ
  // between the server and client trees.
  useEffect(() => {
    setSupported(getConstructor() !== null);
  }, []);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Ctor = getConstructor();
    if (!Ctor) return;

    // Any previous session is abandoned rather than left running: two
    // recognisers feeding one textarea interleave their transcripts.
    recognitionRef.current?.abort();
    setError(null);

    const recognition = new Ctor();
    recognition.lang = RECOGNITION_LOCALE[language] ?? RECOGNITION_LOCALE.en!;
    // One utterance, not an open microphone. A worker taps, says a sentence,
    // and it stops — rather than listening until they remember to stop it.
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let text = "";
      let isFinal = false;
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (!result) continue;
        text += result[0]?.transcript ?? "";
        if (result.isFinal) isFinal = true;
      }
      if (text) onTranscriptRef.current(text, isFinal);
    };

    recognition.onerror = (event) => {
      // "no-speech" is someone tapping the button and saying nothing. That is
      // not an error worth showing; it just ends.
      if (event.error === "no-speech" || event.error === "aborted") {
        setError(null);
      } else if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setError("denied");
      } else {
        setError("failed");
      }
      setListening(false);
    };

    recognition.onend = () => setListening(false);

    try {
      recognition.start();
      recognitionRef.current = recognition;
      setListening(true);
    } catch {
      // `start()` throws if called while already running. Nothing to report.
      setListening(false);
    }
  }, [language]);

  // A recogniser left running after the panel closes keeps the microphone
  // indicator lit in the browser chrome, which reads as the app spying.
  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
    };
  }, []);

  return { supported, listening, error, start, stop, clearError: () => setError(null) };
}
