// Recent publications from Prof. Jake Chen's AI.MED Lab at UAB, shown on /explore
// ("From the AI.MED Lab"). Copied from aimed-lab.org/publications and cm4ai.org:
// title, venue, year and DOI only. No authors and no descriptions are added.
// Each links to https://doi.org/<doi>.

export type LabPaper = {
  title: string;
  venue: string;
  year: number;
  doi: string;
};

export const LAB_PUBLICATIONS_URL = "https://aimed-lab.org/publications";

export const labPapers: LabPaper[] = [
  {
    title: "GETgene-AI: a framework for prioritizing actionable cancer drug targets",
    venue: "Frontiers in Systems Biology",
    year: 2025,
    doi: "10.3389/fsysb.2025.1649758",
  },
  {
    title: "Integrative multi-scale network simulation for precision drug repurposing with PETS",
    venue: "bioRxiv",
    year: 2025,
    doi: "10.1101/2025.02.24.639994",
  },
  {
    title:
      "LlamaAffinity: A Predictive Antibody Antigen Binding Model Integrating Antibody Sequences with Llama3 Backbone Architecture",
    venue: "bioRxiv",
    year: 2025,
    doi: "10.1101/2025.05.28.653051",
  },
  {
    title:
      "AI-Driven Network Biology Identifies SRC as a Therapeutic Target in Metastatic Pancreatic Adenocarcinoma",
    venue: "Intelligent Oncology",
    year: 2025,
    doi: "10.1016/j.intonc.2025.06.004",
  },
  {
    title:
      "NeSyDPP4-QSAR: Discovering DPP-4 Inhibitors for Diabetes Treatment with a Neuro-symbolic AI Approach",
    venue: "Frontiers in Bioinformatics",
    year: 2025,
    doi: "10.3389/fbinf.2025.1603133",
  },
  {
    title: "Evaluating Cancer Drug-Targeting Pathways with Large Language Models",
    venue: "AISCA 2025",
    year: 2025,
    doi: "10.2139/ssrn.5171226",
  },
  {
    title:
      "High-throughput screening for the identification of dual inhibitors of BRD4 and RIPK3 toward the development of small-molecule medical countermeasure agents against arsenicals",
    venue: "SLAS Discovery",
    year: 2025,
    doi: "10.1016/j.slasd.2025.100247",
  },
  {
    title: "Targeting West Nile virus replication by xanthine inhibitors",
    venue: "Medicinal Chemistry Research",
    year: 2025,
    doi: "10.1007/s00044-025-03481-7",
  },
  {
    title: "An NLP-based Technique to Extract Meaningful Features from Drug SMILES",
    venue: "iScience",
    year: 2024,
    doi: "10.1016/j.isci.2024.109127",
  },
  {
    title:
      "Cell Maps for Artificial Intelligence: AI-Ready Maps of Human Cell Architecture from Disease-Relevant Cell Lines",
    venue: "bioRxiv",
    year: 2024,
    doi: "10.1101/2024.05.21.589311",
  },
  {
    title:
      "GOLDEN fusion: a graph-oriented learning with domain-embedding network fusion for generating super gene sets in functional genomics",
    venue: "Briefings in Bioinformatics",
    year: 2026,
    doi: "10.1093/bib/bbag244",
  },
  {
    title:
      "AI-driven gene-sets, networks, pathways, and interactions analyses of multi-omics data",
    venue: "Progress in Molecular Biology and Translational Science",
    year: 2026,
    doi: "10.1016/bs.pmbts.2026.01.023",
  },
];

export const doiUrl = (doi: string) => `https://doi.org/${doi}`;
