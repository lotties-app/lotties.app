/**
 * The header that names the registered device a request comes from (docs/design/37b-widget-silent-push.md section 4.2):
 * the server skips this device when it pings the family's phones about a change it made itself. Set only in the native
 * app, after `POST /push/devices` answered (widgets/silentPush.ts); absent in every browser.
 */
export const PUSH_DEVICE_HEADER = 'Lotties-Push-Device';

let deviceId: string | undefined;

export function setPushDeviceId(id: string | undefined): void {
  deviceId = id;
}

/** The header to add to an API request: empty when this install has no registered device. */
export function pushDeviceHeaders(): Record<string, string> {
  return deviceId ? { [PUSH_DEVICE_HEADER]: deviceId } : {};
}
