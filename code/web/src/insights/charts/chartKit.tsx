import { Box, Typography } from '@mui/material';
import { palette } from '../../ui/form/styles';
import { chartColor, visuallyHidden, type SeriesColor } from './chartStyle';

/* The legend and the table view of the Insights charts. */

export interface LegendItem {
  key: string;
  label: string;
  /** A series swatch; without it the item is the average's reference line. */
  color?: SeriesColor;
}

/**
 * Legend for two or more items: a swatch (or a short line for the average) beside each label;
 * the text stays in text colours.
 */
export function Legend({ items }: { items: readonly LegendItem[] }) {
  if (items.length < 2) return null;
  return (
    <Box
      component="ul"
      sx={{ m: 0, p: 0, listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: 2 }}
    >
      {items.map((item) => (
        <Box
          component="li"
          key={item.key}
          sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}
        >
          <Box
            aria-hidden
            sx={(theme) =>
              item.color
                ? {
                    width: 10,
                    height: 10,
                    borderRadius: '3px',
                    backgroundColor: chartColor(theme, item.color),
                    '@media (forced-colors: active)': { border: '1px solid CanvasText' },
                  }
                : {
                    width: 14,
                    height: '1.5px',
                    borderRadius: '1px',
                    backgroundColor: palette(theme).text.secondary,
                    '@media (forced-colors: active)': { backgroundColor: 'CanvasText' },
                  }
            }
          />
          <Typography variant="caption" color="text.secondary">
            {item.label}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

export interface TableColumn {
  key: string;
  label: string;
}

export interface TableRow {
  key: string;
  cells: string[];
}

/** The numbers of a chart as a plain table (the accessible twin of every chart). */
export function DataTable({
  caption,
  head,
  columns,
  rows,
}: {
  caption: string;
  head: string;
  columns: readonly TableColumn[];
  rows: readonly TableRow[];
}) {
  return (
    <Box
      component="table"
      sx={(theme) => ({
        width: '100%',
        borderCollapse: 'collapse',
        fontVariantNumeric: 'tabular-nums',
        '& th, & td': {
          py: 0.75,
          px: 0.5,
          textAlign: 'right',
          borderBottom: `1px solid ${palette(theme).hairline}`,
          fontSize: '0.875rem',
        },
        '& th:first-of-type, & td:first-of-type': { textAlign: 'left', pl: 0 },
        '& td:last-of-type, & th:last-of-type': { pr: 0 },
        '& thead th': {
          color: palette(theme).text.secondary,
          fontWeight: 600,
          fontSize: '0.75rem',
        },
      })}
    >
      <Box component="caption" sx={visuallyHidden}>
        {caption}
      </Box>
      <thead>
        <tr>
          <th scope="col">{head}</th>
          {columns.map((column) => (
            <th key={column.key} scope="col">
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <th scope="row" style={{ fontWeight: 400 }}>
              {row.cells[0]}
            </th>
            {row.cells.slice(1).map((cell, index) => (
              <td key={columns[index]?.key ?? index}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </Box>
  );
}
