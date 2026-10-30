import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import {
  Box,
  GlobalStyles,
  Link,
  Paper,
  Stack,
  Typography,
  type SxProps,
  type Theme,
} from '@mui/material';
import { formatDate } from '../i18n/format';
import { useLocale } from '../i18n/useLocale';
import { RADIUS } from '../theme/tokens';
import { policyFor } from './policyDocuments';
import { Rich, type Slots } from './RichText';
import { slotsFor } from './richSlots';
import type { Block, Table } from './policyTypes';
import {
  PRIVACY_POLICY_LAST_UPDATED,
  PRIVACY_POLICY_VERSION,
  sectionAnchor,
} from './privacyPolicy';

/** Headings leave room for the app's sticky header when an anchor scrolls to them. */
const HEADING_SCROLL_MARGIN = '88px';

const tableSx: SxProps<Theme> = (theme) => ({
  '& table': { width: '100%', borderCollapse: 'collapse' },
  '& caption': { textAlign: 'left', fontWeight: 600, pb: 1, color: 'text.primary' },
  '& th, & td': {
    textAlign: 'left',
    verticalAlign: 'top',
    p: 1.25,
    borderBottom: 1,
    borderColor: 'divider',
    overflowWrap: 'anywhere',
  },
  '& thead th': { color: 'text.secondary', fontWeight: 600 },
  '& tbody th': { fontWeight: 600, width: '24%' },
  '& .cell-label': { display: 'none' },
  // Phones: one block per row, the column name above each value (the roles keep the table semantics).
  [theme.breakpoints.down('sm')]: {
    '& thead': {
      position: 'absolute',
      width: '1px',
      height: '1px',
      overflow: 'hidden',
      clip: 'rect(0 0 0 0)',
    },
    '& tbody tr': { display: 'block', py: 1, borderBottom: 1, borderColor: 'divider' },
    '& tbody th, & tbody td': { display: 'block', border: 0, px: 0, py: 0.5, width: 'auto' },
    '& .cell-label': {
      display: 'block',
      color: 'text.secondary',
      fontSize: '0.8125rem',
      fontWeight: 600,
    },
  },
  '@media print': {
    '& thead': { position: 'static', width: 'auto', height: 'auto', clip: 'auto' },
    '& tbody tr': { display: 'table-row', breakInside: 'avoid' },
    '& th, & td': { display: 'table-cell', border: '1px solid #999', p: '4px 6px' },
    '& .cell-label': { display: 'none' },
  },
});

/**
 * A table that stays a table for assistive technology (explicit roles, row and column headers) and,
 * on narrow screens, shows each row as a block with the column name above each value. Printing
 * always shows a plain table.
 */
function PolicyTable({ table, slots }: { table: Table; slots: Slots }) {
  const valueColumns = table.columns.slice(1);
  return (
    <Box sx={tableSx} data-table={table.id}>
      <Typography component="table" variant="body2" role="table">
        <caption>
          <Rich text={table.caption} slots={slots} />
        </caption>
        <thead role="rowgroup">
          <tr role="row">
            {table.columns.map((column) => (
              <th key={column} role="columnheader" scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup">
          {table.rows.map((row) => {
            const [header, ...values] = row.cells;
            return (
              <tr key={row.id} role="row" data-row={row.id}>
                <th role="rowheader" scope="row">
                  <Rich text={header} slots={slots} />
                </th>
                {values.map((value, index) => (
                  <td key={index} role="cell">
                    <span className="cell-label" aria-hidden="true">
                      {valueColumns[index]}
                    </span>
                    <Rich text={value} slots={slots} />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </Typography>
    </Box>
  );
}

function PolicyBlock({ block, slots }: { block: Block; slots: Slots }) {
  switch (block.kind) {
    case 'p':
      return (
        <Typography>
          <Rich text={block.text} slots={slots} />
        </Typography>
      );
    case 'note':
      return (
        <Paper variant="outlined" sx={{ p: 2, borderRadius: `${RADIUS.tile}px` }}>
          <Typography>
            <Rich text={block.text} slots={slots} />
          </Typography>
        </Paper>
      );
    case 'list':
      return (
        <Box component="ul" sx={{ m: 0, pl: 3, '& li + li': { mt: 1 } }}>
          {block.items.map((item, index) => (
            <Typography component="li" key={index}>
              <Rich text={item} slots={slots} />
            </Typography>
          ))}
        </Box>
      );
    case 'table':
      return <PolicyTable table={block} slots={slots} />;
  }
}

function Blocks({ blocks, slots }: { blocks: readonly Block[]; slots: Slots }) {
  return (
    <Stack spacing={1.5}>
      {blocks.map((block, index) => (
        <PolicyBlock key={index} block={block} slots={slots} />
      ))}
    </Stack>
  );
}

/** The print layout: only the policy, black on white, and the address of every outside link. */
const printStyles = (
  <GlobalStyles
    styles={{
      '@media print': {
        'body header, body nav:not([data-privacy-toc])': { display: 'none !important' },
        body: { background: '#fff !important' },
        '[data-privacy-policy], [data-privacy-policy] *': {
          color: '#000 !important',
          background: 'transparent !important',
          boxShadow: 'none !important',
        },
        '[data-privacy-policy] a[href^="https:"]::after': {
          content: '" (" attr(href) ")"',
          fontSize: '0.85em',
        },
        '[data-privacy-policy] h2, [data-privacy-policy] h3': { breakAfter: 'avoid' },
      },
    }}
  />
);

/**
 * The privacy policy, without a page title (the page around it supplies the h1): the version line,
 * the summary box, the contents and every section, in the app's language. Shared by the public
 * /privacy page, Hub > Privacy policy and the doctor's shell. The text is in privacy.<lang>.ts.
 */
export function PrivacyContent() {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const { hash } = useLocation();
  const policy = policyFor(locale);
  const slots = slotsFor(policy);
  const date = formatDate(PRIVACY_POLICY_LAST_UPDATED, 'dayMonthYear', policy.locale);

  useEffect(() => {
    const target = hash.slice(1);
    if (target) document.getElementById(target)?.scrollIntoView?.({ block: 'start' });
  }, [hash, locale]);

  return (
    <Stack spacing={4} lang={policy.locale} data-privacy-policy="">
      {printStyles}
      <Typography color="text.secondary">
        {t('legal.privacy.version', { version: PRIVACY_POLICY_VERSION, date })}
      </Typography>

      <Paper
        component="section"
        aria-labelledby="privacy-summary"
        variant="outlined"
        sx={{ p: 2.5, borderRadius: `${RADIUS.card}px`, breakInside: 'avoid' }}
      >
        <Typography variant="h6" component="h2" id="privacy-summary" sx={{ mb: 1.5 }}>
          {policy.summary.title}
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gap: 2,
            gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(3, minmax(0, 1fr))' },
          }}
        >
          {policy.summary.groups.map((group) => (
            <Box key={group.title} sx={{ minWidth: 0 }}>
              <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600, mb: 0.5 }}>
                {group.title}
              </Typography>
              <Box component="ul" sx={{ m: 0, pl: 2.5, '& li + li': { mt: 0.75 } }}>
                {group.items.map((item, index) => (
                  <Typography component="li" variant="body2" key={index}>
                    <Rich text={item} slots={slots} />
                  </Typography>
                ))}
              </Box>
            </Box>
          ))}
        </Box>
      </Paper>

      <Box component="nav" aria-labelledby="privacy-contents" data-privacy-toc="">
        <Typography variant="h6" component="h2" id="privacy-contents" sx={{ mb: 1 }}>
          {t('legal.privacy.contents')}
        </Typography>
        <Box component="ol" sx={{ m: 0, pl: 3 }}>
          {policy.sections.map((section) => (
            <li key={section.id}>
              <Link
                href={`#${sectionAnchor(section.id)}`}
                sx={{ display: 'inline-block', py: 0.75 }}
              >
                {section.title}
              </Link>
            </li>
          ))}
        </Box>
      </Box>

      {policy.sections.map((section) => {
        const anchor = sectionAnchor(section.id);
        return (
          <Box
            component="section"
            key={section.id}
            aria-labelledby={anchor}
            data-section={section.id}
          >
            <Typography
              variant="h6"
              component="h2"
              id={anchor}
              sx={{ mb: 1.5, scrollMarginTop: HEADING_SCROLL_MARGIN }}
            >
              {section.title}
            </Typography>
            <Stack spacing={2.5}>
              {section.blocks.length > 0 && <Blocks blocks={section.blocks} slots={slots} />}
              {section.subsections?.map((subsection) => {
                const subAnchor = `${anchor}-${subsection.id}`;
                return (
                  <Box component="section" key={subsection.id} aria-labelledby={subAnchor}>
                    <Typography
                      variant="subtitle1"
                      component="h3"
                      id={subAnchor}
                      sx={{ fontWeight: 600, mb: 1, scrollMarginTop: HEADING_SCROLL_MARGIN }}
                    >
                      {subsection.title}
                    </Typography>
                    <Blocks blocks={subsection.blocks} slots={slots} />
                  </Box>
                );
              })}
            </Stack>
          </Box>
        );
      })}
    </Stack>
  );
}
