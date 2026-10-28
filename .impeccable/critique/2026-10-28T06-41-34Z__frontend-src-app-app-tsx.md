---
target: frontend/src/app/App.tsx (operator dashboard)
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
target_identity: "file:/var/home/kazuto/Documentos/Spookytoon_LinuxWin_Reto_A/frontend/src/app/App.tsx"
target_fingerprint: "sha256:cd850e4fa0b88c890e769f2cd035aed05ce4b262767ea288a4ac5cc71db0b628"
target_path: /var/home/kazuto/Documentos/Spookytoon_LinuxWin_Reto_A/frontend/src/app/App.tsx
timestamp: 2026-10-28T06-41-34Z
slug: frontend-src-app-app-tsx
---
### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Metrics can read 0/0/0 while shelter occupancy shows real counts in the same snapshot |
| 2 | Match System / Real World | 4 | Spanish operator vocabulary, round names, segmentoId-based closures match operator mental model |
| 3 | User Control and Freedom | 2 | No confirm/undo before irreversible "Cerrar segmento" |
| 4 | Consistency and Standards | 2 | ConnectionStatus uses stock Tailwind colors instead of project accent tokens |
| 5 | Error Prevention | 2 | No confirmation before irreversible closure action |
| 6 | Recognition Rather Than Recall | 3 | Legend glyphs share code with map glyphs; segmentoId semantics still require recall |
| 7 | Flexibility and Efficiency of Use | 1 | No keyboard shortcuts, no pre-filled motivo for scripted closures |
| 8 | Aesthetic and Minimalist Design | 3 | Legend defaults expanded covering ~1/3 of map; 13 detector-flagged undersized labels |
| 9 | Error Recovery | 3 | graphVersion-mismatch screen excellent; generic API errors show raw backend text |
| 10 | Help and Documentation | 1 | No contextual help anywhere (acceptable for expert tool, but absent) |
| **Total** | | **24/40** | **Acceptable (60%)** |

### Design Specificity Verdict

LLM assessment: grounded, not generic — radar-sweep glyph, two-family color system, shared glyph code between map/legend are specific. ConnectionStatus.tsx falls back to stock Tailwind colors instead of project tokens, breaking DESIGN.md's own Regla del Rojo Único.

Deterministic scan: CLI detect exit 0 (0 findings, static markup clean). Browser-injected scan: 17 findings desktop (2 tiny-text, 11 undersized-ui-text, 1 clipped-overflow-container false positive on Leaflet root, 2 advisory low-contrast). Mobile adds positioned-child-clipped-by-overflow-container on the marker layer, corroborating the P0 mobile map collapse independently.

### Priority Issues

[P0] Map renders at zero height on mobile viewports (App.tsx wrapper div has no height constraint below md:) — /impeccable harden
[P1] ConnectionStatus.tsx uses off-token Tailwind colors (bg-amber-400 etc.) instead of accent-* tokens — /impeccable harden
[P1] Legend defaults to expanded, occludes ~1/3 of map on first paint — /impeccable clarify
[P1] No confirmation before irreversible "Cerrar segmento" action — /impeccable harden
[P2] "Segmento a cerrar" is one flat unstructured select over 736 edges — /impeccable clarify
[P2] 13 instances of 10px uppercase labels flagged as undersized (detector-corroborated) — /impeccable typeset

### Persona Red Flags

Alex (Power User/operator): no keyboard shortcuts, no pre-filled motivo for scripted closures, seed/gameId stay editable mid-round with no guardrail.
Sam (Accessibility): R-TARQUI/R-ESTEROS text-slate-300 contrast risk, Desbloquear buttons lack distinguishing aria-label, entity glyphs lack role=img/aria-label, Leaflet markers not keyboard-focusable.

### Minor Observations

- "Disponibilidad" shows bare em-dash in the common steady-state with no explanation
- ShelterOccupancy hardcodes bg-[#14323a] instead of documented night-track token
- Round labels differ in punctuation style between select and MetricsPanel
- accent-purple/accent-purplelight correctly unused per DESIGN.md

### Questions to Consider

1. What happens visually at turn 150/150 when a round completes?
2. Should the UI show a confident "0" it can't vouch for when metrics disagree?
3. Is "operator is fully sighted" a permanent constraint, or does map accessibility need a DOM-level name eventually?
