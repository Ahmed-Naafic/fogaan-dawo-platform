import { Apple, Baby, Bone, Brain, Flower2, HeartPulse, Sparkles, Stethoscope } from 'lucide-react';

/** Maps the icon names stored in data to Lucide components. */
export const specialtyIcons = { Apple, Baby, Bone, Brain, Flower2, HeartPulse, Sparkles, Stethoscope };

export function getSpecialtyIcon(name) {
  return specialtyIcons[name] ?? Stethoscope;
}
