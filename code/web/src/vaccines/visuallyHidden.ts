/**
 * Text for screen readers only. In pixels, not MUI's `width: 1` (which `sx` reads as 100%): an
 * absolutely placed hidden text a full line wide would push the page sideways.
 */
export const visuallyHidden = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;
