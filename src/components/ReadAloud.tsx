"use client";
import { useEffect, useState } from "react";

/** Text-to-speech using the device's built-in voices (Web Speech API) – free and works offline on most phones. */
export function ReadAloud({ text, lang }: { text: string; lang: string }) {
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    setSupported("speechSynthesis" in window);
    return () => window.speechSynthesis?.cancel();
  }, []);

  if (!supported) return null;

  function toggle() {
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.onend = () => setSpeaking(false);
    window.speechSynthesis.speak(u);
    setSpeaking(true);
  }

  return (
    <button onClick={toggle} className="rounded-md border border-stone-300 px-3 py-1.5 text-sm dark:border-stone-700">
      {speaking ? "■ Stop listening" : "▶ Listen (text-to-speech)"}
    </button>
  );
}
