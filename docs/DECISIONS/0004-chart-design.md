# 0004 — Chart design system

**Status:** accepted (2026-10-28)

**Decision.**
- Categorical palette: 8 slots, stepped separately for light and dark, validated with an OKLab
  CVD checker against the actual chart surfaces (`#ffffff`, `#12161d`). All hard gates pass in both
  modes. Light mode has three slots below 3:1 contrast, so every chart has a table view and
  legends for ≥ 2 series.
- Colour follows the entity (series names sorted → slots), never rank, so filtering doesn't
  repaint survivors. More than 7 series fold into a neutral "Other".
- One value axis, never dual axes. Thin marks: 2 px lines, 4 px rounded data ends,
  surface-coloured gaps between stacked fills, recessive grid. Text uses text tokens, never
  series colours.
- Heatmaps use a single-hue sequential ramp. Status (job/dataset) is always icon + label.

**Consequences.** `chartOptions.ts` is a pure, unit-tested function. New chart types must follow
the same token and colour rules.
