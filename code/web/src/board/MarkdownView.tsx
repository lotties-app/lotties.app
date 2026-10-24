import { Fragment, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Box } from '@mui/material';
import { visuallyHidden } from '../insights/charts/chartStyle';
import { RADIUS } from '../theme/tokens';
import { palette } from '../ui/form/styles';
import { parseMarkdown, type MdBlock, type MdInline } from './markdown';

/** Headings of a body sit under the drawer's title (an h2): `#` is an h3. */
const HEADING_TAGS = ['h3', 'h4', 'h5', 'h6', 'h6', 'h6'] as const;

function Inlines({ nodes }: { nodes: readonly MdInline[] }) {
  const { t } = useTranslation();
  return (
    <>
      {nodes.map((node, index): ReactNode => {
        switch (node.kind) {
          case 'text':
            return <Fragment key={index}>{node.text}</Fragment>;
          case 'break':
            return <br key={index} />;
          case 'code':
            return (
              <Box component="code" key={index} className="md-code">
                {node.text}
              </Box>
            );
          case 'strong':
            return (
              <strong key={index}>
                <Inlines nodes={node.children} />
              </strong>
            );
          case 'em':
            return (
              <em key={index}>
                <Inlines nodes={node.children} />
              </em>
            );
          case 'link':
            return (
              <a key={index} href={node.href} target="_blank" rel="noopener noreferrer nofollow">
                <Inlines nodes={node.children} />
                <Box component="span" sx={visuallyHidden}>
                  {` ${t('board.markdown.newWindow')}`}
                </Box>
              </a>
            );
        }
        return null;
      })}
    </>
  );
}

function Block({ block }: { block: MdBlock }) {
  switch (block.kind) {
    case 'heading':
      return (
        <Box component={HEADING_TAGS[block.level - 1]} className={`md-h md-h${block.level}`}>
          <Inlines nodes={block.children} />
        </Box>
      );
    case 'paragraph':
      return (
        <p>
          <Inlines nodes={block.children} />
        </p>
      );
    case 'quote':
      return (
        <blockquote>
          <Inlines nodes={block.children} />
        </blockquote>
      );
    case 'code':
      return (
        <pre>
          <code>{block.text}</code>
        </pre>
      );
    case 'rule':
      return <hr />;
    case 'list': {
      const items = block.items.map((item, index) => (
        <li key={index}>
          <Inlines nodes={item} />
        </li>
      ));
      return block.ordered ? (
        <ol start={block.start === 1 ? undefined : block.start}>{items}</ol>
      ) : (
        <ul>{items}</ul>
      );
    }
  }
}

/**
 * A board item's Markdown body as React elements (never `dangerouslySetInnerHTML`): the safe
 * subset of `markdown.ts`. Links open in a new tab with `noopener noreferrer nofollow`.
 */
export function MarkdownView({ source }: { source: string }) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  return (
    <Box
      data-testid="board-markdown"
      sx={(theme) => ({
        overflowWrap: 'anywhere',
        '& > :first-of-type': { mt: 0 },
        '& > :last-child': { mb: 0 },
        '& p, & ul, & ol, & blockquote, & pre': { my: 1 },
        '& ul, & ol': { pl: 3 },
        '& .md-h': { mt: 2, mb: 1, fontWeight: 600, lineHeight: 1.3 },
        '& .md-h1': { fontSize: '1.125rem' },
        '& .md-h2': { fontSize: '1.0625rem' },
        '& .md-h3, & .md-h4, & .md-h5, & .md-h6': { fontSize: '1rem' },
        '& blockquote': {
          mx: 0,
          pl: 1.5,
          borderInlineStart: `3px solid ${palette(theme).hairline}`,
          color: palette(theme).text.secondary,
        },
        '& pre': {
          p: 1.5,
          overflowX: 'auto',
          borderRadius: `${RADIUS.input}px`,
          backgroundColor: palette(theme).surfaceRaised,
          fontSize: '0.8125rem',
          whiteSpace: 'pre',
        },
        '& .md-code, & pre code': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
        '& .md-code': {
          px: 0.5,
          borderRadius: '6px',
          backgroundColor: palette(theme).surfaceRaised,
          fontSize: '0.875em',
        },
        '& a': { color: palette(theme).info.main },
        '& hr': { border: 0, borderTop: `1px solid ${palette(theme).hairline}`, my: 2 },
      })}
    >
      {blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </Box>
  );
}
