/*
 * Original illustrations of Lotties, by the project contributors, licensed under the project
 * licence (AGPL-3.0-or-later). See docs/design/ILLUSTRATIONS.md.
 *
 * Sleep family: nap, night sleep, woke up, bedtime, fell asleep, night waking.
 */
import { Body, IllustrationFrame, Shine, type IllustrationProps } from './IllustrationFrame';
import { capsule, circle, cloud, crescent, sparkle } from './geometry';

/* Nap: a puffy cloud with a small crescent moon peeking over it. */
const NAP_CLOUD = cloud([
  { x: 27, y: 66, r: 12 },
  { x: 46, y: 55, r: 19 },
  { x: 67, y: 64, r: 14 },
]);
const NAP_MOON = crescent({ x: 66, y: 28, r: 15 }, { x: 74, y: 21, r: 12 });

export function NapIllustration(props: IllustrationProps) {
  return (
    <IllustrationFrame
      {...props}
      name="nap"
      main="cloud"
      materials={{
        cloud: { hue: 'sleep' },
        moon: { hue: 'diaper', night: 'light', lift: 0.3 },
      }}
      ground={{ x: 47, rx: 30 }}
    >
      {(kit) => (
        <>
          <Body kit={kit} m="moon" d={NAP_MOON} />
          <Body kit={kit} m="cloud" d={NAP_CLOUD} />
          <Shine kit={kit} m="cloud" d={capsule(33, 52, 38, 45, 5)} />
          <Shine kit={kit} m="moon" d={capsule(55, 24, 58, 18, 3.5)} />
        </>
      )}
    </IllustrationFrame>
  );
}

/* Night sleep: a large crescent with a star resting in its hollow. */
const NIGHT_MOON = crescent({ x: 44, y: 50, r: 29 }, { x: 59, y: 37, r: 24 });
const NIGHT_STAR = sparkle(63, 41, 11);
const NIGHT_STAR_SMALL = sparkle(79, 66, 6.5);

export function NightSleepIllustration(props: IllustrationProps) {
  return (
    <IllustrationFrame
      {...props}
      name="night"
      main="moon"
      materials={{ moon: { hue: 'diaper', night: 'light' }, star: { hue: 'sleep' } }}
      ground={{ x: 44, rx: 28 }}
    >
      {(kit) => (
        <>
          <Body kit={kit} m="moon" d={NIGHT_MOON} />
          <Body kit={kit} m="star" d={NIGHT_STAR} />
          <Body kit={kit} m="star" d={NIGHT_STAR_SMALL} />
          <Shine kit={kit} m="moon" d={capsule(22, 50, 26, 37, 5)} />
        </>
      )}
    </IllustrationFrame>
  );
}

/* Two soft hills shared by the woke-up and bedtime scenes: a far one on the right, a near one. */
const HILL_FAR = 'M40 82C41 69 52 59 65 59C78 59 88 69 88 80V82Z';
const HILL_NEAR = 'M8 80C8 69 20 61 36 61C52 61 66 69 67 82H8Z';

/* Woke up: a round sun rising over a soft hill, with five rays. */
const RISE_SUN = circle(50, 58, 17);
const RISE_RAYS = [-150, -120, -90, -60, -30].map((deg) => {
  const a = (deg * Math.PI) / 180;
  return capsule(
    50 + 24 * Math.cos(a),
    58 + 24 * Math.sin(a),
    50 + 31 * Math.cos(a),
    58 + 31 * Math.sin(a),
    6,
  );
});

export function WokeUpIllustration(props: IllustrationProps) {
  return (
    <IllustrationFrame
      {...props}
      name="woke_up"
      main="hill"
      materials={{
        sun: { hue: 'diaper', night: 'light', lift: 0.3 },
        hill: { hue: 'sleep', night: 'main' },
        far: { hue: 'nightWaking', night: 'dim', lift: 0.35 },
      }}
      ground={{ x: 48, rx: 36 }}
    >
      {(kit) => (
        <>
          {RISE_RAYS.map((d) => (
            <Body key={d} kit={kit} m="sun" d={d} />
          ))}
          <Body kit={kit} m="sun" d={RISE_SUN} />
          <Body kit={kit} m="far" d={HILL_FAR} />
          <Body kit={kit} m="hill" d={HILL_NEAR} />
          <Shine kit={kit} m="sun" d={capsule(38, 54, 42, 47, 4.5)} />
          <Shine kit={kit} m="hill" d={capsule(15, 72, 24, 66, 3.5)} />
        </>
      )}
    </IllustrationFrame>
  );
}

/* Bedtime: a dusk sun sinking between the hills, a small cloud and the first star. */
const SET_SUN = circle(58, 64, 15);
const SET_CLOUD = cloud([
  { x: 23, y: 40, r: 7 },
  { x: 33, y: 34, r: 10 },
  { x: 43, y: 39, r: 8 },
]);
const SET_STAR = sparkle(74, 26, 8);

export function BedtimeIllustration(props: IllustrationProps) {
  return (
    <IllustrationFrame
      {...props}
      name="bedtime"
      main="hill"
      materials={{
        hill: { hue: 'sleep' },
        far: { hue: 'nightWaking', night: 'dim', lift: 0.35 },
        sun: { hue: 'health', night: 'light' },
        cloud: { hue: 'cream', night: 'cream' },
        star: { hue: 'diaper', night: 'light', lift: 0.3 },
      }}
      ground={{ x: 48, rx: 36 }}
    >
      {(kit) => (
        <>
          <Body kit={kit} m="sun" d={SET_SUN} />
          <Body kit={kit} m="far" d={HILL_FAR} />
          <Body kit={kit} m="hill" d={HILL_NEAR} />
          <Body kit={kit} m="cloud" d={SET_CLOUD} />
          <Body kit={kit} m="star" d={SET_STAR} />
          <Shine kit={kit} m="sun" d={capsule(50, 57, 53, 53, 3.5)} />
          <Shine kit={kit} m="hill" d={capsule(15, 72, 24, 66, 3.5)} />
        </>
      )}
    </IllustrationFrame>
  );
}

/* Fell asleep: a round dream bubble holding a big "Z", a small "z" drifting away. */
const BUBBLE = circle(45, 46, 27);
const BUBBLE_TAIL = circle(19, 76, 7);
const Z_BIG = 'M35 35H55L35 57H55';
const Z_SMALL = 'M68 11H78L68 22H78';

export function FellAsleepIllustration(props: IllustrationProps) {
  return (
    <IllustrationFrame
      {...props}
      name="fell_asleep"
      main="bubble"
      materials={{ bubble: { hue: 'sleep' }, z: { hue: 'diaper', night: 'light', lift: 0.3 } }}
      ground={{ x: 40, rx: 30 }}
    >
      {(kit) => {
        // Light: a white letter on the deep bubble; dark and night: a deep letter on the pale one.
        const light = kit.scheme === 'light';
        return (
          <>
            <Body kit={kit} m="bubble" d={BUBBLE_TAIL} />
            <Body kit={kit} m="bubble" d={BUBBLE} />
            <Shine kit={kit} m="bubble" d={capsule(27, 40, 32, 31, 5)} />
            <path
              d={Z_BIG}
              fill="none"
              stroke={light ? '#ffffff' : kit.tones.bubble.deep}
              strokeOpacity={light ? 0.92 : 1}
              strokeWidth="7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d={Z_SMALL}
              fill="none"
              stroke={kit.flat ? kit.tones.z.mid : kit.fill('z')}
              strokeWidth="5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        );
      }}
    </IllustrationFrame>
  );
}

/* Night waking: a round moon with one wide-open eye, and a tiny spark of wakefulness. */
const WAKE_MOON = circle(46, 50, 29);
const WAKE_PHASE = crescent({ x: 46, y: 50, r: 29 }, { x: 38, y: 45, r: 27 });
const EYE = 'M22 51C30 37 62 37 70 51C62 65 30 65 22 51Z';
const WAKE_SPARK = sparkle(80, 18, 9);
const WAKE_CRATERS = [circle(33, 67, 3.5), circle(58, 72, 2.6), circle(62, 29, 2.6)];

export function NightWakingIllustration(props: IllustrationProps) {
  return (
    <IllustrationFrame
      {...props}
      name="night_waking"
      main="moon"
      materials={{
        moon: { hue: 'nightWaking' },
        eye: { hue: 'cream', night: 'cream' },
        spark: { hue: 'diaper', night: 'light', lift: 0.3 },
      }}
      ground={{ x: 46, rx: 28 }}
    >
      {(kit) => {
        const moon = kit.tones.moon;
        return (
          <>
            <Body kit={kit} m="moon" d={WAKE_MOON} />
            <path d={WAKE_PHASE} fill={moon.lo} opacity={kit.flat ? 0.6 : 0.35} />
            {WAKE_CRATERS.map((d) => (
              <path key={d} d={d} fill={moon.lo} opacity={kit.flat ? 0.7 : 0.4} />
            ))}
            <Body kit={kit} m="eye" d={EYE} />
            <path d={circle(46, 51, 10)} fill={moon.lo} />
            <path d={circle(46, 51, 5)} fill={moon.deep} />
            <Shine kit={kit} m="eye" d={circle(49.5, 47.5, 2.6)} />
            <Shine kit={kit} m="moon" d={capsule(25, 38, 31, 29, 5)} />
            <Body kit={kit} m="spark" d={WAKE_SPARK} />
          </>
        );
      }}
    </IllustrationFrame>
  );
}
