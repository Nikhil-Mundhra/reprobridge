const EXCLUDED_ROBOTIC_VOICE_RE =
  /albert|bad news|bahh|bells|boing|bubbles|cellos|eddy|flo|fred|good news|grandma|grandpa|jester|junior|kathy|organ|ralph|reed|rocko|sandy|shelley|superstar|trinoids|whisper|wobble|zarvox|espeak/i;

const TIER1_NEURAL_RE = /online \(natural\)|\bnatural\b|\bneural\b|\(premium\)|\(enhanced\)|\bsiri\b/i;
const TIER2_GOOGLE_PRIMARY_RE = /^google us english$|^google uk english/i;
const TIER3_VENDOR_RE = /\bgoogle\b|\bmicrosoft\b/i;
const TIER4_MODERN_APPLE_RE = /\b(ava|zoe|evan|allison|nicky|serena|martha|arthur)\b/i;
const TIER5_CLASSIC_RE = /\b(samantha|karen|daniel|moira|tessa)\b/i;

export function scoreVoice(voice: SpeechSynthesisVoice): number {
  const name = voice.name ?? "";
  const lang = (voice.lang ?? "").toLowerCase();
  if (!lang.startsWith("en") || EXCLUDED_ROBOTIC_VOICE_RE.test(name)) {
    return -1;
  }

  let score = 0;
  if (TIER1_NEURAL_RE.test(name)) {
    score = 100;
  } else if (TIER2_GOOGLE_PRIMARY_RE.test(name.trim())) {
    score = 75;
  } else if (TIER3_VENDOR_RE.test(name)) {
    score = 40;
  } else if (TIER4_MODERN_APPLE_RE.test(name)) {
    score = 20;
  } else if (TIER5_CLASSIC_RE.test(name)) {
    score = 10;
  } else {
    score = 1;
  }

  if (lang === "en-us" || lang === "en-gb") {
    score += 3;
  }
  if (voice.localService === false && /(google|natural|neural)/i.test(name)) {
    score += 2;
  }

  return score;
}

export function getRankedEnglishVoices(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  const seen = new Set<string>();
  const scored: Array<{ voice: SpeechSynthesisVoice; score: number }> = [];

  for (const voice of voices) {
    const score = scoreVoice(voice);
    if (score < 0) continue;
    const key = voice.voiceURI || `${voice.name}|${voice.lang}`;
    if (seen.has(key)) continue;
    seen.add(key);
    scored.push({ voice, score });
  }

  scored.sort((a, b) => b.score - a.score || (a.voice.name ?? "").localeCompare(b.voice.name ?? ""));
  return scored.map((entry) => entry.voice);
}

export function formatForSpeech(text: string): string {
  return text
    .replace(/\b([A-Z]{2,}(?:_[A-Z0-9]+)+)\b/g, (_, token: string) =>
      token.toLowerCase().replace(/_/g, " ")
    )
    .replace(/(\d+(?:\.\d+)?)\s*[–—-]\s*(\d+(?:\.\d+)?)/g, "$1 to $2")
    .replace(/(?:>=|≥)\s*/g, "at least ")
    .replace(/(?:<=|≤)\s*/g, "at most ")
    .replace(/<\s*/g, "under ")
    .replace(/>\s*/g, "above ")
    .replace(/\bmIU\/L\b/gi, "milli-international units per liter")
    .replace(/\bmg\/dL\b/gi, "milligrams per deciliter")
    .replace(/\bng\/mL\b/gi, "nanograms per milliliter")
    .replace(/\bIU\/mL\b/gi, "international units per milliliter")
    .replace(/\bmmHg\b/gi, "millimeters of mercury")
    .replace(/\bHbA1c\b/gi, "hemoglobin A 1 C")
    .replace(/\bOB-GYN\b/gi, "O B G Y N")
    .replace(/\bOGTT\b/gi, "oral glucose tolerance test")
    .replace(/\bTSH\b/g, "T S H")
    .replace(/\bHPV\b/g, "H P V")
    .replace(/\bMMR\b/g, "M M R")
    .replace(/\bVZV\b/g, "varicella zoster virus")
    .replace(/\bT4\b/g, "T 4")
    .replace(/\bT1\b/g, "trimester one")
    .replace(/\bBP\b/g, "blood pressure")
    .replace(/\s+/g, " ")
    .trim();
}

export function splitIntoSentences(text: string): string[] {
  const cleaned = text.trim();
  if (!cleaned) return [];
  return cleaned
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}
