// ColaboFest 2026 constants. The challenge banner that used to render at the top
// of /projects was removed (the challenge has closed); only these constants
// remain, because app/projects/actions.ts imports COLABOFEST_DEADLINE.
//
// COLABOFEST_DEADLINE lives right next to it for the same reason: ONE named
// constant, not a date scattered across the create form and the server
// action. ColaboFest 2026 closes 30 September 2026 — this is not the
// team's choice to make, so app/projects/actions.ts sets every ColaboFest
// project's deadline to this value SERVER-SIDE and the create form never
// asks for one. End-of-day UTC, not midnight, so the deadline reads as
// "through September 30", not "up to the start of it".
export const COLABOFEST_OPEN = true;
export const COLABOFEST_DEADLINE = "2026-09-30T23:59:59Z";
