# Projects — page structure (from Stitch export, step 1)

This is what we build from. The raw Stitch HTML in
`stitch_smartdrugdiscovery_research_platform/*/code.html` is throwaway
markup — read it for reference (and the `screen.png`s for a visual), but
don't paste any of it in. Every page uses OUR existing `Nav`/`Footer`
components and our existing design tokens (see the AGREE/DIVERGE report
delivered alongside this file), not the header/footer/tokens embedded in
the Stitch code.

Fixes already applied below, per instruction — flagged again here so they
don't get re-introduced from the raw HTML:

1. **Footer**: the Stitch mock invents its own footer links (Ethics
   Policy, Methodology, Data Integrity, Contact Support) on both the
   projects-list screen and both detail-workspace screens. Do not build
   any of this — reuse `components/Footer.tsx` unchanged, everywhere.
2. **Status strip**: the Stitch mock repeats the project's stage
   ("Lead optimization" / "Hit finding") as the first pill in the status
   strip on the detail workspace, duplicating the stage chip that's
   already the fourth pill up in the header block. Drop the stage
   repeat from the strip entirely. The strip shows only: members
   count, resources-saved count, and checklist progress ("N of M
   ready") — and each of those three is hidden individually when
   there's nothing to report for it (e.g. a brand-new project with no
   checklist yet shows an empty or two-item strip, not a strip with a
   "0 of 0 ready" pill).
3. **Shared folder mock text**: the "Shared Folder" section on both
   detail-workspace screens shows the link text `KRAS_G12D_Program_Files`
   even on the PHGDH-project screen. That's a Stitch placeholder
   copy/paste artifact, not a real inconsistency to design around —
   ignore it; the real link text is just whatever `shared_folder_url`
   resolves to (or its stored label).

---

## 1. Projects list (`smartdrugdiscovery_projects_list_with_colabofest_banner`)

Order top to bottom:

1. **ColaboFest banner** — full-width callout, only rendered when
   ColaboFest is currently open for entry (this is a global "is the
   challenge live" condition, not per-project). Contains: "CHALLENGE"
   overline, "ColaboFest 2026" heading, one line of prize/deadline copy,
   a "Start your ColaboFest project" button (routes to the ColaboFest
   creation form, screen 3 below) and a "Learn more" text link.
2. **Page header** — "Your projects" title + a "New project" button
   (routes to the regular creation form, screen 2 below), on one row.
3. **Projects grid** — 2-column grid of project cards (1 column on
   mobile). Each card:
   - Title (project name), truncated to 2 lines.
   - Member-count pill, top right of the card.
   - A progress row: "Progress" label + "N of M ready" + a horizontal
     progress bar (checklist completion).
   - A footer row inside the card: a status pill — either "Proposal
     submitted" (ColaboFest projects with a submitted proposal) or "Not
     submitted" — and, only for ColaboFest projects with a deadline, a
     "Due in N days" line.
   - Whole card is a click target to the project's detail workspace.
4. **Empty state** (no projects at all) — centered icon, "No projects
   yet" heading, one line of explanatory copy, and a "Create your first
   project" button. Replaces the grid entirely; the ColaboFest banner
   above it still shows if the challenge is open.

The Stitch file also includes a section explicitly labeled "Empty State
Demo" purely so both states are visible in one export — that section
label and its "For reference" tag are not part of the real page; only
the empty-state content inside it is.

## 2. Create a regular project (`smartdrugdiscovery_create_regular_project_form`)

A single centered form, no page chrome besides a minimal nav (see the
AGREE/DIVERGE note: use our real `Nav`, not this stripped-down one).
Fields, in order:

1. **Project name** — required, single line.
2. **Programme details (optional)** — a visually grouped sub-panel
   containing four fields, all optional: **Target**, **Indication**,
   **Modality** (select: Small molecule / Biologic / PROTAC / ASO-RNA /
   Cell therapy / Other), **Stage** (select: Target identification / Hit
   finding / Lead optimization / Preclinical / IND-enabling). These are
   the four fields with no current column — see the field-location
   report delivered alongside this file.
3. **What are you working on?** — required, free-text textarea (project
   description / goal).
4. **Deadline** — optional date picker.
5. **"Entering a challenge?"** — a collapsed, expandable disclosure.
   Opens to reveal a challenge select (None / ColaboFest 2026) and one
   line of explanatory copy. Collapsed by default on this screen (this
   is the "ordinary project" entry point; ColaboFest has its own direct
   entry point, screen 3).
6. **Submit row** — "Create project" primary button, "Cancel" text
   link.

No empty state (it's a form, not a list).

## 3. Start a ColaboFest project (`smartdrugdiscovery_start_colabofest_project_form`)

Same form shell and field set as screen 2, with two differences:

- Heading is "Start your ColaboFest project" with a small "ColaboFest"
  pill directly under it, instead of "Create a project".
- The "Entering a challenge?" disclosure is gone entirely — this entry
  point already implies `challenge_key = 'colabofest_2026'`, so there's
  nothing to expand or choose.

Everything else (project name, Programme details panel with the same
four target/indication/modality/stage fields, goal textarea, deadline,
submit/cancel) is identical to screen 2.

No empty state.

## 4. Regular project detail workspace (`smartdrugdiscovery_regular_project_detail_workspace`)

Sections top to bottom, each separated by a divider:

1. **Header & status**
   - Project title (large).
   - A row of property chips: target, indication, modality, stage (only
     the ones with a value — this screen's example shows all four
     filled).
   - One paragraph of description.
   - "Edit" button, top right of this block.
   - **Status strip**: see fix #2 above — members / resources-saved /
     checklist-ready counts, each hidden if there's nothing to show.
2. **Team**
   - List of members: avatar (or a placeholder person icon for a
     pending/unlinked invite), name, email, and a "Lead" pill for the
     project lead. A pending (not-yet-signed-up) member is visually
     dimmed and shows "Pending" instead of a role pill, with "Awaiting
     invitation acceptance" as its secondary line.
   - "Add member" row at the bottom: an email input + "Add member"
     button.
3. **Resources**
   - Section heading + "Explore for this project" link/button.
   - A row of count tiles, one per source kind (Papers, Datasets,
     Tools, Trials, Grants) — only shown when there are saved resources
     at all.
   - A 3-column grid of the most recent saved items, each a small card:
     kind icon + label, title, and a source/date line.
   - **Empty state** (no resources saved for this project): a
     dashed-border panel, search icon, "Nothing saved yet" heading, one
     line of explanatory copy, "Explore for this project" button. (This
     screen's own example shows the populated state; the empty-state
     treatment is the one demonstrated on screen 5's Resources
     section — same component, reused.)
4. **Checklist**
   - One panel containing a list of checklist items. Each row: a
     three-way segmented control (Not yet / In progress / Ready) and
     the item's label. A "Ready" item shows the label struck through
     and dimmed. An item with an open Collaborate post attached to it
     also shows "Posted to Collaborate · N responses" under the label
     and, in all non-Ready states, an "Ask for help" link (the
     one-click bridge to Collaborate).
   - No dedicated empty state shown in this export; a project with an
     empty checklist should presumably show a lightweight
     "No checklist items yet" prompt here rather than an empty panel —
     flagging this as a gap in the export, not a decision already made.
5. **Shared Folder**
   - A single card: folder icon, the link (opens externally), "Added by
     <name>" + a "Change link" action. Presumably has its own empty
     state ("no folder linked yet, paste one") not shown in this
     export — same gap as above.
6. **Share your work / Promote**
   - A closing banner: "Share your work" heading, one line of copy,
     "Promote this work" button — the bridge to the existing Promote
     flow.

No project-level empty state on this screen — it's a populated example
only; the projects-LIST empty state (screen 1) is the only one this
export actually designs.

## 5. ColaboFest project detail workspace (`smartdrugdiscovery_colabofest_project_detail_workspace`)

Same section order and content as screen 4 (Header & status → Team →
Resources → Checklist → Shared Folder → Promote), with one structural
addition and one section shown in its empty state:

- **Header & status**: chips are separated by "·" dividers rather than
  being individual bordered pills (a cosmetic difference from screen 4,
  not a meaningful one — see the AGREE/DIVERGE report; we should pick
  ONE chip treatment and use it on both screens rather than carry this
  difference through).
- **Resources**: this screen shows the EMPTY state — "Nothing saved
  yet" dashed panel, described under screen 4 above. Confirms that's
  the real empty-state design for this section, not a one-off.
- **Proposal Details** (ColaboFest-only section, inserted between
  Checklist and Shared Folder... actually positioned between Shared
  Folder and Promote in the file — see note below): two-column layout.
  Left column is a form: Proposal Title (text, prefilled example),
  Research Category (select), Executive Summary (textarea), "Submit
  proposal" button. Right column is a file dropzone: "Click to upload
  or drag and drop", accepted types/size note (PDF/DOCX/ZIP, max 50MB).
  This section only appears for a project with `challenge_key` set —
  it's the piece of `project_proposals` this workspace edits directly.
  No empty state shown; the screen's example has prefilled values, so
  a genuinely empty proposal (title/category/summary all blank,
  nothing uploaded) is a gap in the export, not a decision already
  made.
- **Promote / Share your work**: same bridge as screen 4, styled as a
  centered card here rather than a left-aligned banner — another
  cosmetic difference to reconcile (see the AGREE/DIVERGE report), not
  a functional one.

Order actually in the file: Header & status → Team → Resources
(empty) → Checklist → Shared Folder → **Proposal Details** → Promote.
