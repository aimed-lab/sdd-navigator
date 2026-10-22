// Provider search synonyms. A plain list: each row is one group of terms that
// mean the same thing to a researcher, so searching any of them finds the
// others. To add one, add a row (lowercase; a hyphen or space inside a term
// does not matter). Multi-word terms are fine ("protein expression").

export const SYNONYM_GROUPS: string[][] = [
  ["adme", "dmpk", "pharmacokinetics", "pharmacokinetic", "pk"],
  ["tox", "toxicology", "toxicity", "safety"],
  ["protein expression", "recombinant proteins", "recombinant protein"],
  ["cryo-em", "cryoem", "structural biology", "crystallography"],
  ["hts", "high-throughput screening", "screening"],
  ["cdmo", "manufacturing"],
  ["ai", "machine learning", "ml"],
];
