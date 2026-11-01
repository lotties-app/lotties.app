import type { Vaccination } from '../db/models';

/** The columns of the card's table, in order (catalog keys under `vaccines.card.columns`). */
export const CARD_COLUMNS = ['date', 'vaccine', 'dose', 'lot', 'clinic'] as const;

/**
 * Column widths (the table is fixed, so a long clinic name wraps in its column instead of widening
 * the page on a phone).
 */
export const CARD_COLUMN_WIDTH: Readonly<Record<(typeof CARD_COLUMNS)[number], string>> = {
  date: '22%',
  vaccine: '25%',
  dose: '15%',
  lot: '14%',
  clinic: '24%',
};

/**
 * What a printed vaccination card keeps: the app's chrome (header, bottom bar, floating buttons,
 * notices) and this page's own buttons are hidden, the page is black on white with ruled table
 * cells, and the column is as wide as the paper. Mounted with the card only, so no other page prints
 * differently.
 */
export const PRINT_STYLES = {
  '@page': { margin: '16mm' },
  '@media print': {
    'header, nav, .MuiFab-root, .MuiSnackbar-root, [data-print-hide]': {
      display: 'none !important',
    },
    'html, body': { background: '#fff !important', colorScheme: 'light' },
    // Whatever the screen scheme is, the paper is white and the ink black (also with "background
    // graphics" on, which a dark page background would otherwise bring along).
    '#root, #root *': {
      background: 'transparent !important',
      color: '#000 !important',
      boxShadow: 'none !important',
    },
    'div:has(> main)': { maxWidth: 'none !important' },
    main: { padding: '0 !important' },
    '.vaccination-card table': { width: '100%', borderCollapse: 'collapse' },
    '.vaccination-card th, .vaccination-card td': {
      border: '1px solid #000',
      padding: '4px 6px',
      verticalAlign: 'top',
      fontSize: '10pt',
    },
    '.vaccination-card tr': { breakInside: 'avoid' },
    '.vaccination-card thead': { display: 'table-header-group' },
  },
} as const;

/** The card's rows: recorded vaccines by date given, oldest first. */
export function cardRows(records: readonly Vaccination[]): Vaccination[] {
  return [...records].sort(
    (a, b) => a.givenOn.localeCompare(b.givenOn) || a.createdAt.localeCompare(b.createdAt),
  );
}
