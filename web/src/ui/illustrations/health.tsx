/*
 * Original illustrations of Lotties, by the project contributors, licensed under the project
 * licence (AGPL-3.0-or-later). See docs/design/ILLUSTRATIONS.md.
 *
 * Health family: medication, temperature, belly pain.
 */
import { Body, IllustrationFrame, Shine, type IllustrationProps } from './IllustrationFrame';
import { capsule, circle, rect } from './geometry';

/* Medication: a medicine bottle with a cross on its label and a two-tone capsule in front. */
const CAP = rect(24, 15, 30, 12, 4);
const NECK = rect(27, 25, 24, 7, 2);
const BOTTLE = rect(21, 30, 36, 51, 10);
const LABEL = rect(26, 44, 26, 24, 5);
const CROSS = [rect(36.5, 48.5, 5, 15, 2), rect(31.5, 53.5, 15, 5, 2)];
const PILL_A = 'M57 59.5H67V74.5H57A7.5 7.5 0 0 1 57 59.5Z';
const PILL_B = 'M67 59.5H77A7.5 7.5 0 0 1 77 74.5H67Z';

export function MedicationIllustration(props: IllustrationProps) {
  return (
    <IllustrationFrame
      {...props}
      name="medication"
      main="bottle"
      materials={{
        bottle: { hue: 'health' },
        cap: { hue: 'cream', night: 'cream' },
        pillA: { hue: 'diaper', night: 'light', lift: 0.3 },
        pillB: { hue: 'cream', night: 'cream' },
      }}
      ground={{ x: 50, rx: 30 }}
    >
      {(kit) => (
        <>
          <Body kit={kit} m="bottle" d={NECK} />
          <Body kit={kit} m="cap" d={CAP} />
          <Body kit={kit} m="bottle" d={BOTTLE} />
          <Body kit={kit} m="cap" d={LABEL} />
          {CROSS.map((d) => (
            <path key={d} d={d} fill={kit.tones.bottle.mid} />
          ))}
          <Shine kit={kit} m="bottle" d={capsule(26, 37, 26, 41, 4)} />
          <g transform="rotate(-38 67 67)">
            <Body kit={kit} m="pillA" d={PILL_A} />
            <Body kit={kit} m="pillB" d={PILL_B} />
            <Shine kit={kit} m="pillA" d={capsule(57, 63, 64, 63, 3)} />
          </g>
        </>
      )}
    </IllustrationFrame>
  );
}

/* Temperature: a classic thermometer, tilted: a pale glass tube, a warm bulb and column. */
const TUBE = capsule(48, 17, 48, 66, 16);
const BULB = circle(48, 71, 12.5);
const COLUMN = rect(45, 36, 6, 34, 3);

export function TemperatureIllustration(props: IllustrationProps) {
  return (
    <IllustrationFrame
      {...props}
      name="temperature"
      main="bulb"
      materials={{
        tube: { hue: 'sleep', night: 'cream', lift: 0.6 },
        bulb: { hue: 'health' },
      }}
      ground={{ x: 46, rx: 26 }}
    >
      {(kit) => (
        <g transform="rotate(38 48 48)">
          <Body kit={kit} m="tube" d={TUBE} />
          <Body kit={kit} m="bulb" d={COLUMN} />
          <Body kit={kit} m="bulb" d={BULB} />
          {[28, 36, 44].map((y) => (
            <path key={y} d={capsule(53, y, 55.5, y, 2.4)} fill={kit.tones.tube.lo} />
          ))}
          <Shine kit={kit} m="tube" d={capsule(43.5, 22, 43.5, 30, 3.5)} />
          <Shine kit={kit} m="bulb" d={capsule(41.5, 68, 43.5, 64.5, 3.5)} />
        </g>
      )}
    </IllustrationFrame>
  );
}

/*
 * Belly pain: a little bodysuit with a swirl of discomfort on its tummy and a small plaster on
 * the sleeve-side of the tummy.
 */
const BODYSUIT =
  'M38 17C40 22 44 24.5 48 24.5C52 24.5 56 22 58 17L69 20C73.5 21.2 77 23.8 79.5 27.5L86.5 38.5C87.6 40.3 86.9 42.3 85 43.1L75.5 47.2C74.4 47.7 73 47 73 45.8V66C73 72.5 66 76.5 59 78V81C59 83 57.5 84.5 55.5 84.5H40.5C38.5 84.5 37 83 37 81V78C30 76.5 23 72.5 23 66V45.8C23 47 21.6 47.7 20.5 47.2L11 43.1C9.1 42.3 8.4 40.3 9.5 38.5L16.5 27.5C19 23.8 22.5 21.2 27 20Z';
const NECKLINE = 'M38 17C40 22 44 24.5 48 24.5C52 24.5 56 22 58 17';
const SWIRL =
  'M48 55C48 52 43.5 51.5 42.5 54.5C41.5 58.5 46.5 61 50.5 58.8C56 55.8 54.5 48 48 47C40 46 35 53 37.2 60.5';
const PLASTER = rect(52, 61, 22, 9.5, 4.75);
const PAD = rect(59.5, 61, 7, 9.5, 1.5);

export function BellyPainIllustration(props: IllustrationProps) {
  return (
    <IllustrationFrame
      {...props}
      name="belly_pain"
      main="suit"
      materials={{
        suit: { hue: 'health' },
        plaster: { hue: 'cream', night: 'cream' },
      }}
      ground={{ x: 48, rx: 28 }}
    >
      {(kit) => {
        const plaster = kit.tones.plaster;
        const suit = kit.tones.suit;
        const mark = kit.scheme === 'light' ? suit.hi : suit.lo;
        return (
          <>
            <Body kit={kit} m="suit" d={BODYSUIT} />
            <path
              d={NECKLINE}
              fill="none"
              stroke={mark}
              strokeWidth="3"
              strokeLinecap="round"
              opacity="0.8"
            />
            <path d={SWIRL} fill="none" stroke={mark} strokeWidth="4.5" strokeLinecap="round" />
            <Shine kit={kit} m="suit" d={capsule(28, 46, 28, 56, 4.5)} />
            <g transform="rotate(-28 63 65.75)">
              <Body kit={kit} m="plaster" d={PLASTER} />
              <path d={PAD} fill={plaster.lo} opacity="0.5" />
            </g>
          </>
        );
      }}
    </IllustrationFrame>
  );
}
