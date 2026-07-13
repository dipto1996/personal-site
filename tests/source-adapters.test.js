import test from "node:test";
import assert from "node:assert/strict";

import { parseCpppByDateHtml, parseDgftTradeNoticeHtml, parseGemBidPlusResponse } from "../server/source-adapters.js";

test("GeM BidPlus parser extracts bid docs from response payload", () => {
  const payload = {
    response: {
      response: {
        docs: [
          {
            b_id: ["78901"],
            b_bid_number: ["GEM/2026/B/78901"],
            ba_official_details_minName: ["Ministry of Steel"],
            ba_official_details_deptName: ["Procurement Wing"],
            b_category_name: ["Industrial Consumables"],
            qtr_dir: ["q1_2026"],
            b_is_new_upload: [1],
          },
        ],
      },
    },
  };

  const [record] = parseGemBidPlusResponse(payload);

  assert.equal(record.externalId, "78901");
  assert.equal(record.bidNumber, "GEM/2026/B/78901");
  assert.equal(record.department, "Procurement Wing");
  assert.match(record.documentUrl, /showbidDocument\/78901\/q1_2026\/1/);
});

test("CPPP parser extracts tender rows from ePublishing HTML", () => {
  const html = `
    <table>
      <tr class="odd">
        <td align="center">1.</td>
        <td align="center">27-Mar-2026</td>
        <td align="center">02-Apr-2026 15:00</td>
        <td align="center">02-Apr-2026 16:00</td>
        <td align="center"><a href="/epublish/app?component=view1">[Solar inverters]</a> [REF-42][T-9988]</td>
        <td align="center">Solar Energy Corporation of India</td>
      </tr>
    </table>
  `;

  const [record] = parseCpppByDateHtml(html);

  assert.equal(record.serial, 1);
  assert.equal(record.title, "Solar inverters");
  assert.equal(record.referenceNumber, "REF-42");
  assert.equal(record.tenderId, "T-9988");
  assert.match(record.detailUrl, /component=view1/);
});

test("DGFT trade notice parser extracts notice title and PDF URL", () => {
  const html = `
    <table>
      <tr>
        <td>1</td>
        <td>33/2025-2026</td>
        <td>2025-2026</td>
        <td>Operational instructions for edible exports</td>
        <td>26/03/2026</td>
        <td><a title="Download" href="https://www.dgft.gov.in/file/notice.pdf">PDF</a></td>
      </tr>
    </table>
  `;

  const [record] = parseDgftTradeNoticeHtml(html);

  assert.equal(record.noticeNumber, "33/2025-2026");
  assert.equal(record.noticeYear, "2025-2026");
  assert.equal(record.noticeDate, "26/03/2026");
  assert.equal(record.title, "Operational instructions for edible exports");
  assert.equal(record.pdfUrl, "https://www.dgft.gov.in/file/notice.pdf");
});
