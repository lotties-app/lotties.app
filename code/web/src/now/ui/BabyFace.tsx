/*
 * Original illustration of Lotties, by the project contributors, licensed under the project
 * licence (AGPL-3.0-or-later). See docs/design/ILLUSTRATIONS.md.
 *
 * The "now" marker of the day ring and the ruler: a round baby face in the app's terracotta, drawn
 * with the illustration kit (light from the top-left, flat in the night scheme), so it looks the
 * same on every device. Four faces: awake (calm smile), drowsy (half-closed eyes, the nap window
 * is open), asleep (closed eyes and a small "z") and tired (droopy eyes, a soft wavy mouth, during
 * the overtired heads-up). Gentle on purpose: never a crying or upset face.
 */
import { Body, IllustrationFrame, Shine, type Kit } from '../../ui/illustrations/IllustrationFrame';
import { capsule, circle } from '../../ui/illustrations/geometry';
import type { FaceState } from '../rhythmDetails';

/** The head fills most of the compact view box, so the face reads at about 24 px. */
const HEAD = circle(48, 52, 36);
/** The features are drawn for a head of radius 31 and grown with it. */
const GROW = 'translate(48 52) scale(1.16) translate(-48 -52)';
/** Radius of the head as a share of the drawn size (compact view box: 86 units). */
export const FACE_HEAD_SHARE = 36 / 86;
/** Height of the head's centre as a share of the drawn size (it sits a little low, under the z). */
export const FACE_HEAD_Y = 47 / 86;
/** A small curl of hair lying on the top of the head (inside it, so it never reads as a stem). */
const CURL = 'M42 30C42 24 52 23 52 28.5C52 31.5 47.5 32 47 29.5';
const CHEEKS = [circle(31, 60, 5), circle(65, 60, 5)];
const Z = 'M73 7H85L73 19H85';

/** Two eyes as filled shapes (awake), or the strokes of the other faces. */
const FEATURES: Record<FaceState, { fills: string[]; strokes: string[] }> = {
  awake: {
    fills: [circle(37, 50, 4.4), circle(59, 50, 4.4)],
    strokes: ['M39 62Q48 70 57 62'],
  },
  drowsy: {
    // Lids half down: a lid line over the lower half of each eye.
    fills: ['M32 50A5 5 0 0 0 42 50Z', 'M54 50A5 5 0 0 0 64 50Z'],
    strokes: ['M31 50H43', 'M53 50H65', 'M43 64Q48 67 53 64'],
  },
  asleep: {
    fills: [],
    strokes: ['M32 49Q37 54.5 42 49', 'M54 49Q59 54.5 64 49', 'M45 63Q48 65.5 51 63'],
  },
  tired: {
    // Heavy lids drooping to the outer corners (never slanting inwards, which reads as cross).
    fills: ['M32 52A5 4 0 0 0 42 52Z', 'M54 52A5 4 0 0 0 64 52Z'],
    strokes: ['M31 53L43 51', 'M53 51L65 53', 'M41 65Q44.5 62.5 48 65Q51.5 67.5 55 65'],
  },
};

/** Light: cream features on the terracotta face; dark and night: deep ones on the paler face. */
const featureColor = (kit: Kit) =>
  kit.scheme === 'light' ? kit.tones.paper.mid : kit.tones.face.deep;

export interface BabyFaceProps {
  face: FaceState;
  /** Width and height (px, or user units inside another SVG). */
  size: number;
}

/** The baby face of the "now" marker; decorative (the marker's button carries the name). */
export function BabyFace({ face, size }: BabyFaceProps) {
  const features = FEATURES[face];
  return (
    <IllustrationFrame
      size={size}
      name={`baby_face_${face}`}
      main="face"
      ground={false}
      materials={{
        face: { hue: 'accent', night: 'light' },
        cheek: { hue: 'health', night: 'dim', lift: 0.5 },
        paper: { hue: 'cream', night: 'cream' },
        z: { hue: 'sleep', night: 'light', lift: 0.3 },
      }}
    >
      {(kit) => {
        const ink = featureColor(kit);
        return (
          <>
            <g data-face-head>
              <Body kit={kit} m="face" d={HEAD} />
            </g>
            <g transform={GROW}>
              {/* Rosy cheeks; none in the flat night scheme, where they read as dark spots. */}
              {!kit.flat &&
                CHEEKS.map((d) => <path key={d} d={d} fill={kit.tones.cheek.mid} opacity={0.45} />)}
              <path
                d={CURL}
                fill="none"
                stroke={kit.tones.face.lo}
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {features.fills.map((d) => (
                <path key={d} d={d} fill={ink} />
              ))}
              {features.strokes.map((d) => (
                <path
                  key={d}
                  d={d}
                  fill="none"
                  stroke={ink}
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
              <Shine kit={kit} m="face" d={capsule(28, 40, 33, 31, 5)} />
            </g>
            {face === 'asleep' && (
              <path
                d={Z}
                fill="none"
                stroke={kit.scheme === 'light' ? kit.tones.z.lo : kit.tones.z.mid}
                strokeWidth="5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
          </>
        );
      }}
    </IllustrationFrame>
  );
}
