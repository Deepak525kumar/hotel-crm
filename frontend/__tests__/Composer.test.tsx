import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Composer } from "@/components/chatbot/Composer";

/**
 * The composer, and dictation.
 *
 * The old one was a bordered textarea beside a separate square button with
 * `resize-y` left on: a drag handle in the corner, a field that could be
 * pulled out of line with its own button, and no growth however much was
 * typed. The tests below are about the two things that replaced it — one
 * surface that grows, and a microphone that must not appear where it cannot
 * work.
 */

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));

/** A controlled harness, since the real one lives in ChatPanel's state. */
function Harness({ onSubmit = jest.fn() }: { onSubmit?: () => void }) {
  const [value, setValue] = useState("");
  return (
    <Composer
      value={value}
      onChange={setValue}
      onSubmit={onSubmit}
      sending={false}
      language="en"
    />
  );
}

/** Installs a fake `SpeechRecognition` and hands back the live instance. */
interface FakeSpeech {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: unknown) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: jest.Mock;
  stop: jest.Mock;
  abort: jest.Mock;
}

function installSpeech() {
  const instances: FakeSpeech[] = [];
  class FakeRecognition {
    lang = "";
    continuous = false;
    interimResults = false;
    onresult: ((e: unknown) => void) | null = null;
    onerror: ((e: { error?: string }) => void) | null = null;
    onend: (() => void) | null = null;
    start = jest.fn();
    stop = jest.fn();
    abort = jest.fn();
    constructor() {
      instances.push(this as unknown as FakeSpeech);
    }
  }
  installOn("SpeechRecognition", FakeRecognition);
  return { instances, latest: () => instances[instances.length - 1]! };
}

/** Assigning to a window global the DOM lib does not declare. */
function installOn(name: string, value: unknown) {
  (window as unknown as Record<string, unknown>)[name] = value;
}
function removeFrom(name: string) {
  delete (window as unknown as Record<string, unknown>)[name];
}

afterEach(() => {
  removeFrom("SpeechRecognition");
  removeFrom("webkitSpeechRecognition");
});

describe("the field and the send button", () => {
  it("will not send an empty or whitespace-only message", () => {
    const onSubmit = jest.fn();
    render(<Harness onSubmit={onSubmit} />);

    const send = screen.getByRole("button", { name: "Send" });
    expect(send).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "   " } });
    expect(send).toBeDisabled();
    fireEvent.click(send);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("enables send once there is something to send", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "hi" } });
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
  });

  it("sends on Enter and breaks the line on Shift+Enter", () => {
    const onSubmit = jest.fn();
    render(<Harness onSubmit={onSubmit} />);
    const field = screen.getByLabelText("Message");
    fireEvent.change(field, { target: { value: "when do I work" } });

    fireEvent.keyDown(field, { key: "Enter", shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.keyDown(field, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  /** Enter on an empty field must not fire an empty turn. */
  it("does not send on Enter when there is nothing to send", () => {
    const onSubmit = jest.fn();
    render(<Harness onSubmit={onSubmit} />);
    fireEvent.keyDown(screen.getByLabelText("Message"), { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  /**
   * The drag handle is gone. It let the field be resized out of alignment
   * with the buttons sitting beside it, which is why the composer looked
   * broken after anyone touched it.
   */
  it("has no manual resize handle", () => {
    render(<Harness />);
    expect(screen.getByLabelText("Message").className).toContain("resize-none");
  });
});

describe("dictation", () => {
  /**
   * THE MOST IMPORTANT ONE. Firefox ships no SpeechRecognition at all and
   * there is no polyfill here — a microphone button that does nothing when
   * pressed is worse than no microphone.
   */
  it("shows no microphone when the browser cannot do speech", () => {
    render(<Harness />);
    expect(screen.queryByRole("button", { name: /dictate/i })).not.toBeInTheDocument();
  });

  it("shows one when the browser can", async () => {
    installSpeech();
    render(<Harness />);
    expect(await screen.findByRole("button", { name: "Dictate a message" })).toBeInTheDocument();
  });

  it("accepts the webkit-prefixed implementation Safari ships", async () => {
    const { instances } = installSpeech();
    const win = window as unknown as Record<string, unknown>;
    win.webkitSpeechRecognition = win.SpeechRecognition;
    removeFrom("SpeechRecognition");

    render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: "Dictate a message" }));
    expect(instances).toHaveLength(1);
  });

  it("listens in the app's language, not the browser's", async () => {
    const speech = installSpeech();
    render(
      <Composer value="" onChange={jest.fn()} onSubmit={jest.fn()} sending={false} language="de" />
    );
    fireEvent.click(await screen.findByRole("button", { name: "Dictate a message" }));

    expect(speech.latest().lang).toBe("de-DE");
  });

  it("puts what was said into the field", async () => {
    const speech = installSpeech();
    render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: "Dictate a message" }));

    speech.latest().onresult?.({
      resultIndex: 0,
      results: [Object.assign([{ transcript: "I am sick tomorrow" }], { isFinal: true })],
    });

    await waitFor(() =>
      expect(screen.getByLabelText("Message")).toHaveValue("I am sick tomorrow")
    );
  });

  /**
   * Dictation ADDS to what is there. Someone types half a sentence, taps the
   * microphone and says the rest; overwriting their typing would be its own
   * bug report.
   */
  it("keeps text that was already typed", async () => {
    const speech = installSpeech();
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "I am sick" } });
    fireEvent.click(await screen.findByRole("button", { name: "Dictate a message" }));

    speech.latest().onresult?.({
      resultIndex: 0,
      results: [Object.assign([{ transcript: "on Friday" }], { isFinal: true })],
    });

    await waitFor(() =>
      expect(screen.getByLabelText("Message")).toHaveValue("I am sick on Friday")
    );
  });

  it("offers a way to stop, and says it is listening", async () => {
    const speech = installSpeech();
    render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: "Dictate a message" }));

    const stop = await screen.findByRole("button", { name: "Stop dictating" });
    expect(screen.getByLabelText("Message")).toHaveAttribute("placeholder", "Listening…");

    fireEvent.click(stop);
    expect(speech.latest().stop).toHaveBeenCalled();
  });

  it("explains a blocked microphone instead of failing silently", async () => {
    const speech = installSpeech();
    render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: "Dictate a message" }));

    speech.latest().onerror?.({ error: "not-allowed" });

    expect(await screen.findByRole("status")).toHaveTextContent(/microphone access is blocked/i);
  });

  /** Tapping the button and saying nothing is not an error worth reporting. */
  it("says nothing when no speech was heard", async () => {
    const speech = installSpeech();
    render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: "Dictate a message" }));

    speech.latest().onerror?.({ error: "no-speech" });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Dictate a message" })).toBeInTheDocument()
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  /**
   * A recogniser left running keeps the browser's microphone indicator lit,
   * which reads to a worker as the app listening to them after they closed it.
   */
  it("shuts the microphone down when the panel unmounts", async () => {
    const speech = installSpeech();
    const { unmount } = render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: "Dictate a message" }));

    unmount();
    expect(speech.latest().abort).toHaveBeenCalled();
  });
});
