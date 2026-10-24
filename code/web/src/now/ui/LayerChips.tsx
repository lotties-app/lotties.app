import { useTranslation } from 'react-i18next';
import { Box } from '@mui/material';
import { RADIUS } from '../../theme/tokens';
import { optionBase, palette, selectedOption } from '../../ui/form/styles';
import { RING_LAYERS, type RingLayer } from '../upcoming';

/**
 * The compact row of layer chips under the chart ("Sleep · Feeds · Diapers · Patterns ·
 * Medicine"): multi-select pressed-state buttons in a labelled group, wrapping on a narrow screen,
 * each 44 px high. What a chip turns off leaves the chart, the legend and the "Next up" list.
 */
export function LayerChips({
  layers,
  onToggle,
}: {
  layers: readonly RingLayer[];
  onToggle: (layer: RingLayer) => void;
}) {
  const { t } = useTranslation();
  return (
    <Box
      role="group"
      aria-label={t('now.upcoming.layersLabel')}
      data-testid="ring-layers"
      sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 0.75 }}
    >
      {RING_LAYERS.map((layer) => {
        const on = layers.includes(layer);
        return (
          <Box
            key={layer}
            component="button"
            type="button"
            aria-pressed={on}
            aria-label={t('now.upcoming.layerName', { layer: t(`now.upcoming.layer.${layer}`) })}
            data-testid={`ring-layer-${layer}`}
            onClick={() => onToggle(layer)}
            sx={(theme) => ({
              ...optionBase(theme),
              minHeight: 44,
              px: 1.5,
              borderRadius: `${RADIUS.pill}px`,
              backgroundColor: palette(theme).background.paper,
              border: `1px solid ${palette(theme).hairline}`,
              fontSize: '0.8125rem',
              ...(on && selectedOption(theme)),
            })}
          >
            {t(`now.upcoming.layer.${layer}`)}
          </Box>
        );
      })}
    </Box>
  );
}
