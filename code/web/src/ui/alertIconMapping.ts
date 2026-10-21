import { createElement } from 'react';
import type { AlertProps } from '@mui/material';
import { Icon } from './Icon';

/** Status icons of `Alert`, so the built-in Material glyphs never show. */
export const ALERT_ICON_MAPPING: NonNullable<AlertProps['iconMapping']> = {
  success: createElement(Icon, { name: 'success', size: 20 }),
  info: createElement(Icon, { name: 'info', size: 20 }),
  warning: createElement(Icon, { name: 'warning', size: 20 }),
  error: createElement(Icon, { name: 'error', size: 20 }),
};
