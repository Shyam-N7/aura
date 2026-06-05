import { TweaksPanel, TweakSection, TweakText, TweakRadio, TweakSelect, TweakToggle, TweakButton } from './TweaksPanel';
import { THEMES } from '../data';
import { resetOnboarded } from '../lib/onboarding';

const THEME_KEYS = Object.keys(THEMES);
const MOOD_OPTIONS = ['calm', 'focused', 'warm', 'restless', 'upbeat', 'social'];

export function TweaksHost({ t, setTweak }) {
  return (
    <TweaksPanel>
      <TweakSection label="AI DJ"/>
      <TweakText label="Persona" value={t.djName} onChange={v => setTweak('djName', (v||'').toUpperCase())}/>

      <TweakSection label="Appearance"/>
      <TweakRadio label="Theme" value={t.theme} options={THEME_KEYS}
        onChange={v => setTweak('theme', v)}/>

      <TweakSection label="Mood (demo override)"/>
      <TweakSelect label="Detected" value={t.mood} options={MOOD_OPTIONS}
        onChange={v => setTweak('mood', v)}/>

      <TweakSection label="Flow"/>
      <TweakToggle label="Skip sensing intro" value={t.skipSensing} onChange={v => setTweak('skipSensing', v)}/>
      <TweakButton label="Reset onboarding" secondary onClick={() => {
        resetOnboarded();
        window.location.reload();
      }}/>
    </TweaksPanel>
  );
}
