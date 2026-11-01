import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Button,
  Chip,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import { canWrite } from '../baby/permissions';
import { useFormulaCommands, useFormulas } from '../db/hooks';
import { formulaTermsOf } from '../db/formulaCommands';
import type { Baby, Formula } from '../db/models';
import { activeFormulas, currentFormula } from '../formulas/formulaModel';
import { FormulaSheet } from '../formulas/FormulaSheet';
import { formatDate } from '../i18n/format';
import { Icon } from '../ui/Icon';
import { announceUndo } from '../ui/undoNotice';

type Editing = { formula: Formula } | 'new' | null;

/** "Aptamil · Stage 2 · Since 1 Oct 2026 · notes". */
function useDetailLine() {
  const { t } = useTranslation();
  return (formula: Formula) =>
    [
      formula.brand,
      formula.stage ? t('formulas.stageLine', { stage: formula.stage }) : null,
      formula.startedOn
        ? t('formulas.startedLine', { date: formatDate(formula.startedOn, 'dayMonthYear') })
        : null,
      formula.notes,
    ]
      .filter(Boolean)
      .join(' · ');
}

interface RowProps {
  formula: Formula;
  current: boolean;
  writable: boolean;
  onEdit: () => void;
  onSetCurrent: () => void;
  onArchive: () => void;
  onRestore: () => void;
}

function FormulaRow({
  formula,
  current,
  writable,
  onEdit,
  onSetCurrent,
  onArchive,
  onRestore,
}: RowProps) {
  const { t } = useTranslation();
  const detail = useDetailLine();
  const name = formula.name;
  const actions = formula.archived ? (
    <IconButton aria-label={t('formulas.restoreNamed', { name })} onClick={onRestore}>
      <Icon name="undo" />
    </IconButton>
  ) : (
    <Stack direction="row">
      {!current && (
        <IconButton aria-label={t('formulas.setCurrentNamed', { name })} onClick={onSetCurrent}>
          <Icon name="star" />
        </IconButton>
      )}
      <IconButton aria-label={t('formulas.editNamed', { name })} onClick={onEdit}>
        <Icon name="edit" />
      </IconButton>
      <IconButton aria-label={t('formulas.archiveNamed', { name })} onClick={onArchive}>
        <Icon name="archive" />
      </IconButton>
    </Stack>
  );
  const width = formula.archived ? 7 : current ? 13 : 19;
  return (
    <ListItem divider secondaryAction={writable && actions} sx={{ pr: writable ? width : 2 }}>
      <ListItemText
        primary={
          <Box
            component="span"
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}
          >
            <span>{name}</span>
            {current && (
              <Chip
                size="small"
                color="primary"
                variant="outlined"
                icon={<Icon name="star" size={16} />}
                label={t('formulas.currentBadge')}
              />
            )}
          </Box>
        }
        secondary={detail(formula) || null}
      />
    </ListItem>
  );
}

/**
 * The baby's formulas (Settings > Formulas): the list with the current one marked, add, edit,
 * "set as current" and archive (restorable; bottles keep naming an archived formula). Read-only for
 * Caregivers and Viewers. Works offline: changes go through the local store and the outbox.
 */
export function FormulasSection({ baby }: { baby: Baby }) {
  const { t } = useTranslation();
  const formulas = useFormulas(baby.id);
  const commands = useFormulaCommands();
  const writable = canWrite(baby);
  const [editing, setEditing] = useState<Editing>(null);
  if (!formulas) return null;
  const current = currentFormula(formulas);
  const active = activeFormulas(formulas);
  const archived = formulas.filter((f) => f.archived).sort((a, b) => a.name.localeCompare(b.name));

  const archive = async (formula: Formula) => {
    await commands.setArchived(formula.id, true);
    announceUndo(t('formulas.archivedNotice', { name: formula.name }), async () => {
      await commands.update(formula.id, formulaTermsOf(formula));
    });
  };

  const row = (formula: Formula) => (
    <FormulaRow
      key={formula.id}
      formula={formula}
      current={formula.id === current?.id}
      writable={writable}
      onEdit={() => setEditing({ formula })}
      onSetCurrent={() => void commands.setCurrent(formula.id)}
      onArchive={() => void archive(formula)}
      onRestore={() => void commands.setArchived(formula.id, false)}
    />
  );

  return (
    <Stack spacing={1.5}>
      {formulas.length === 0 && (
        <Typography color="text.secondary">{t('formulas.none')}</Typography>
      )}
      {active.length > 0 && (
        <List aria-label={t('formulas.list')} disablePadding>
          {active.map(row)}
        </List>
      )}
      {writable ? (
        <Button
          startIcon={<Icon name="add" />}
          variant="outlined"
          onClick={() => setEditing('new')}
          sx={{ minHeight: 48, alignSelf: 'flex-start' }}
        >
          {t('formulas.add')}
        </Button>
      ) : (
        <Typography color="text.secondary">{t('formulas.viewOnly')}</Typography>
      )}
      {archived.length > 0 && (
        <Stack spacing={0.5}>
          <Typography variant="subtitle2" component="h3" color="text.secondary">
            {t('formulas.archivedTitle')}
          </Typography>
          <List aria-label={t('formulas.archivedList')} disablePadding>
            {archived.map(row)}
          </List>
          <Typography variant="caption" color="text.secondary">
            {t('formulas.archivedNote')}
          </Typography>
        </Stack>
      )}
      {editing && (
        <FormulaSheet
          babyId={baby.id}
          formulas={formulas}
          {...(editing === 'new' ? {} : { formula: editing.formula })}
          onClose={() => setEditing(null)}
        />
      )}
    </Stack>
  );
}
