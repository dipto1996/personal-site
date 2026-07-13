import test from "node:test";
import assert from "node:assert/strict";

import { normalizeCin, parseMcaCatalogMetrics, parseMcaFindCinResults, parseMcaMasterData } from "../server/mca.js";

const SAMPLE_MASTER_DATA = `
  Company/LLP Master Data
  CIN
  U74140DL2011PTC275905
  Company Name
  ASCLEPIUS WELLNESS PRIVATE LIMITED
  ROC Code
  RoC-Delhi
  Registration Number
  275905
  Company Category
  Company limited by shares
  Company SubCategory
  Non-government company
  Class of Company
  Private
  Authorised Capital(Rs)
  1000000
  Paid up Capital(Rs)
  500000
  Date of Incorporation
  12/10/2011
  Registered Address
  A-1, Example Road, New Delhi, Delhi, 110001
  Email Id
  contact@asclepius.example
  Whether Listed or not
  Unlisted
  Date of last AGM
  30/09/2024
  Date of Balance Sheet
  31/03/2024
  Company Status(for efiling)
  Active

  Charges
  Assets under charge
  Charge Amount
  Date of Creation
  Date of Modification
  Status
  Hypothecation on plant
  2500000
  12/05/2024
  14/05/2024
  Open

  Directors/Signatory Details
  DIN/PAN
  Name
  Begin date
  End date
  Surrendered DIN
  01234567
  ROY DEY
  12/10/2011
  -
  No
`;

test("normalizeCin trims and uppercases CIN values", () => {
  assert.equal(normalizeCin("  u74140dl2011ptc275905 "), "U74140DL2011PTC275905");
});

test("parseMcaMasterData structures official copied master-data text", () => {
  const result = parseMcaMasterData(SAMPLE_MASTER_DATA);

  assert.equal(result.companyName, "ASCLEPIUS WELLNESS PRIVATE LIMITED");
  assert.equal(result.cin, "U74140DL2011PTC275905");
  assert.equal(result.companyStatus, "Active");
  assert.equal(result.details.find((item) => item.label === "ROC Code")?.value, "RoC-Delhi");
  assert.equal(result.directors.length, 1);
  assert.equal(result.directors[0].name, "ROY DEY");
  assert.equal(result.charges.length, 1);
  assert.equal(result.charges[0].status, "Open");
  assert.equal(result.confidence, "High");
});

test("parseMcaCatalogMetrics extracts totals and updated labels from OGD catalog HTML", () => {
  const metrics = parseMcaCatalogMetrics(`
    <div>Updated On: 18/03/2026</div>
    <script>
      window.__NUXT__ = { apiDetails: { total:2875574 }, field_file_format:"text/csv", field_file_size:"996505" };
    </script>
  `);

  assert.equal(metrics.updatedLabel, "18/03/2026");
  assert.equal(metrics.totalRecords, 2875574);
  assert.equal(metrics.fileFormat, "text/csv");
  assert.equal(metrics.fileSize, "996505");
});

test("parseMcaFindCinResults structures copied official Find CIN results", () => {
  const result = parseMcaFindCinResults(`
    Company Name
    CIN
    Status
    ASCLEPIUS WELLNESS PRIVATE LIMITED
    U74140DL2011PTC275905
    Active
    SAFFRON WELLNESS LABS PRIVATE LIMITED
    U24231HR2018PTC074321
    Active
  `);

  assert.equal(result.candidateCount, 2);
  assert.equal(result.candidates[0].cin, "U74140DL2011PTC275905");
  assert.equal(result.candidates[0].companyName, "ASCLEPIUS WELLNESS PRIVATE LIMITED");
  assert.equal(result.candidates[1].status, "Active");
});
