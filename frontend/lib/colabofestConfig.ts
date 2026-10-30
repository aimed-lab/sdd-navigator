// ColaboFest 2026: the program dates and the contact address, in ONE place.
// No imports, so server and client code (and `npm test`) can all use it.
//
// Change a date or the contact email here and the Welcome card's date line, the
// "current stage" and the "Still can't get in?" link all follow.

/** The six points on the Welcome card's date line, in date order. `from` (an ISO day)
 *  is when that stage starts; the stage whose `from` is the latest one not after
 *  today is the current stage. `shown` is the text printed under the dot. */
export const COLABOFEST_STAGES = [
  { key: "kickoff", label: "Kickoff", shown: "Oct 26", from: "2026-10-26" },
  { key: "agreement", label: "Finalist agreement due", shown: "Nov 11", from: "2026-11-11" },
  { key: "presentations", label: "Finalist presentations and awards", shown: "Nov 13", from: "2026-11-13" },
  { key: "computational", label: "Computational results", shown: "Dec 15", from: "2026-12-15" },
  { key: "experimental", label: "Experimental results", shown: "Apr 1", from: "2027-04-01" },
  { key: "showcase", label: "Showcase", shown: "May", from: "2027-05-01" },
] as const;

/** Where "Still can't get in?" sends the email. */
export const COLABOFEST_CONTACT_EMAIL = "smartdrugdiscovery@gmail.com";

/** The name of the program as shown in the Welcome card. */
export const COLABOFEST_SHOWCASE_NAME = "May showcase";

// ── finalist tasks ───────────────────────────────────────────────────────────
// The three things each finalist team does. The status of each lives in the project's
// checklist_items (one item per task, found by its label), and
// database/migrations/2026-11-06_colabofest_finalist_tasks.sql inserts them for every
// finalist: keep the labels here and there identical.

/** When the finalist tasks are due. */
export const FINALIST_DUE = { from: "2026-11-11", shown: "Nov 11", long: "Nov 11, 2026" } as const;

export const FINALIST_TASKS = [
  {
    key: "readiness",
    label: "Finalize your readiness checklist",
    description:
      "Confirm what SPARC will provide within the $20K service award. Mark anything beyond it as a future or fee-based service. Your submitted checklist is the draft.",
  },
  {
    key: "workplan",
    label: "Write your 6-week work plan",
    description:
      "Week by week, what your team and SPARC will do between mid-November and December 22. We'll agree on it together.",
  },
  {
    key: "kickoff",
    label: "Schedule your kickoff meeting",
    description: `Meet with Dr. Chen, the SPARC team and Southern Research. Email ${COLABOFEST_CONTACT_EMAIL} with 3 times that work for you.`,
  },
] as const;

export type FinalistTaskKey = (typeof FINALIST_TASKS)[number]["key"];

/** The note under the tasks. */
export const FINALIST_FILES_NOTE = "Upload your updated files to your project's Box folder.";

/** The index (0-5) of the current stage on `today` (an ISO day, YYYY-MM-DD).
 *  Before the kickoff date it is still the first stage. */
export function currentStageIndex(today: string): number {
  let idx = 0;
  COLABOFEST_STAGES.forEach((s, i) => {
    if (today >= s.from) idx = i;
  });
  return idx;
}
