/*
 * Original illustrations of Lotties, by the project contributors, licensed under the project
 * licence (AGPL-3.0-or-later). See docs/design/ILLUSTRATIONS.md.
 *
 * Custom: a sparkle for anything the family adds itself.
 */
import { Body, IllustrationFrame, Shine, type IllustrationProps } from './IllustrationFrame';
import { capsule, circle, sparkle } from './geometry';

const BIG = sparkle(42, 52, 31, 0.17);
const SMALL = sparkle(73, 23, 12, 0.18);
const DOT = circle(75, 65, 4.5);

export function CustomIllustration(props: IllustrationProps) {
  return (
    <IllustrationFrame
      {...props}
      name="custom"
      main="spark"
      materials={{ spark: { hue: 'accent' }, small: { hue: 'diaper', night: 'light', lift: 0.3 } }}
      ground={{ x: 44, rx: 24 }}
    >
      {(kit) => (
        <>
          <Body kit={kit} m="spark" d={BIG} />
          <Body kit={kit} m="small" d={SMALL} />
          <Body kit={kit} m="small" d={DOT} />
          <Shine kit={kit} m="spark" d={capsule(36.5, 44, 39, 36, 3.5)} />
        </>
      )}
    </IllustrationFrame>
  );
}
