import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { AuthContext, type AuthApi } from '../auth/AuthContext';

export function AuthTestWrapper({
  auth,
  route = '/',
  children,
}: {
  auth: AuthApi;
  route?: string;
  children: ReactNode;
}) {
  return (
    <AuthContext value={auth}>
      <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
    </AuthContext>
  );
}
