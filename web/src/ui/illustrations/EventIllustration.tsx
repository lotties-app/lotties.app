/*
 * Original illustrations of Baby Routine, by the project contributors, licensed under the project
 * licence (AGPL-3.0-or-later). See docs/design/ILLUSTRATIONS.md.
 */
import type { EventPayload, EventType } from '../../db/models';
import { illustrationKeyFor } from './eventKey';
import { typeCategory, typeIcon } from '../../now/typeVisual';
import { Illustration } from './Illustration';
import type { IllustrationProps } from './IllustrationFrame';

interface Props extends IllustrationProps {
  type: EventType | undefined;
  payload?: EventPayload;
}

/** The illustration of an event or type, falling back to the outline icon of a custom type. */
export function EventIllustration({ type, payload, ...props }: Props) {
  return (
    <Illustration
      name={illustrationKeyFor(type, payload)}
      fallbackIcon={typeIcon(type)}
      fallbackCategory={typeCategory(type)}
      {...props}
    />
  );
}
