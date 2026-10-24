import { useState } from 'react';
import { readRingLayers, writeRingLayers } from '../ringPrefs';
import type { RingLayer } from '../upcoming';

/** The layers shown on the ring and the ruler, remembered per device (`ringPrefs`). */
export function useRingLayers() {
  const [layers, setLayers] = useState<RingLayer[]>(readRingLayers);
  const toggle = (layer: RingLayer) => {
    const next = layers.includes(layer) ? layers.filter((l) => l !== layer) : [...layers, layer];
    setLayers(next);
    writeRingLayers(next);
  };
  return { layers, has: (layer: RingLayer) => layers.includes(layer), toggle };
}
