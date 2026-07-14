import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBroadSearchShards,
  classifyCandidateTitle,
  normalizeIntelligenceTitle,
} from "../server/job-search/title-ontology.js";

const OWNER_GOLDEN_TITLES = [
  "Senior Director of Data Analytics and Business Systems",
  "Senior Manager, Data Science - Foundational Models",
  "Senior Manager, Decision Science",
  "Senior Manager, Data Engineering",
  "Senior Manager, Data Analysis - Data Management Risk and Analysis",
  "Manager, Data Analysis - Data Management Risk and Analysis",
  "Strategy & Analytics Lead",
  "Data Science & Advanced Analytic Lead - Banking",
  "Senior Manager, Data Analysis - Data Management Risk and Analysis",
  "Manager, Data Science (Marketing)",
];

test("the broad title ontology recalls all ten owner-provided jobs", () => {
  const results = OWNER_GOLDEN_TITLES.map(classifyCandidateTitle);
  assert.equal(results.filter((result) => result.eligible).length, 10);
  assert.deepEqual(results.map((result) => result.lane), Array(10).fill("function_and_seniority"));
});

test("generic title words do not create noisy candidates by themselves", () => {
  const rejected = [
    "Senior Manager, Data Center Operations",
    "Senior Product Marketing Manager",
    "Data Entry Manager",
    "Director, Software Engineering",
    "Director, Information Technology Operations",
    "Senior Manager, Customer Support",
  ];
  assert.deepEqual(rejected.map((title) => classifyCandidateTitle(title).eligible), Array(rejected.length).fill(false));
});

test("specialist target roles do not require a management word", () => {
  for (const title of ["Product Scientist", "Context Engineer", "AI Operator", "Business Manager"]) {
    const result = classifyCandidateTitle(title);
    assert.equal(result.eligible, true, title);
    assert.notEqual(result.lane, "not_candidate", title);
  }
});

test("candidate routing implements function-and-seniority, specialist, and multi-function lanes", () => {
  assert.equal(classifyCandidateTitle("Senior Analytics Manager").lane, "function_and_seniority");
  assert.equal(classifyCandidateTitle("Product Scientist").lane, "specialist_exception");
  assert.equal(classifyCandidateTitle("Analytics and Data Strategy").lane, "multi_function_exploratory");
  assert.equal(classifyCandidateTitle("Analytics Specialist").eligible, false);
});

test("normalization handles morphology and common seniority abbreviations", () => {
  assert.equal(normalizeIntelligenceTitle("Sr. Director, Advanced Analytic & AI Products"), "senior director advanced analytics and ai product");
  assert.equal(classifyCandidateTitle("VP, Data Scientists and Analytics").eligible, true);
});

test("broad search shards cover functions rather than fixed full titles", () => {
  const shards = buildBroadSearchShards();
  assert.equal(shards.length, 8);
  assert.ok(shards.every((shard) => /manager OR director OR head OR lead OR principal OR senior OR vp OR chief/.test(shard.query)));
  assert.ok(shards.every((shard) => !/"(?:Analytics|Data Science|Product Analytics) Manager"/.test(shard.query)));
  assert.match(shards.find((shard) => shard.id === "analytics").query, /analytics OR "data analysis"/);
  assert.match(shards.find((shard) => shard.id === "science").query, /OR "Product Scientist"/);
  assert.match(shards.find((shard) => shard.id === "strategy").query, /OR "Business Manager"/);
  assert.match(shards.find((shard) => shard.id === "ai-product-operator").query, /OR "Context Engineer"/);
  assert.ok(shards.some((shard) => shard.query.includes("data engineering")));
});
