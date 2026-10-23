import { Box, useTheme } from '@mui/material';
import type { Hint, HintDevice, HintGlyph, HintSpot } from './guides';

/*
 * A simple drawing of a phone, tablet or computer window with the button to tap circled and an
 * arrow pointing at it. Our own shapes (no screenshot of a browser, no vendor artwork), colours
 * from the theme tokens, decorative: the numbered steps next to it carry the meaning.
 */

const FRAMES: Record<HintDevice, { w: number; h: number }> = {
  phone: { w: 120, h: 200 },
  tablet: { w: 200, h: 150 },
  desktop: { w: 240, h: 150 },
};

function spotPoint(device: HintDevice, spot: HintSpot): { x: number; y: number } {
  const { w } = FRAMES[device];
  if (device === 'phone') {
    if (spot === 'bottom') return { x: w / 2, y: 176 };
    if (spot === 'bottom-right') return { x: 92, y: 176 };
    return { x: 92, y: 25 };
  }
  if (spot === 'top-left') return { x: 30, y: 21 };
  return { x: w - 26, y: device === 'tablet' ? 23 : 21 };
}

function Glyph({ glyph, x, y, color }: { glyph: HintGlyph; x: number; y: number; color: string }) {
  const stroke = { stroke: color, strokeWidth: 1.6, fill: 'none', strokeLinecap: 'round' } as const;
  switch (glyph) {
    case 'share':
      return (
        <g style={stroke}>
          <path d={`M${x - 4} ${y - 1} h-1.5 v7 h11 v-7 h-1.5`} />
          <path d={`M${x} ${y + 2} v-8 M${x - 3} ${y - 3} l3 -3 l3 3`} />
        </g>
      );
    case 'dots':
      return (
        <g style={{ fill: color }}>
          <circle cx={x} cy={y - 4.5} r={1.5} />
          <circle cx={x} cy={y} r={1.5} />
          <circle cx={x} cy={y + 4.5} r={1.5} />
        </g>
      );
    case 'lines':
      return (
        <g style={stroke}>
          <path d={`M${x - 5} ${y - 4} h10 M${x - 5} ${y} h10 M${x - 5} ${y + 4} h10`} />
        </g>
      );
    case 'install':
      return (
        <g style={stroke}>
          <rect x={x - 6} y={y - 5} width={12} height={9} rx={1.5} />
          <path d={`M${x} ${y - 3} v5 M${x - 2.5} ${y} l2.5 2.5 l2.5 -2.5`} />
        </g>
      );
    case 'menu-bar':
      return (
        <g style={stroke}>
          <path d={`M${x - 7} ${y - 2} h14 M${x - 7} ${y + 2} h9`} />
        </g>
      );
  }
}

export function DeviceHint({ hint }: { hint: Hint }) {
  const theme = useTheme();
  const palette = (theme.vars ?? theme).palette;
  const primary = palette.primary.main;
  const line = palette.text.secondary;
  const faint = palette.divider;
  const paper = palette.background.paper;
  const { w, h } = FRAMES[hint.device];
  const target = spotPoint(hint.device, hint.spot);
  const isPhone = hint.device === 'phone';
  const start = { x: w / 2, y: isPhone ? 110 : h / 2 + 20 };
  const bend = { x: (start.x + target.x) / 2 - 18, y: (start.y + target.y) / 2 };
  // Stop the arrow just short of the circle around the button.
  const dx = target.x - bend.x;
  const dy = target.y - bend.y;
  const length = Math.hypot(dx, dy) || 1;
  const end = { x: target.x - (dx / length) * 15, y: target.y - (dy / length) * 15 };
  const angle = (Math.atan2(end.y - bend.y, end.x - bend.x) * 180) / Math.PI;

  return (
    <Box
      component="svg"
      viewBox={`0 0 ${w} ${h}`}
      aria-hidden="true"
      focusable="false"
      sx={{ display: 'block', width: '100%', maxWidth: isPhone ? 140 : 260, height: 'auto' }}
    >
      {/* The device. */}
      {hint.device === 'phone' && (
        <>
          <rect
            x={8}
            y={3}
            width={104}
            height={194}
            rx={18}
            style={{ fill: paper, stroke: line, strokeWidth: 2 }}
          />
          <rect x={18} y={15} width={84} height={20} rx={6} style={{ fill: faint }} />
          <rect x={18} y={164} width={84} height={24} rx={6} style={{ fill: faint }} />
        </>
      )}
      {hint.device === 'tablet' && (
        <>
          <rect
            x={4}
            y={4}
            width={192}
            height={142}
            rx={14}
            style={{ fill: paper, stroke: line, strokeWidth: 2 }}
          />
          <rect x={14} y={13} width={172} height={20} rx={6} style={{ fill: faint }} />
        </>
      )}
      {hint.device === 'desktop' && (
        <>
          <rect
            x={4}
            y={4}
            width={232}
            height={142}
            rx={8}
            style={{ fill: paper, stroke: line, strokeWidth: 2 }}
          />
          <rect x={10} y={11} width={220} height={20} rx={5} style={{ fill: faint }} />
        </>
      )}
      {/* Page content placeholders. */}
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x={isPhone ? 22 : 24}
          y={(isPhone ? 50 : 46) + i * 16}
          width={(isPhone ? 76 : w - 60) - i * 14}
          height={8}
          rx={4}
          style={{ fill: faint }}
        />
      ))}
      {/* The arrow and the circled button. */}
      <path
        d={`M${start.x} ${start.y} Q${bend.x} ${bend.y} ${end.x} ${end.y}`}
        style={{ fill: 'none', stroke: primary, strokeWidth: 2.5, strokeLinecap: 'round' }}
      />
      <path
        d="M0 0 L-8 -4.5 L-8 4.5 Z"
        transform={`translate(${end.x} ${end.y}) rotate(${angle})`}
        style={{ fill: primary }}
      />
      <circle
        cx={target.x}
        cy={target.y}
        r={11}
        style={{ fill: paper, stroke: primary, strokeWidth: 2.5 }}
      />
      <Glyph glyph={hint.glyph} x={target.x} y={target.y} color={primary} />
    </Box>
  );
}
