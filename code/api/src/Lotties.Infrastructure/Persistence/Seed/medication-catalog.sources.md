# Medication catalog seed: sources

Seed data of migration `MedicationsPrescriptionsCatalog` (`MedicationCatalogSeed.cs`). Rules (docs/design/06-medications.md section 5): generic names only, each verified on an authoritative public page; no dose, interval, age or strength information; no WHO ATC data. Checked 2026-10-21.

## Substances (seeded)

Brazilian names are the DCB (Denominações Comuns Brasileiras) spellings from the ANVISA consolidated DCB list (spreadsheet version of RDC 935/2024; the list in force is IN 473/2026, not downloaded, see "Open points"):
- handle: https://bibliotecadigital.anvisa.gov.br/jspui/handle/anvisa/11933
- file: https://bibliotecadigital.anvisa.gov.br/jspui/bitstream/anvisa/12267/1/4-%202024%20Lista%20Consolidada%20DCB%20out.xlsx

| key | English | pt-BR | synonyms | sources |
|---|---|---|---|---|
| simethicone | Simethicone | Simeticona (DCB 8006) | - | DCB list; https://medlineplus.gov/druginfo/meds/a682683.html |
| cholecalciferol | Cholecalciferol | Colecalciferol (DCB 2569) | Vitamin D3 | DCB list; https://medlineplus.gov/ency/article/002405.htm |
| paracetamol | Paracetamol | Paracetamol (DCB 6827) | Acetaminophen | DCB list; https://medlineplus.gov/druginfo/meds/a681004.html |
| ibuprofen | Ibuprofen | Ibuprofeno (DCB 4766) | - | DCB list; https://medlineplus.gov/druginfo/meds/a682159.html |
| metamizole | Metamizole | Dipirona (DCB 3121) | Dipyrone | DCB list; https://medicalguidelines.msf.org/en/viewport/EssDr/english/metamizole-dipyrone-noramidopyrine-oral-16684113.html (MSF Essential Drugs; no NHS/BNF/MedlinePlus page was found) |
| limosilactobacillus_reuteri | Limosilactobacillus reuteri | Limosilactobacillus reuteri | Lactobacillus reuteri | https://lpsn.dsmz.de/species/limosilactobacillus-reuteri (current name, basonym Lactobacillus reuteri). Not a DCB entry; scientific names are not translated. |

## Products (none seeded)

The brief allows brand-to-substance mappings only from ANVISA (consulta de medicamentos / bulário) or the CMED list. The ANVISA consultation service answered with a block page and the CMED list was not consulted, so no product is seeded. Findings from other public pages, for the owner to decide on (not used):

| brand | finding | source (not ANVISA/CMED) |
|---|---|---|
| Luftal | simeticona, oral drops; the brand site footnote says it is a notified medicine (RDC 576/2021) | https://www.luftal.com.br/produtos/luftal-gotas-30ml/ |
| Flygas | no product with this name found; "Fly" (simeticona, drops and capsules) exists | retailer pages only |
| Colicaliv | homeopathic medicine (Matricaria chamomilla, Mentha piperita, Magnesia phosphorica, Colocynthis); not simethicone | https://herbarium.com.br/wp-content/uploads/2021/10/02310154-02-BU-COLICALIV-AR03-SITE.pdf |
| Puravit | a product line of vitamin supplements (e.g. A-D-E, ADZ) exempt from registration, not one product | retailer pages only |
| Colidis | food supplement (probiotic, Limosilactobacillus reuteri DSM 17938) | https://www.ache.com.br/produto/suplementos-alimentares/colidis/ |

Families can add these as community products (`POST /api/v1/catalog/products`); an admin can later verify them once an admin role exists.

## Open points
- Re-check the DCB spellings against the list in force (IN 473/2026).
- Seed products only after an ANVISA or CMED check, in a new migration with stable ids and the source URL next to each row.
