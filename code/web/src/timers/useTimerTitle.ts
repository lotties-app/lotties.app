import { useTranslation } from 'react-i18next';
import { useEventTypeText } from '../i18n/eventTypeText';
import { getOwn } from '../util/ownProperty';
import type { RunningTimer } from './runningTimers';

/**
 * The title of a running timer: "Nap", "Night sleep", "Nursing", "Bottle", "Tummy time", a custom
 * name.
 */
export function useTimerTitle(): (timer: Pick<RunningTimer, 'event' | 'type' | 'kind'>) => string {
  const names = useEventTypeText();
  const { t } = useTranslation();
  return ({ event, type, kind }) => {
    if (!type) return t('common.event');
    if (kind === 'nursing') return t('now.nursing.title');
    if (type.key === 'sleep') {
      const raw = getOwn(event.payload, 'kind');
      const option = typeof raw === 'string' ? raw : 'nap';
      return names.optionLabel(type, { key: 'kind' }, option);
    }
    if (
      type.key === 'feeding' &&
      type.babyId === null &&
      getOwn(event.payload, 'method') === 'bottle'
    ) {
      return names.optionLabel(type, { key: 'method' }, 'bottle');
    }
    return names.typeName(type);
  };
}
