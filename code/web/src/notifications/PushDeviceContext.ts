import { createContext, useContext } from 'react';
import { browserPushDevice, type PushDevice } from './pushDevice';

/** The browser's push port; tests and the developer preview provide a fake. */
export const PushDeviceContext = createContext<PushDevice>(browserPushDevice);

export function usePushDevice(): PushDevice {
  return useContext(PushDeviceContext);
}
