import { use } from 'react';
import { LocaleContext, type LocaleApi } from './LocaleContext';

export function useLocale(): LocaleApi {
  return use(LocaleContext);
}
