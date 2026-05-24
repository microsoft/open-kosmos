import { useFeatureFlag } from '@/lib/featureFlags';
import { useBuddyIPC } from './useBuddyIPC';
import { BuddyAtom, HatchingCeremonyAtom } from './buddy.atom';
import { HatchingCeremony } from './HatchingCeremony';
import { BuddyMainPanel } from './BuddyMainPanel';
import { BuddyFloatingWidget } from './BuddyFloatingWidget';
import { Egg } from 'lucide-react';
import { RARITY_COLORS } from '../../../main/lib/buddy/types';

function Buddy() {
  const [isHatchingCeremony, setIsHatchingCeremony] = HatchingCeremonyAtom.use();
  const  { state: buddyState, actions } = useBuddyIPC();

  return (
    <>
      {/* Buddy Hatching Ceremony — mounted at root level for first-time users */}
      {isHatchingCeremony && buddyState.companion && (
        <HatchingCeremony
          companion={buddyState.companion}
          onComplete={() => {
            setIsHatchingCeremony(false);
            actions.setShowMainPanel(true);
          }}
        />
      )}

      {/* Buddy Main Page modal */}
      {buddyState.showMainPanel && (
        <BuddyMainPanel
          onHatchNew={async () => {
            const result = await actions.hatch();
            if (result) {
              actions.setShowMainPanel(false);
              setIsHatchingCeremony(true);
            }
          }}
          onClose={() => actions.setShowMainPanel(false)}
        />
      )}

      {/* Buddy Companion floating widget — hidden during hatching ceremony */}
      {!isHatchingCeremony && <BuddyFloatingWidget buddy={buddyState} actions={actions} />}
    </>
  );
}

export default () => {
  const enabled = useFeatureFlag('openkosmosFeatureBuddy');
  return enabled ? <Buddy /> : null;
};

function Entry() {
  const [state, actions] = BuddyAtom.use();
  const setIsHatchingCeremony = HatchingCeremonyAtom.useChange();

  async function onBuddyClick() {
    if (state.roster.length === 0) {
      // New user — trigger first hatch + ceremony
      const result = await actions.hatch();
      if (result) {
        setIsHatchingCeremony(true);
      }
    } else {
      actions.setShowMainPanel(true);
    }
  }

  const hasBuddy = state.roster.length > 0;
  const buddyRarityColor = state?.companion ? RARITY_COLORS[state.companion.rarity] : null;

  return (
    <button
      className={`buddy-egg-button${hasBuddy ? '' : ' no-buddy'}`}
      onClick={onBuddyClick}
      title={hasBuddy ? 'Open Backpack' : 'Hatch your first buddy!'}
      aria-label={hasBuddy ? 'Open buddy backpack' : 'Hatch first buddy'}
      type="button"
    >
      <Egg className="buddy-egg-icon" size={20} />
      {hasBuddy && buddyRarityColor && (
        <span
          className="buddy-egg-indicator"
          style={{ backgroundColor: buddyRarityColor }}
        />
      )}
    </button>
  );
}

export function BuddyEntryButton() {
  const enabled = useFeatureFlag('openkosmosFeatureBuddy');
  return enabled ? <Entry /> : null;
}
