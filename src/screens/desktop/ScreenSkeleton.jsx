import { AuraLoader } from '../../components/feedback/AuraLoader';

export function ScreenSkeleton({ label = 'Loading' }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <AuraLoader label={label}/>
    </div>
  );
}
