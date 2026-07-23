"use client";

import { useSpeechToText } from "@/lib/useSpeechToText";

function MicIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <path d="M12 17v4M8 21h8" />
    </svg>
  );
}

/** A mic button meant to sit inside a `relative`-positioned wrapper around a
 * textarea (see CaptureCard.tsx/log/page.tsx/profile/page.tsx for the
 * pattern) -- appends each recognized phrase via `onTranscript` rather than
 * owning the field's value itself, so it composes with whatever the field
 * already has typed. Renders nothing when the browser has no speech
 * recognition support, rather than a button that would just do nothing. */
export default function VoiceInputButton({ onTranscript, className }: { onTranscript: (text: string) => void; className?: string }) {
  const { isSupported, isListening, toggle } = useSpeechToText(onTranscript);

  if (!isSupported) return null;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={isListening}
      aria-label={isListening ? "Stop voice input" : "Start voice input"}
      title={isListening ? "Stop voice input" : "Start voice input"}
      className={`h-8 w-8 flex items-center justify-center rounded-md transition-colors ${
        isListening ? "text-red-400 bg-red-400/10" : "text-muted hover:text-foreground hover:bg-surface-hover"
      } ${className ?? ""}`}
    >
      <MicIcon className={`h-4 w-4 ${isListening ? "animate-pulse" : ""}`} />
    </button>
  );
}
