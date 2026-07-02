/**
 * Maps persona names to ElevenLabs voice IDs.
 * Voice IDs are from ElevenLabs' pre-made voice library.
 * Replace with cloned voices for production.
 */
export interface PersonaVoice {
  readonly personaId: string;
  readonly personaName: string;
  readonly elevenLabsVoiceId: string;
}

export const PERSONA_VOICES: readonly PersonaVoice[] = [
  {
    personaId: 'sarah-cfo',
    personaName: 'Sarah Chen',
    // "Rachel" — calm, professional female voice
    elevenLabsVoiceId: process.env['VOICE_ID_SARAH'] ?? '21m00Tcm4TlvDq8ikWAM',
  },
  {
    personaId: 'priya-cmo',
    personaName: 'Priya Reddy',
    // "Bella" — warm, enthusiastic female voice
    elevenLabsVoiceId: process.env['VOICE_ID_PRIYA'] ?? 'EXAVITQu4vr4xnSDxMaL',
  },
  {
    personaId: 'marcus-da',
    personaName: 'Marcus Webb',
    // "Arnold" — assertive, deep male voice
    elevenLabsVoiceId: process.env['VOICE_ID_MARCUS'] ?? 'VR6AewLTigWG4xSOukaG',
  },
];

export function voiceForPersona(personaName: string): PersonaVoice | undefined {
  return PERSONA_VOICES.find((v) => v.personaName === personaName);
}
