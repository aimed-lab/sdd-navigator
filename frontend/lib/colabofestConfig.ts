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

/** The index (0-5) of the current stage on `today` (an ISO day, YYYY-MM-DD).
 *  Before the kickoff date it is still the first stage. */
export function currentStageIndex(today: string): number {
  let idx = 0;
  COLABOFEST_STAGES.forEach((s, i) => {
    if (today >= s.from) idx = i;
  });
  return idx;
}
