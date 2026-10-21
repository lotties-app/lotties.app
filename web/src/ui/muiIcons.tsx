import { Icon } from './Icon';

/** The arrow of MUI's `Select` (it passes a className that rotates it when open). */
export function SelectArrowIcon({ className }: { className?: string }) {
  return <Icon name="expand" size={20} className={className} />;
}
