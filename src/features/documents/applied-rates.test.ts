import assert from "node:assert/strict";
import test from "node:test";

import { buildAppliedRateRows, formatAppliedRateValue } from "./applied-rates";

test("Ghana VAT applied components retain their names, percentages, and amounts", () => {
  const rows = buildAppliedRateRows({
    currency: "GHS",
    statutoryRates: [
      { code: "NHIL", name: "NHIL", rate: "2.500000", amount: "2.50" },
      { code: "GETFUND", name: "GETFund Levy", rate: "2.5", amount: "2.50" },
      { code: "VAT", name: "VAT", rate: "15.000000", amount: "15.00" },
    ],
  });

  assert.deepEqual(rows.map(({ label, amount }) => [label, amount]), [
    ["NHIL (2.5%)", "2.50"],
    ["GETFund Levy (2.5%)", "2.50"],
    ["VAT (15%)", "15.00"],
  ]);
});

test("Invoice and Receipt presentation includes only custom rates actually applied", () => {
  const configuredRates = [
    { name: "Service Levy", type: "PERCENTAGE" as const, value: "3", amount: "3.00" },
    { name: "Configured but unused", type: "PERCENTAGE" as const, value: "9", amount: "9.00" },
  ];
  const appliedByDocumentType = {
    INVOICE: configuredRates.slice(0, 1),
    RECEIPT: configuredRates.slice(0, 1),
  };

  for (const documentType of ["INVOICE", "RECEIPT"] as const) {
    const rows = buildAppliedRateRows({ currency: "GHS", customRates: appliedByDocumentType[documentType] });

    assert.deepEqual(rows.map(({ label, amount }) => [label, amount]), [["Service Levy (3%)", "3.00"]]);
    assert.equal(rows.some(({ name }) => name === "Configured but unused"), false);
  }
});

test("repeated exact custom rate applications aggregate stored line amounts without changing the rate", () => {
  const rows = buildAppliedRateRows({
    currency: "GHS",
    customRates: [
      { key: "line:1", name: "Service Levy", type: "PERCENTAGE", value: "3.000000", amount: "3.00" },
      { key: "line:2", name: "Service Levy", type: "PERCENTAGE", value: "3", amount: "1.50" },
      { key: "line:3", name: "Service Levy", type: "PERCENTAGE", value: "4", amount: "4.00" },
    ],
  });

  assert.deepEqual(rows.map(({ label, amount }) => [label, amount]), [
    ["Service Levy (3%)", "4.50"],
    ["Service Levy (4%)", "4.00"],
  ]);
});

test("fixed rates display the stored currency-aware value without unnecessary zeroes", () => {
  assert.equal(formatAppliedRateValue({ type: "FIXED", value: "12.500000", currency: "USD" }), "USD 12.5 fixed");
});
