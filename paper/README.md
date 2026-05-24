# OpenGAP Paper

This directory contains the canonical research paper for **OpenGAP** — the GitAgentProtocol — in arXiv-ready LaTeX and a Markdown mirror.

## Files

- `open-gap.tex` — the paper (master source of truth)
- `bibliography.bib` — BibTeX references
- `Makefile` — build rules
- `figures/` — image assets (patterns diagrams, logo, etc.)
- `tables/` — CSV data backing tables that are regenerable from code (e.g., fidelity matrix)

## Build

Requires a TeX distribution with `pdflatex` and `bibtex` (TeX Live, MiKTeX, or MacTeX).

```bash
make pdf       # produces open-gap.pdf
make clean     # removes LaTeX aux files
make distclean # also removes the PDF
make watch     # rebuild on change (requires fswatch)
```

The paper uses only arXiv-compatible packages (`amsmath`, `amssymb`, `graphicx`, `hyperref`, `listings`, `booktabs`, `xcolor`, `geometry`, `authblk`, `microtype`, `caption`), so the same source compiles locally and on arXiv.

## Citing

Preferred BibTeX entry (update year and arXiv id once posted):

```bibtex
@misc{opengap2026,
  author       = {Shreyas Kapale and {OpenGAP Working Group}},
  title        = {{OpenGAP: GitAgentProtocol — A Git-Native Protocol for the AI Agent Lifecycle}},
  year         = {2026},
  eprint       = {XXXX.XXXXX},
  archivePrefix= {arXiv},
  primaryClass = {cs.SE},
  url          = {https://gitagent.sh/paper}
}
```

## Regenerating the fidelity matrix

The fidelity matrix in Appendix B should be regenerated against the current adapters before each submission. The procedure:

1. Run `opengap export --format <adapter> -o /tmp/export-<adapter>` for each of the 15 adapters, against both `examples/standard/` and `examples/full/`.
2. For each adapter output, check whether each of the nine GAP elements (SOUL, RULES, DUTIES, skills, tools, hooks, memory, sub-agents, compliance) is (F) fully preserved, (P) partially preserved, or (-) absent.
3. Commit the result to `tables/fidelity-matrix.csv`.
4. Update the tabular block in `open-gap.tex`, Appendix B, from the CSV.

## Contributing

The paper is maintained alongside the specification. Pull requests that change the spec should also update the paper (or explicitly note why not). Pull requests that improve the paper without changing the spec are equally welcome.
