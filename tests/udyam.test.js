import test from "node:test";
import assert from "node:assert/strict";

import { isValidUdyamNumber, normalizeUdyamNumber, parseUdyamImportedRecord } from "../server/udyam.js";

test("normalizeUdyamNumber trims and uppercases the official number", () => {
  assert.equal(normalizeUdyamNumber("  udyam-dl-10-0006405 "), "UDYAM-DL-10-0006405");
});

test("isValidUdyamNumber accepts only the official Udyam number shape", () => {
  assert.equal(isValidUdyamNumber("UDYAM-DL-10-0006405"), true);
  assert.equal(isValidUdyamNumber("udyam-dl-10-0006405"), true);
  assert.equal(isValidUdyamNumber("UDYAMDL100006405"), false);
  assert.equal(isValidUdyamNumber("UAM-DL-10-0006405"), false);
});

test("parseUdyamImportedRecord structures copied official certificate content", () => {
  const result = parseUdyamImportedRecord(`
    Udyam Registration Certificate
    UDYAM REGISTRATION NUMBER
    UDYAM-DL-10-0006405
    NAME OF ENTERPRISE
    ASCLEPIUS WELLNESS PRIVATE LIMITED
    ORGANISATION TYPE
    Private Limited Company
    MAJOR ACTIVITY
    Manufacturing
    SOCIAL CATEGORY OF ENTREPRENEUR
    General
    DATE OF INCORPORATION / REGISTRATION OF ENTERPRISE
    12/10/2011
    DATE OF COMMENCEMENT OF PRODUCTION/BUSINESS
    12/10/2011
    OFFICAL ADDRESS OF ENTERPRISE
    A-1, Example Road, New Delhi, Delhi, 110001
    Mobile
    9999999999
    Email
    contact@asclepius.example
    DATE OF UDYAM REGISTRATION
    27/01/2021
    https://udyamregistration.gov.in/verifyudyambarcode.aspx?verifyudrn=abc%2B123
  `);

  assert.equal(result.registrationNumber, "UDYAM-DL-10-0006405");
  assert.equal(result.enterpriseName, "ASCLEPIUS WELLNESS PRIVATE LIMITED");
  assert.equal(result.officialAddress, "A-1, Example Road, New Delhi, Delhi, 110001");
  assert.equal(result.officialEmail, "contact@asclepius.example");
  assert.equal(result.qrToken, "abc+123");
  assert.equal(result.confidence, "High");
});
