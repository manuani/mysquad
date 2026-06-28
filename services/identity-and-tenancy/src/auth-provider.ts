/**
 * AuthProvider — the seam a real WorkOS adapter plugs into.
 *
 * Platform Specification §8: founders sign up/sign in via Apple, Google,
 * Microsoft, or email magic-link, all WorkOS-backed in production. No real
 * WorkOS credentials are available in this environment (Deliverable 1.2.1
 * scope note), so this interface is defined now and a `DevAuthProvider`
 * (dev-auth-provider.ts) implements it without calling any real OAuth
 * provider. A future `WorkosAuthProvider` implements the same interface;
 * callers (the HTTP handlers in routes.ts) never change.
 */

export type SignInMethod = 'apple' | 'google' | 'microsoft' | 'email_magic_link';

/**
 * Identity claims resolved from the upstream provider (WorkOS, or the dev
 * stand-in). `email` is the only field every sign-in method is guaranteed
 * to produce; provider-specific subject ids are not modeled yet because no
 * real provider is wired up.
 */
export interface ProviderIdentity {
  readonly email: string;
  readonly method: SignInMethod;
}

/**
 * Result of a successful sign-up or sign-in: a session token plus the
 * tenant/user identity it resolves to. Routes hand `sessionToken` back to
 * the client; everything else informs the response body.
 */
export interface AuthResult {
  readonly sessionToken: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly userType: 'founder' | 'admin' | 'expert';
  readonly expiresAt: string;
}

export interface AuthProvider {
  /**
   * Creates a new tenant and founder user for `email` (if one doesn't
   * already exist for that email) and issues a session token.
   */
  signUp(email: string, method: SignInMethod): Promise<AuthResult>;

  /**
   * Resolves an existing user by email and issues a new session token.
   * Throws if no user exists for that email — sign-up is a distinct step,
   * matching the Platform Specification's sign-up vs. sign-in flows.
   */
  signIn(email: string, method: SignInMethod): Promise<AuthResult>;

  /**
   * Resolves a bearer session token back to its tenant/user identity, or
   * returns null if the token is missing, expired, or revoked.
   */
  resolveSession(sessionToken: string): Promise<AuthResult | null>;

  /** Revokes a session token. Idempotent — revoking twice is not an error. */
  signOut(sessionToken: string): Promise<void>;
}
