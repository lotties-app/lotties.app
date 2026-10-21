/*
 * Original illustrations of Lotties, by the project contributors, licensed under the project
 * licence (AGPL-3.0-or-later). See docs/design/ILLUSTRATIONS.md.
 *
 * Care and activity family: diaper, bath, tummy time.
 */
import { Body, IllustrationFrame, Shine, type IllustrationProps } from './IllustrationFrame';
import { capsule, circle, rect, star } from './geometry';

/* Diaper: a front view with curved leg openings, a cream waistband, golden tabs, a tiny heart. */
const DIAPER =
  'M14 30C14 27.2 16.2 25 19 25H77C79.8 25 82 27.2 82 30V42C74 44 66 51 64 64C63 72 59 78 52 78H44C37 78 33 72 32 64C30 51 22 44 14 42Z';
const WAISTBAND = rect(17, 28, 62, 9, 4.5);
const TAB_LEFT = rect(8, 31, 14, 11, 4.5);
const TAB_RIGHT = rect(74, 31, 14, 11, 4.5);
const PRINT =
  'M48 64C44 61 41 59 41 55.5C41 53.5 42.5 52 44.5 52C46 52 47.3 52.8 48 54C48.7 52.8 50 52 51.5 52C53.5 52 55 53.5 55 55.5C55 59 52 61 48 64Z';

export function DiaperIllustration(props: IllustrationProps) {
  return (
    <IllustrationFrame
      {...props}
      name="diaper"
      main="cloth"
      materials={{
        cloth: { hue: 'care' },
        band: { hue: 'cream', night: 'cream' },
        tab: { hue: 'diaper', night: 'light', lift: 0.3 },
        print: { hue: 'health', night: 'dim', lift: 0.3 },
      }}
      ground={{ x: 48, rx: 26 }}
    >
      {(kit) => (
        <>
          <Body kit={kit} m="tab" d={TAB_LEFT} />
          <Body kit={kit} m="tab" d={TAB_RIGHT} />
          <Body kit={kit} m="cloth" d={DIAPER} />
          <Body kit={kit} m="band" d={WAISTBAND} />
          <Body kit={kit} m="print" d={PRINT} />
          <Shine kit={kit} m="cloth" d={capsule(22, 44, 27, 51, 4.5)} />
        </>
      )}
    </IllustrationFrame>
  );
}

/* Bath: a round tub on two little feet, three bubbles floating over it. */
const TUB_RIM = capsule(12, 49, 84, 49, 9);
const TUB = 'M17 51H79V60C79 71 71 79 60 79H36C25 79 17 71 17 60Z';
const FEET = [circle(31, 80, 4.5), circle(65, 80, 4.5)];
const BUBBLES = [
  { x: 33, y: 33, r: 8.5 },
  { x: 51, y: 25, r: 11 },
  { x: 67, y: 36, r: 7 },
];

export function BathIllustration(props: IllustrationProps) {
  return (
    <IllustrationFrame
      {...props}
      name="bath"
      main="tub"
      materials={{
        tub: { hue: 'care' },
        foot: { hue: 'care', night: 'dim' },
        bubble: { hue: 'sleep', night: 'cream', lift: 0.45 },
      }}
      ground={{ x: 48, rx: 32 }}
    >
      {(kit) => (
        <>
          {BUBBLES.map((b) => (
            <g key={b.x}>
              <Body kit={kit} m="bubble" d={circle(b.x, b.y, b.r)} />
              <Shine
                kit={kit}
                m="bubble"
                d={circle(b.x - b.r * 0.38, b.y - b.r * 0.38, b.r * 0.26)}
              />
            </g>
          ))}
          {FEET.map((d) => (
            <Body key={d} kit={kit} m="foot" d={d} />
          ))}
          <Body kit={kit} m="tub" d={TUB} />
          <Body kit={kit} m="tub" d={TUB_RIM} />
          <Shine kit={kit} m="tub" d={capsule(24, 60, 28, 68, 4.5)} />
        </>
      )}
    </IllustrationFrame>
  );
}

/* Tummy time: a little smiling star on its tummy, chin up over a towel roll on a play mat. */
const MAT = rect(10, 71, 76, 11, 5.5);
const STAR = star(48, 42, 25, 12.5, 5, 0.32);
const ROLL = capsule(20, 63, 76, 63, 16);
const ROLL_STRIPES = [rect(33, 55, 5, 16, 2.5), rect(58, 55, 5, 16, 2.5)];

export function TummyTimeIllustration(props: IllustrationProps) {
  return (
    <IllustrationFrame
      {...props}
      name="tummy_time"
      main="star"
      materials={{
        star: { hue: 'activity' },
        roll: { hue: 'cream', night: 'cream' },
        mat: { hue: 'care', night: 'dim' },
      }}
      ground={{ x: 48, rx: 36 }}
    >
      {(kit) => {
        const face = kit.tones.star.deep;
        return (
          <>
            <Body kit={kit} m="mat" d={MAT} />
            <Body kit={kit} m="star" d={STAR} />
            <Body kit={kit} m="roll" d={ROLL} />
            {ROLL_STRIPES.map((d) => (
              <path key={d} d={d} fill={kit.tones.mat.mid} opacity="0.7" />
            ))}
            <path d={circle(43, 42, 2.5)} fill={face} />
            <path d={circle(53, 42, 2.5)} fill={face} />
            <path
              d="M44 48Q48 51.5 52 48"
              fill="none"
              stroke={face}
              strokeWidth="2.6"
              strokeLinecap="round"
            />
            <Shine kit={kit} m="star" d={capsule(44.5, 28, 46, 23.5, 3.5)} />
          </>
        );
      }}
    </IllustrationFrame>
  );
}
