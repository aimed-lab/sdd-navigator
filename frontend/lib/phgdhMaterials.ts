// Public materials for the "Project workspace" section on /phgdh
// (components/phgdh/ProjectWorkspace.tsx). Only the PUBLIC access level has real
// content; the Team and Admin levels are locked previews with no data.
//
// TO FILL IN (nothing here is written by the site's developers; paste the real
// text only):
//   * patentAbstract (done)
//   * manuscriptAbstract.title / .text
//   * add the screenshot file at frontend/public/phgdh/phgdh-app.png
//
// A tile is NOT rendered while its fields are still a TODO or empty, or while the
// image file is missing, so the page is safe to ship before any of this is filled.

export type Abstract = {
  title: string;
  text: string;
  /** Optional small muted line shown under the title. */
  note?: string;
};

export const patentAbstract: Abstract = {
  title: "Inhibitors of Phosphoglycerate Dehydrogenase and Uses Thereof",
  text: "This invention is in the field of medicinal pharmacology. In particular, the present invention relates to small molecule pharmaceutical agents which function as inhibitors of human phosphoglycerate dehydrogenase that function as therapeutics for the treatment of Alzheimer Disease.",
  note: "Patent application · University of Alabama at Birmingham",
};

export const manuscriptAbstract: Abstract = {
  title: "TODO: paste the manuscript title",
  text: "TODO: paste the manuscript abstract",
};

/** Public path of the app screenshot (file lives in frontend/public/phgdh/). */
export const appScreenshot = "/phgdh/phgdh-app.png";

/** True once both fields hold real text (not empty, not a TODO placeholder). */
export function abstractReady(a: Abstract): boolean {
  const real = (s: string) => s.trim().length > 0 && !/^\s*todo\b/i.test(s);
  return real(a.title) && real(a.text);
}
