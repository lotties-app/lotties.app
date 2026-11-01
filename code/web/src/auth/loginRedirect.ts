/** Router state the landing page receives when a protected page sent the visitor there. */
export interface LoginRedirectState {
  /** The protected path (with query) to return to after signing in. */
  from?: string;
  /** The automatic redirect to the identity provider could not start. */
  failed?: boolean;
}
