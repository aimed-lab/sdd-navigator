-- =============================================================================
-- Migration: reclassify_nlrp3_checklist  (2026-08-19)
-- =============================================================================
-- One-time data fix for the 12 checklist_items rows that got a wrong
-- matched_capabilities value from the OLD classifier prompt (keyword-match
-- on technique words rather than "would a team pay an external provider to
-- do this" — see tools/find_provider.py's _MAPPING_SYSTEM_TEMPLATE and its
-- new code-level grounding gate, fixed in the same change as this
-- migration). All 12 rows live in one project — NLRP3 inflammasome
-- inhibition in diabetic kidney disease (07416483-c153-4987-afd9-
-- a085f682928a) — and are, as of this writing, the ONLY rows in the whole
-- database with a non-empty matched_capabilities (13 total; the 13th,
-- "Recruit a nephrologist co-investigator at UAB", was already correctly
-- []  and needs no update).
--
-- EXPLICIT VALUES, NOT A RE-RUN OF THE CLASSIFIER. Each row below was
-- reclassified by hand against the fixed prompt+gate and reviewed before
-- being written here as a literal UPDATE — that's what makes this
-- reviewable (every old -> new value is visible in the diff) and
-- repeatable (running it again is a no-op, not a second LLM call with
-- whatever the model happens to say this time).
--
-- Each UPDATE is scoped by id AND project_id together — belt-and-suspenders
-- against operating on the wrong row; a UUID collision isn't realistically
-- possible, but pairing the two costs nothing and documents which project
-- this data fix is actually for.
--
-- Idempotent — every statement SETs an explicit value, so re-running this
-- migration produces the same end state whether it's the first run or the
-- fifth.
-- =============================================================================

-- "Quantify GSDMD and IL1B expression in existing scRNA-seq biopsy data"
-- OLD: {single-cell} -> NEW: {}  (their own analysis of data they already have)
UPDATE public.checklist_items
SET matched_capabilities = '{}'
WHERE id = '51a6923b-608e-4efa-b783-626172b3890e'
  AND project_id = '07416483-c153-4987-afd9-a085f682928a';

-- "Validate dominant effector in kidney organoids using CRISPR knockout of
-- GSDMD and IL1B"
-- OLD: {organoid-3d,crispr} -> NEW: {organoid-3d,crispr}  (unchanged — a
-- real service: generating a new organoid/CRISPR model system)
UPDATE public.checklist_items
SET matched_capabilities = '{organoid-3d,crispr}'
WHERE id = '724bcc29-4a35-4cf8-8b3f-f899d54f5660'
  AND project_id = '07416483-c153-4987-afd9-a085f682928a';

-- "Integrate the 'Tubular epithelial cells promote macrophage pyroptosis'
-- dataset to assess PANX1-P2X7 signaling in diabetic kidney samples"
-- OLD: {bioinformatics,single-cell} -> NEW: {}  (integrating an existing dataset)
UPDATE public.checklist_items
SET matched_capabilities = '{}'
WHERE id = '8cbf82e1-fce2-4120-9490-1a49dc471713'
  AND project_id = '07416483-c153-4987-afd9-a085f682928a';

-- "Develop a kidney-targeted prodrug or delivery platform to improve NLRP3
-- inhibitor exposure"
-- OLD: {drug-delivery,formulation} -> NEW: {}  (ambiguous whether this is
-- the team's own design work or something to buy — correct default per
-- the "when in doubt, return nothing" bias)
UPDATE public.checklist_items
SET matched_capabilities = '{}'
WHERE id = 'daeb1fe6-82b7-4e83-9410-1790a7a374a5'
  AND project_id = '07416483-c153-4987-afd9-a085f682928a';

-- "Perform retrospective analysis of the 'Molecular and Clinical Profile of
-- Diabetes Mellitus' cohort for correlations between NLRP3 pathway markers
-- and disease progression"
-- OLD: {bioinformatics} -> NEW: {}  (their own retrospective analysis)
UPDATE public.checklist_items
SET matched_capabilities = '{}'
WHERE id = '71ab6ca3-1e57-409e-8c59-09670d3524d8'
  AND project_id = '07416483-c153-4987-afd9-a085f682928a';

-- "Analyze IL-18 expression in scRNA-seq biopsies"
-- OLD: {single-cell} -> NEW: {}  (their own analysis)
UPDATE public.checklist_items
SET matched_capabilities = '{}'
WHERE id = 'f2c8aa5b-cf09-4b8c-b44f-e22039a5a5f9'
  AND project_id = '07416483-c153-4987-afd9-a085f682928a';

-- "Leverage the colchicine transcriptomic dataset to infer NLRP3 inhibition
-- signatures in diabetic CKD"
-- OLD: {bioinformatics} -> NEW: {}  (leveraging an existing dataset)
UPDATE public.checklist_items
SET matched_capabilities = '{}'
WHERE id = 'df8cd843-7665-4315-86f1-8081b5ea7a49'
  AND project_id = '07416483-c153-4987-afd9-a085f682928a';

-- "Screen the 'Inflammasome Hyperactivation' scRNA-seq dataset for patient
-- sub-clusters with high NLRP3 pathway activity"
-- OLD: {single-cell,bioinformatics} -> NEW: {}  (screening an existing dataset)
UPDATE public.checklist_items
SET matched_capabilities = '{}'
WHERE id = '1c2c225b-a319-43e1-b5e8-2a4a7cbfc305'
  AND project_id = '07416483-c153-4987-afd9-a085f682928a';

-- "Perform spatial transcriptomics on DKD biopsy sections to map
-- NLRP3-GSDMD-IL1B co-localization with fibrotic zones"
-- OLD: {spatial-omics} -> NEW: {spatial-omics}  (unchanged — a real
-- service: generating new spatial data from biopsy sections)
UPDATE public.checklist_items
SET matched_capabilities = '{spatial-omics}'
WHERE id = '5f5e3da0-1df0-4765-ad35-ea6c37112169'
  AND project_id = '07416483-c153-4987-afd9-a085f682928a';

-- "Identify and validate a circulating microRNA signature correlated with
-- renal inflammasome activation"
-- OLD: {bioinformatics} -> NEW: {}  (ambiguous identify/validate work,
-- correct default under the "when in doubt" bias)
UPDATE public.checklist_items
SET matched_capabilities = '{}'
WHERE id = 'cf256217-bd03-47e6-b017-b741f6f141e5'
  AND project_id = '07416483-c153-4987-afd9-a085f682928a';

-- "Develop a multiplex immunoassay for urinary GSDMD-NT and IL-1beta as
-- non-invasive biomarkers"
-- OLD: {immunoassay} -> NEW: {}  (ambiguous whether this is the team's own
-- assay-development work or something to buy — correct default per the
-- "when in doubt, return nothing" bias, same reasoning as the delivery-
-- platform item above)
UPDATE public.checklist_items
SET matched_capabilities = '{}'
WHERE id = '06385935-cabc-4182-be6f-d763f917f378'
  AND project_id = '07416483-c153-4987-afd9-a085f682928a';

-- "Outsource GLP toxicology studies for the lead compound"
-- OLD: {toxicology-glp} -> NEW: {toxicology-glp}  (unchanged — explicitly
-- says "outsource")
UPDATE public.checklist_items
SET matched_capabilities = '{toxicology-glp}'
WHERE id = '88a05ee2-20ff-444e-932d-3bfbb6bd007a'
  AND project_id = '07416483-c153-4987-afd9-a085f682928a';

-- "Recruit a nephrologist co-investigator at UAB" (id
-- f1c4eb45-c95e-4dd9-9d49-151514bf7b37) is NOT included above — it was
-- already {} before this migration (correctly: needs a person) and needs
-- no update.
