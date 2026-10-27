import { Fragment, type ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Link } from '@mui/material';
import { ExternalLink } from '../credits/ExternalLink';
import { SOURCE_REPOSITORY } from '../credits/curatedCredits';
import { parseInline, type InlinePart, type SlotName, type UrlToken } from './inlineText';
import type { Inline } from './policyTypes';
import { isEmailAddress, ISSUES_URL, PRIVATE_REPORT_URL } from './privacyConfig';

/*
 * Inline policy text: plain text, links (in-app, anchors, outside) and the values filled in at render time
 * (`{controller}`, `{contact}`, `{dpo}`, `{version}`, `{lastUpdated}`). Shared by the privacy policy, the terms
 * of use and the consent screen, so a link or a contact is written once.
 */

const URLS: Readonly<Record<UrlToken, string>> = {
  issuesUrl: ISSUES_URL,
  advisoryUrl: PRIVATE_REPORT_URL,
  repoUrl: SOURCE_REPOSITORY,
};

export type Slots = Readonly<Record<SlotName, ReactNode>>;

function InlineLink({ part }: { part: Extract<InlinePart, { kind: 'link' }> }) {
  if (part.target === 'route') {
    return (
      <Link component={RouterLink} to={part.href}>
        {part.label}
      </Link>
    );
  }
  if (part.target === 'anchor' || part.href.startsWith('mailto:')) {
    return <Link href={part.href}>{part.label}</Link>;
  }
  return <ExternalLink href={part.href}>{part.label}</ExternalLink>;
}

/** Inline policy text: plain text, links (in-app, anchors, outside) and the filled-in values. */
export function Rich({ text, slots }: { text: Inline; slots: Slots }) {
  return (
    <>
      {parseInline(text, URLS).map((part, index) => (
        <Fragment key={index}>
          {part.kind === 'text' && part.text}
          {part.kind === 'link' && <InlineLink part={part} />}
          {part.kind === 'slot' && slots[part.name]}
        </Fragment>
      ))}
    </>
  );
}

export function MailOrText({ value }: { value: string }) {
  return isEmailAddress(value) ? <Link href={`mailto:${value}`}>{value}</Link> : <>{value}</>;
}
