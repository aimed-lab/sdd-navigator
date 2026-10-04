// Hand-picked open-source drug discovery tools and public datasets, shown as a
// "Hand-picked" row above the live search results when the Tools or Datasets
// chip is selected on /explore.
//
// RULES FOR EDITING THIS FILE
//   * Real, well-known projects only, with the official site or GitHub repo.
//   * `license` only when certain. When unsure, leave it out; a missing license
//     is honest, a wrong one is not.
//   * `oneLine` is plain English, 15 words or fewer, no jargon.
//   * Safe for client components (types and data only, no server imports).

import type { ExploreItem } from "@/types/explore";

export type CuratedItem = {
  /** URL-safe slug, unique within its array. */
  id: string;
  name: string;
  /** Plain English, max 15 words. */
  oneLine: string;
  category: string;
  /** Official site or GitHub repository. */
  url: string;
  /** SPDX-style name; only present when certain. */
  license?: string;
  tags: string[];
};

export const curatedTools: CuratedItem[] = [
  // Cheminformatics
  {
    id: "rdkit",
    name: "RDKit",
    oneLine: "The standard toolkit for working with molecules in code.",
    category: "Cheminformatics",
    url: "https://www.rdkit.org",
    license: "BSD-3-Clause",
    tags: ["molecules", "python", "fingerprints"],
  },
  {
    id: "open-babel",
    name: "Open Babel",
    oneLine: "Converts between chemical file formats and runs common molecule tasks.",
    category: "Cheminformatics",
    url: "https://openbabel.org",
    license: "GPL-2.0",
    tags: ["file formats", "molecules"],
  },
  {
    id: "cdk",
    name: "Chemistry Development Kit",
    oneLine: "A Java library for handling and analysing chemical structures.",
    category: "Cheminformatics",
    url: "https://cdk.github.io",
    tags: ["molecules", "java"],
  },
  {
    id: "datamol",
    name: "Datamol",
    oneLine: "A friendlier, simpler layer on top of RDKit for everyday molecule work.",
    category: "Cheminformatics",
    url: "https://datamol.io",
    license: "Apache-2.0",
    tags: ["molecules", "python"],
  },

  // Docking
  {
    id: "autodock-vina",
    name: "AutoDock Vina",
    oneLine: "Predicts how a small molecule fits into a protein pocket.",
    category: "Docking",
    url: "https://vina.scripps.edu",
    license: "Apache-2.0",
    tags: ["docking", "binding"],
  },
  {
    id: "smina",
    name: "smina",
    oneLine: "A tweaked version of AutoDock Vina with better scoring options.",
    category: "Docking",
    url: "https://sourceforge.net/projects/smina/",
    tags: ["docking", "scoring"],
  },
  {
    id: "gnina",
    name: "gnina",
    oneLine: "Docking software that uses deep learning to score how well molecules fit.",
    category: "Docking",
    url: "https://github.com/gnina/gnina",
    tags: ["docking", "deep learning"],
  },
  {
    id: "diffdock",
    name: "DiffDock",
    oneLine: "Predicts where and how a molecule binds a protein, using AI.",
    category: "Docking",
    url: "https://github.com/gcorso/DiffDock",
    license: "MIT",
    tags: ["docking", "deep learning"],
  },
  {
    id: "posebusters",
    name: "PoseBusters",
    oneLine: "Checks whether a predicted molecule pose is physically realistic.",
    category: "Docking",
    url: "https://github.com/maabuu/posebusters",
    tags: ["docking", "validation"],
  },

  // Machine learning for molecules
  {
    id: "deepchem",
    name: "DeepChem",
    oneLine: "Deep learning tools for drug discovery, chemistry and biology.",
    category: "Molecular ML",
    url: "https://deepchem.io",
    license: "MIT",
    tags: ["deep learning", "python"],
  },
  {
    id: "chemprop",
    name: "Chemprop",
    oneLine: "Trains models that predict molecule properties directly from their structure.",
    category: "Molecular ML",
    url: "https://github.com/chemprop/chemprop",
    license: "MIT",
    tags: ["property prediction", "graph neural network"],
  },
  {
    id: "torchdrug",
    name: "TorchDrug",
    oneLine: "A machine learning toolbox for molecules, proteins and knowledge graphs.",
    category: "Molecular ML",
    url: "https://torchdrug.ai",
    license: "Apache-2.0",
    tags: ["deep learning", "python"],
  },

  // Protein structure
  {
    id: "alphafold-db",
    name: "AlphaFold Protein Structure Database",
    oneLine: "Free predicted 3D structures for over 200 million proteins.",
    category: "Protein structure",
    url: "https://alphafold.ebi.ac.uk",
    tags: ["protein structure", "database"],
  },
  {
    id: "alphafold",
    name: "AlphaFold",
    oneLine: "The open code behind AlphaFold's protein structure predictions.",
    category: "Protein structure",
    url: "https://github.com/google-deepmind/alphafold",
    license: "Apache-2.0",
    tags: ["protein structure", "deep learning"],
  },
  {
    id: "colabfold",
    name: "ColabFold",
    oneLine: "Fast protein structure prediction you can run in a browser notebook.",
    category: "Protein structure",
    url: "https://github.com/sokrypton/ColabFold",
    license: "MIT",
    tags: ["protein structure", "notebook"],
  },
  {
    id: "openfold",
    name: "OpenFold",
    oneLine: "A trainable, open reimplementation of AlphaFold 2.",
    category: "Protein structure",
    url: "https://github.com/aqlaboratory/openfold",
    license: "Apache-2.0",
    tags: ["protein structure", "deep learning"],
  },
  {
    id: "boltz",
    name: "Boltz",
    oneLine: "Predicts how proteins and small molecules fit together in 3D.",
    category: "Protein structure",
    url: "https://github.com/jwohlwend/boltz",
    license: "MIT",
    tags: ["protein structure", "binding"],
  },
  {
    id: "esm",
    name: "ESM",
    oneLine: "Protein language models from Meta that learn from sequences alone.",
    category: "Protein structure",
    url: "https://github.com/facebookresearch/esm",
    license: "MIT",
    tags: ["protein language model", "deep learning"],
  },
  {
    id: "foldseek",
    name: "Foldseek",
    oneLine: "Searches huge protein structure collections for similar 3D shapes.",
    category: "Protein structure",
    url: "https://github.com/steineggerlab/foldseek",
    license: "GPL-3.0",
    tags: ["protein structure", "search"],
  },

  // Protein design
  {
    id: "proteinmpnn",
    name: "ProteinMPNN",
    oneLine: "Designs amino acid sequences that fold into a chosen protein shape.",
    category: "Protein design",
    url: "https://github.com/dauparas/ProteinMPNN",
    license: "MIT",
    tags: ["protein design", "deep learning"],
  },
  {
    id: "rfdiffusion",
    name: "RFdiffusion",
    oneLine: "Generates brand-new protein backbones, for example binders to a target.",
    category: "Protein design",
    url: "https://github.com/RosettaCommons/RFdiffusion",
    tags: ["protein design", "generative"],
  },

  // Simulation
  {
    id: "openmm",
    name: "OpenMM",
    oneLine: "A fast toolkit for simulating how molecules move over time.",
    category: "Simulation",
    url: "https://openmm.org",
    tags: ["molecular dynamics", "gpu"],
  },
  {
    id: "gromacs",
    name: "GROMACS",
    oneLine: "A widely used, very fast program for molecular dynamics simulations.",
    category: "Simulation",
    url: "https://www.gromacs.org",
    license: "LGPL-2.1",
    tags: ["molecular dynamics", "hpc"],
  },
  {
    id: "mdanalysis",
    name: "MDAnalysis",
    oneLine: "Python library for reading and analysing molecular simulation results.",
    category: "Simulation",
    url: "https://www.mdanalysis.org",
    tags: ["molecular dynamics", "python", "analysis"],
  },

  // Generative chemistry
  {
    id: "reinvent4",
    name: "REINVENT 4",
    oneLine: "AI that proposes new molecules tuned toward the properties you want.",
    category: "Generative chemistry",
    url: "https://github.com/MolecularAI/REINVENT4",
    license: "Apache-2.0",
    tags: ["de novo design", "generative"],
  },

  // ADMET
  {
    id: "admet-ai",
    name: "ADMET-AI",
    oneLine: "Quickly predicts how a molecule may be absorbed, processed and cleared.",
    category: "ADMET",
    url: "https://github.com/swansonk14/admet_ai",
    license: "MIT",
    tags: ["admet", "property prediction"],
  },

  // Visualization
  {
    id: "molstar",
    name: "Mol*",
    oneLine: "A web viewer for 3D structures of proteins and other molecules.",
    category: "Visualization",
    url: "https://molstar.org",
    license: "MIT",
    tags: ["3d viewer", "web"],
  },
  {
    id: "pymol-open-source",
    name: "PyMOL (open source)",
    oneLine: "The classic program for viewing and making figures of molecules.",
    category: "Visualization",
    url: "https://github.com/schrodinger/pymol-open-source",
    tags: ["3d viewer", "figures"],
  },

  // Workflows and benchmarks
  {
    id: "tdc",
    name: "Therapeutics Data Commons",
    oneLine: "Ready-made datasets and benchmarks for AI in drug discovery.",
    category: "Workflow & benchmarks",
    url: "https://tdcommons.ai",
    license: "MIT",
    tags: ["benchmarks", "python"],
  },
  {
    id: "nextflow",
    name: "Nextflow",
    oneLine: "Builds analysis pipelines that run the same way on a laptop or cluster.",
    category: "Workflow & benchmarks",
    url: "https://nextflow.io",
    license: "Apache-2.0",
    tags: ["pipelines", "reproducibility"],
  },

  // Single cell
  {
    id: "scanpy",
    name: "Scanpy",
    oneLine: "Python toolkit for analysing single-cell gene expression data.",
    category: "Single cell",
    url: "https://scanpy.scverse.org/en/stable/",
    license: "BSD-3-Clause",
    tags: ["single cell", "python"],
  },
  {
    id: "scvi-tools",
    name: "scvi-tools",
    oneLine: "Deep learning models for single-cell data, built on PyTorch.",
    category: "Single cell",
    url: "https://scvi-tools.org",
    license: "BSD-3-Clause",
    tags: ["single cell", "deep learning"],
  },
];

export const curatedDatasets: CuratedItem[] = [
  {
    id: "chembl",
    name: "ChEMBL",
    oneLine: "Measured activity of drug-like molecules against targets, curated from papers.",
    category: "Compounds & bioactivity",
    url: "https://www.ebi.ac.uk/chembl/",
    tags: ["bioactivity", "compounds"],
  },
  {
    id: "pubchem",
    name: "PubChem",
    oneLine: "The largest free collection of chemical molecules and their properties.",
    category: "Compounds & bioactivity",
    url: "https://pubchem.ncbi.nlm.nih.gov",
    tags: ["compounds", "assays"],
  },
  {
    id: "zinc",
    name: "ZINC",
    oneLine: "Purchasable molecules, ready for virtual screening.",
    category: "Compounds & bioactivity",
    url: "https://cartblanche22.docking.org",
    tags: ["virtual screening", "compounds"],
  },
  {
    id: "bindingdb",
    name: "BindingDB",
    oneLine: "Measured binding strengths between small molecules and proteins.",
    category: "Compounds & bioactivity",
    url: "https://www.bindingdb.org",
    tags: ["binding", "affinity"],
  },
  {
    id: "rcsb-pdb",
    name: "RCSB Protein Data Bank",
    oneLine: "Experimentally determined 3D structures of proteins and other biomolecules.",
    category: "Structures & proteins",
    url: "https://www.rcsb.org",
    tags: ["protein structure", "3d"],
  },
  {
    id: "uniprot",
    name: "UniProt",
    oneLine: "The reference catalogue of protein sequences and what they do.",
    category: "Structures & proteins",
    url: "https://www.uniprot.org",
    tags: ["proteins", "annotation"],
  },
  {
    id: "open-targets",
    name: "Open Targets Platform",
    oneLine: "Evidence linking genes and drug targets to diseases.",
    category: "Targets & disease",
    url: "https://platform.opentargets.org",
    tags: ["targets", "disease"],
  },
  {
    id: "depmap",
    name: "DepMap",
    oneLine: "Which genes cancer cell lines depend on to survive.",
    category: "Targets & disease",
    url: "https://depmap.org/portal/",
    tags: ["cancer", "gene dependency"],
  },
  {
    id: "lincs-cmap",
    name: "LINCS L1000 / CMap",
    oneLine: "How cells' gene activity changes after treatment with drugs or gene edits.",
    category: "Gene expression",
    url: "https://clue.io",
    tags: ["gene expression", "perturbation"],
  },
  {
    id: "geo",
    name: "Gene Expression Omnibus (GEO)",
    oneLine: "Public repository of gene expression datasets from published studies.",
    category: "Gene expression",
    url: "https://www.ncbi.nlm.nih.gov/geo/",
    tags: ["gene expression", "rna-seq"],
  },
  {
    id: "gtex",
    name: "GTEx",
    oneLine: "Gene activity across many healthy human tissues.",
    category: "Gene expression",
    url: "https://gtexportal.org",
    tags: ["gene expression", "tissues"],
  },
  {
    id: "gdc",
    name: "NCI Genomic Data Commons",
    oneLine: "Cancer genomics data, including The Cancer Genome Atlas (TCGA).",
    category: "Cancer genomics",
    url: "https://portal.gdc.cancer.gov",
    tags: ["cancer", "genomics"],
  },
  {
    id: "cellxgene",
    name: "CZ CELLxGENE",
    oneLine: "Explore and download millions of single cells from published studies.",
    category: "Single cell",
    url: "https://cellxgene.cziscience.com",
    tags: ["single cell", "atlas"],
  },
  {
    id: "human-cell-atlas",
    name: "Human Cell Atlas",
    oneLine: "An open map of all cell types in the healthy human body.",
    category: "Single cell",
    url: "https://www.humancellatlas.org",
    tags: ["single cell", "atlas"],
  },
  {
    id: "clinicaltrials-gov",
    name: "ClinicalTrials.gov",
    oneLine: "The registry of clinical studies run around the world.",
    category: "Clinical",
    url: "https://clinicaltrials.gov",
    tags: ["trials", "clinical"],
  },
  {
    id: "tdc-datasets",
    name: "Therapeutics Data Commons datasets",
    oneLine: "Curated, benchmark-ready datasets covering the drug discovery pipeline.",
    category: "Benchmarks",
    url: "https://tdcommons.ai",
    tags: ["benchmarks", "machine learning"],
  },
  {
    id: "moleculenet",
    name: "MoleculeNet",
    oneLine: "A standard benchmark collection for predicting molecule properties.",
    category: "Benchmarks",
    url: "https://deepchem.readthedocs.io/en/latest/api_reference/moleculenet.html",
    tags: ["benchmarks", "machine learning"],
  },

  // TODO(Chen lab): add the Chen lab virtual cell datasets below. Fill in the
  // real name, one-line description and official URL for each; do not guess.
  // TODO(Chen lab): virtual cell dataset #1
  // TODO(Chen lab): virtual cell dataset #2
  // TODO(Chen lab): virtual cell dataset #3
];

/** Shapes a curated entry as an ExploreItem so the existing ItemCard renders it
 *  unchanged (same card, same bookmark, click opens the official site). */
export function curatedToExploreItem(item: CuratedItem, kind: "tool" | "dataset"): ExploreItem {
  return {
    id: `curated-${kind}-${item.id}`,
    kind,
    title: item.name,
    summary: item.oneLine,
    url: item.url,
    source: "Hand-picked",
    date_iso: null,
    signal: null,
  };
}
