/**
 * Pure mapping/normalize checks (no DB, no PII).
 */
import assert from "node:assert/strict";
import { extractContactIntelRow, guessContactIntelMapping, isValidContactIntelExtract } from "../src/lib/contact-intel/mapping";
import { parseContactIntelCsv } from "../src/lib/contact-intel/parse";

const csv = [
  "Email Address,Mobile,Full Name,Notes",
  "Alex@Example.com,501-555-0100,Alex Example,keep me",
  ",(501) 555-0199,Pat PhoneOnly,phone only",
  "not-an-email,,No Identifier,drop",
].join("\n");

const parsed = parseContactIntelCsv(csv);
assert.equal(parsed.headers[0], "Email Address");
assert.equal(parsed.rows.length, 3);

const mapping = guessContactIntelMapping(parsed.headers);
assert.equal(mapping.columns["Email Address"], "email");
assert.equal(mapping.columns.Mobile, "phone");
assert.equal(mapping.columns["Full Name"], "full_name");
assert.equal(mapping.columns.Notes, "ignore");

const row0 = extractContactIntelRow(parsed.rows[0]!, mapping);
assert.equal(row0.emails[0]?.normalized, "alex@example.com");
assert.equal(row0.phones[0]?.normalized, "5015550100");
assert.equal(isValidContactIntelExtract(row0), true);

const row1 = extractContactIntelRow(parsed.rows[1]!, mapping);
assert.equal(row1.emails.length, 0);
assert.equal(isValidContactIntelExtract(row1), true);

const row2 = extractContactIntelRow(parsed.rows[2]!, mapping);
assert.equal(isValidContactIntelExtract(row2), false);

console.log("contact-intel normalize check passed");
