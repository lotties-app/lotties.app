import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Link, Typography } from '@mui/material';
import { useApiClient } from '../api/ApiClientContext';
import { describeApiError } from '../api/errorMessages';
import { useOnline } from '../sync/useOnline';
import { Icon } from '../ui/Icon';
import { Field, TextInput } from '../ui/form';
import { optionBase, palette } from '../ui/form/styles';
import {
  SEARCH_MAX_LENGTH,
  candidateOfCep,
  candidateOfPlace,
  composeAddress,
  lookupCep,
  lookupText,
  searchPlaces,
  type AddressCandidate,
} from './addressLookup';

const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright';

type Status =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'empty' }
  | { kind: 'results'; candidates: AddressCandidate[] }
  | { kind: 'filled' };

interface Props {
  /** The address text the sheet holds now. */
  address: string;
  /** Replaces the address text (a candidate was picked, or the number / complement changed). */
  onAddress: (address: string) => void;
}

/**
 * "Find the address" above the provider's address (docs/design/23-address-lookup.md). The parent
 * types a Brazilian CEP or a street / place name and presses the button (or Enter): one request
 * through our API, never as you type. A CEP answers one address, filled in at once when the address
 * is empty (else offered to pick); a search lists up to five places to pick. The parent then adds
 * the number and complement, and the address text stays an ordinary editable field: offline or when
 * the lookup fails, a message says so and nothing else changes.
 */
export function AddressFinder({ address, onAddress }: Props) {
  const { t, i18n } = useTranslation();
  const api = useApiClient();
  const online = useOnline();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [fromSearch, setFromSearch] = useState(false);
  const [applied, setApplied] = useState<{ candidate: AddressCandidate; text: string } | null>(
    null,
  );
  const [number, setNumber] = useState('');
  const [complement, setComplement] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  const apply = (candidate: AddressCandidate, nextNumber: string, nextComplement: string) => {
    const text = composeAddress(candidate, { number: nextNumber, complement: nextComplement });
    onAddress(text);
    setApplied({ candidate, text });
  };

  const pick = (candidate: AddressCandidate) => {
    const nextNumber = number || candidate.houseNumber || '';
    setNumber(nextNumber);
    apply(candidate, nextNumber, complement);
    setStatus({ kind: 'filled' });
  };

  const changeExtras = (nextNumber: string, nextComplement: string) => {
    setNumber(nextNumber);
    setComplement(nextComplement);
    // Only while the address still is what the lookup composed: never over the parent's own edits.
    if (applied && (address === applied.text || address.trim() === '')) {
      apply(applied.candidate, nextNumber, nextComplement);
    }
  };

  const find = async () => {
    if (!online || status.kind === 'loading') return;
    const lookup = lookupText(query);
    if (lookup.kind === 'short') {
      setStatus({ kind: 'error', message: t('providers.address.tooShort') });
      return;
    }
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setStatus({ kind: 'loading' });
    try {
      const searching = lookup.kind === 'search';
      const candidates = searching
        ? (await searchPlaces(api, lookup.text, i18n.language, current.signal)).map(
            candidateOfPlace,
          )
        : [candidateOfCep(await lookupCep(api, lookup.text, current.signal))];
      if (current.signal.aborted) return;
      setFromSearch(searching);
      if (candidates.length === 0) setStatus({ kind: 'empty' });
      else if (!searching && address.trim() === '') pick(candidates[0]);
      else setStatus({ kind: 'results', candidates });
    } catch (error) {
      if (current.signal.aborted) return;
      setStatus({ kind: 'error', message: describeApiError(error) });
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    // Enter in this box looks the address up; it must not save the whole provider.
    event.preventDefault();
    void find();
  };

  const loading = status.kind === 'loading';
  return (
    <Box sx={{ display: 'grid', gap: 1.25 }}>
      <Field
        label={t('providers.address.label')}
        optional
        icon="search"
        help={t('providers.address.help')}
      >
        <Box onKeyDown={onKeyDown}>
          <TextInput
            value={query}
            onChange={setQuery}
            maxLength={SEARCH_MAX_LENGTH}
            placeholder={t('providers.address.placeholder')}
          />
        </Box>
      </Field>
      <Button
        variant="outlined"
        onClick={() => void find()}
        disabled={!online || loading}
        startIcon={<Icon name="map-pin" size={20} />}
        sx={{ minHeight: 48, alignSelf: 'flex-start' }}
      >
        {loading ? t('providers.address.finding') : t('providers.address.find')}
      </Button>
      <Box aria-live="polite" sx={{ display: 'grid', gap: 1 }}>
        {!online && (
          <Typography variant="body2" color="text.secondary" role="status">
            {t('providers.address.offline')}
          </Typography>
        )}
        {status.kind === 'error' && (
          <Typography variant="body2" role="alert" sx={{ color: 'error.main' }}>
            {status.message} {t('providers.address.manual')}
          </Typography>
        )}
        {status.kind === 'empty' && (
          <Typography variant="body2" color="text.secondary" role="status">
            {t('providers.address.empty')} {t('providers.address.manual')}
          </Typography>
        )}
        {status.kind === 'filled' && (
          <Typography variant="body2" color="text.secondary" role="status">
            {t('providers.address.filled')}
          </Typography>
        )}
        {status.kind === 'results' && (
          <Box
            component="ul"
            aria-label={t('providers.address.results')}
            sx={{ m: 0, p: 0, listStyle: 'none', display: 'grid', gap: 0.75 }}
          >
            {status.candidates.map((candidate) => (
              <li key={candidate.key}>
                <Box
                  component="button"
                  type="button"
                  onClick={() => pick(candidate)}
                  sx={(theme) => ({
                    ...optionBase(theme),
                    display: 'block',
                    width: '100%',
                    minHeight: 48,
                    px: 1.75,
                    py: 1,
                    borderRadius: 2,
                    textAlign: 'start',
                    overflowWrap: 'anywhere',
                    backgroundColor: palette(theme).surfaceRaised,
                    color: palette(theme).text.primary,
                  })}
                >
                  {candidate.name && (
                    <Box component="span" sx={{ display: 'block', fontWeight: 600 }}>
                      {candidate.name}
                    </Box>
                  )}
                  {oneLine(candidate)}
                </Box>
              </li>
            ))}
          </Box>
        )}
        {fromSearch && (status.kind === 'results' || status.kind === 'filled') && (
          <Typography variant="caption" color="text.secondary">
            <Link
              href={OSM_COPYRIGHT_URL}
              target="_blank"
              rel="noopener noreferrer"
              color="inherit"
              underline="always"
            >
              {t('providers.address.attribution')}
            </Link>
          </Typography>
        )}
      </Box>
      {applied && (
        <Box
          sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 2fr)', gap: 1.5 }}
        >
          <Field label={t('providers.address.number')} optional>
            <TextInput
              value={number}
              onChange={(value) => changeExtras(value, complement)}
              maxLength={20}
            />
          </Field>
          <Field label={t('providers.address.complement')} optional>
            <TextInput
              value={complement}
              onChange={(value) => changeExtras(number, value)}
              maxLength={60}
              placeholder={t('providers.address.complementPlaceholder')}
            />
          </Field>
        </Box>
      )}
    </Box>
  );
}

/** A candidate on one line for the list (its pieces, or the service's own text). */
function oneLine(candidate: AddressCandidate): string {
  const composed = composeAddress(candidate, {
    number: candidate.houseNumber ?? '',
    complement: '',
  }).replace(/\n/g, ', ');
  return composed || candidate.fallback || '';
}
