/*
 * Original illustrations of Lotties, by the project contributors, licensed under the project
 * licence (AGPL-3.0-or-later). See docs/design/ILLUSTRATIONS.md.
 *
 * Feeding family: bottle, nursing, pumping, solid food.
 */
import { Body, IllustrationFrame, Shine, type IllustrationProps } from './IllustrationFrame';
import { capsule, circle, ellipse, rect } from './geometry';

/* Bottle: a slightly tilted feeding bottle, milk inside, a honey-coloured teat. */
const TEAT = 'M39 28C39 19 43 12 48 12C53 12 57 19 57 28Z';
const COLLAR = rect(35, 26, 26, 9, 3.5);
const BOTTLE_BODY = rect(34, 33, 28, 50, 11);
const BOTTLE_MILK = rect(38.5, 51, 19, 27.5, 7);

export function BottleIllustration(props: IllustrationProps) {
  return (
    <IllustrationFrame
      {...props}
      name="bottle"
      main="glass"
      materials={{
        glass: { hue: 'feeding' },
        milk: { hue: 'cream', night: 'cream' },
        teat: { hue: 'diaper', night: 'light', lift: 0.3 },
        collar: { hue: 'feeding', night: 'dim' },
      }}
      ground={{ x: 50, rx: 22 }}
    >
      {(kit) => (
        <g transform="rotate(12 48 50)">
          <Body kit={kit} m="teat" d={TEAT} />
          <Body kit={kit} m="glass" d={BOTTLE_BODY} />
          <Body kit={kit} m="milk" d={BOTTLE_MILK} />
          <Body kit={kit} m="collar" d={COLLAR} />
          <path d={capsule(50, 42, 56, 42, 3)} fill={kit.tones.glass.hi} opacity="0.85" />
          <Shine kit={kit} m="glass" d={capsule(39.5, 40, 39.5, 47, 4)} />
          <Shine kit={kit} m="teat" d={capsule(44, 21, 46, 16, 3)} />
        </g>
      )}
    </IllustrationFrame>
  );
}

/* Nursing: a soft heart with a drop of milk resting against it. */
const HEART =
  'M43 77C27 67 12 55 12 38C12 28 19 20 29 20C35 20 40 23 43 29C46 23 51 20 57 20C67 20 74 28 74 38C74 55 59 67 43 77Z';
const DROP = 'M70 46C70 46 81 58 81 65C81 71 76 76 70 76C64 76 59 71 59 65C59 58 70 46 70 46Z';

export function NursingIllustration(props: IllustrationProps) {
  return (
    <IllustrationFrame
      {...props}
      name="nursing"
      main="heart"
      materials={{
        heart: { hue: 'activity' },
        drop: { hue: 'cream', night: 'cream' },
      }}
      ground={{ x: 48, rx: 30 }}
    >
      {(kit) => (
        <>
          <Body kit={kit} m="heart" d={HEART} />
          <Body kit={kit} m="drop" d={DROP} />
          <Shine kit={kit} m="heart" d={capsule(20, 38, 24, 29, 5)} />
          <Shine kit={kit} m="drop" d={capsule(64, 63, 65, 59, 3)} />
        </>
      )}
    </IllustrationFrame>
  );
}

/* Pumping: a short collection bottle with a wide flange tilted up and to the left. */
const PUMP_BODY = rect(40, 47, 32, 36, 10);
const PUMP_MILK = rect(44.5, 61, 23, 17.5, 6);
const PUMP_COLLAR = rect(42, 40, 28, 9, 3.5);
const FLANGE = 'M51 42V35C51 29 38 25 38 15H74C74 25 61 29 61 35V42Z';
const FLANGE_RIM = ellipse(56, 15, 18, 5.5);

export function PumpingIllustration(props: IllustrationProps) {
  return (
    <IllustrationFrame
      {...props}
      name="pumping"
      main="glass"
      materials={{
        glass: { hue: 'feeding' },
        milk: { hue: 'cream', night: 'cream' },
        flange: { hue: 'diaper', night: 'light', lift: 0.3 },
        collar: { hue: 'feeding', night: 'dim' },
      }}
      ground={{ x: 54, rx: 24 }}
    >
      {(kit) => (
        <>
          <g transform="rotate(-32 56 42)">
            <Body kit={kit} m="flange" d={FLANGE} />
            <Body kit={kit} m="flange" d={FLANGE_RIM} />
            <path d={ellipse(56, 15.5, 12, 3)} fill={kit.tones.flange.lo} opacity="0.55" />
          </g>
          <Body kit={kit} m="glass" d={PUMP_BODY} />
          <Body kit={kit} m="milk" d={PUMP_MILK} />
          <Body kit={kit} m="collar" d={PUMP_COLLAR} />
          <Shine kit={kit} m="glass" d={capsule(45.5, 54, 45.5, 60, 4)} />
        </>
      )}
    </IllustrationFrame>
  );
}

/* Solid food: a round bowl heaped with purée, a spoon resting in it. */
const FOOD = 'M20 54C21 42 34 34 48 34C62 34 75 42 76 54Z';
const SPOON_HEAD = ellipse(55, 42, 7, 5);
const SPOON_HANDLE = capsule(58, 40, 80, 16, 6);
const BOWL = 'M13 52H83C83 69 68 81 48 81C28 81 13 69 13 52Z';
const BOWL_LIP = capsule(13, 53, 83, 53, 6);

export function SolidFoodIllustration(props: IllustrationProps) {
  return (
    <IllustrationFrame
      {...props}
      name="solid_food"
      main="bowl"
      materials={{
        bowl: { hue: 'feeding' },
        food: { hue: 'activity', night: 'light', lift: 0.4 },
        spoon: { hue: 'custom', night: 'cream' },
      }}
      ground={{ x: 48, rx: 32 }}
    >
      {(kit) => (
        <>
          <Body kit={kit} m="food" d={FOOD} />
          <Body kit={kit} m="spoon" d={SPOON_HEAD} />
          <Body kit={kit} m="spoon" d={SPOON_HANDLE} />
          <Shine kit={kit} m="food" d={capsule(30, 44, 36, 40, 4)} />
          <Body kit={kit} m="bowl" d={BOWL} />
          <path d={BOWL_LIP} fill={kit.tones.bowl.hi} opacity={kit.flat ? 0.5 : 0.9} />
          <Shine kit={kit} m="bowl" d={capsule(22, 62, 28, 70, 4.5)} />
          <path d={circle(66, 66, 3)} fill={kit.tones.bowl.hi} opacity="0.7" />
        </>
      )}
    </IllustrationFrame>
  );
}
