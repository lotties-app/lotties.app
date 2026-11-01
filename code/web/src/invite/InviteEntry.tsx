import { useState } from 'react';
import { Navigate, Outlet, useLocation, useParams } from 'react-router-dom';
import { INVITE_PATH, scrubInviteUrl, stashPendingInvite, tokenFromHash } from './inviteToken';

/**
 * `/invite#<token>`: parks the token and removes it from the address bar once per visit, before
 * any sign-in redirect, so the token never reaches the login redirect state. Renders the child
 * routes (the protected invite page). Mounted outside RequireAuth.
 */
export function InviteEntry() {
  const { hash } = useLocation();
  useState(() => {
    const token = tokenFromHash(hash);
    if (token) {
      stashPendingInvite(token);
      scrubInviteUrl();
    }
    return null;
  });
  return <Outlet />;
}

/**
 * Deprecated `/invite/:token`: parks the path token, replaces the URL with `/invite`, then
 * continues there. A separate component so React does not reuse its state for `InviteEntry`.
 */
export function LegacyInviteEntry() {
  const { token = '' } = useParams();
  useState(() => {
    if (token) {
      stashPendingInvite(token);
    }
    scrubInviteUrl();
    return null;
  });
  return <Navigate to={INVITE_PATH} replace />;
}
