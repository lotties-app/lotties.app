import { useAuth } from '../useAuth';
import { isDemoAccountId } from './demoSession';

/** Whether the signed-in account is a demo (the server is the authority; this only hides what it would refuse). */
export function useIsDemo(): boolean {
  return isDemoAccountId(useAuth().accountId);
}
