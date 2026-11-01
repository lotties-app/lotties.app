import { useContext } from 'react';
import { AuthContext, type AuthApi } from './AuthContext';

export function useAuth(): AuthApi {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth must be used within an AuthProvider');
  return auth;
}
