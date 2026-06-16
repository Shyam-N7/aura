import { useEffect, useState } from 'react';
import { getEqUserPresets, subscribeEqUserPresets } from '../lib/eqPresets';

// Live list of the user's saved EQ presets, kept in sync across every Equalizer
// instance (mobile player, desktop rail, mini bars) via the shared subscription.
export function useEqUserPresets() {
  const [presets, setPresets] = useState(getEqUserPresets);
  useEffect(() => subscribeEqUserPresets(setPresets), []);
  return presets;
}
