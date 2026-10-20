// Who is acting and with which database client. The website gets this from the
// cookie session (requireCurrentUser); the external agent gets it from the
// researcher's own access token (lib/server/agent/agentAuth.ts). Either way
// the client carries the researcher's identity, so RLS decides what is allowed.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ActingDb = any;

export type ActingUser = { id: string; email: string | null };

export type ActingContext = { user: ActingUser; db: ActingDb };
