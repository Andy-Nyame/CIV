import "server-only";

import {
  degrees,
  PDFDocument,
  type PDFFont,
  type PDFPage,
  PageSizes,
  rgb,
} from "pdf-lib";

import { renderVerificationBarcodePng } from "@/features/documents/verification/barcode";

import type { DocumentPdfModel, IssuedDocumentPdfModel } from "./model";

const PAGE_WIDTH = PageSizes.A4[0];
const PAGE_HEIGHT = PageSizes.A4[1];
const MARGIN = 42;
const FOOTER_HEIGHT = 28;
const TEST_WARNING = "TEST DOCUMENT — NOT VALID";
const DRAFT_WARNING = "DRAFT — NOT ISSUED";
const VOID_WARNING = "VOID — NOT VALID";
const CIV_FOOTER = "Generated with CIV · Create · Issue · Verify";

const colors = {
  blue: rgb(0.05, 0.25, 0.5),
  dark: rgb(0.09, 0.12, 0.17),
  muted: rgb(0.36, 0.4, 0.46),
  pale: rgb(0.94, 0.96, 0.98),
  line: rgb(0.82, 0.85, 0.89),
  red: rgb(0.72, 0.05, 0.08),
  white: rgb(1, 1, 1),
};

function pdfSafeText(value: string, font: PDFFont) {
  let safe = "";
  for (const character of value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").replaceAll("\t", " ")) {
    if (character === "\n") {
      safe += character;
      continue;
    }
    try {
      font.encodeText(character);
      safe += character;
    } catch {
      safe += "?";
    }
  }
  return safe;
}

function wrapText(value: string, font: PDFFont, size: number, maxWidth: number) {
  const safe = pdfSafeText(value, font);
  const lines: string[] = [];
  for (const paragraph of safe.split("\n")) {
    if (!paragraph) {
      lines.push("");
      continue;
    }
    const words = paragraph.split(/\s+/);
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);
      if (font.widthOfTextAtSize(word, size) <= maxWidth) {
        current = word;
        continue;
      }
      let fragment = "";
      for (const character of word) {
        if (fragment && font.widthOfTextAtSize(fragment + character, size) > maxWidth) {
          lines.push(fragment);
          fragment = character;
        } else {
          fragment += character;
        }
      }
      current = fragment;
    }
    if (current) lines.push(current);
  }
  return lines.length ? lines : [""];
}

function formatDate(value: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat("en-GH", { dateStyle: "medium", timeZone: "UTC" }).format(parsed);
}

function amount(currency: string, value: string) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return `${currency} ${value}`;
  return `${currency} ${new Intl.NumberFormat("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numericValue)}`;
}

export type PdfTotalRow = { label: string; value: string; emphasis?: boolean };

export function buildPdfPageWarnings(model: DocumentPdfModel) {
  return [
    ...(model.isTestDocument ? [TEST_WARNING] : []),
    ...(model.lifecycle === "DRAFT" ? [DRAFT_WARNING] : []),
    ...(model.isVoided ? [VOID_WARNING] : []),
  ];
}

export function buildPdfTotalRows(model: DocumentPdfModel): PdfTotalRow[] {
  return [
    ...(model.totals.originalAmount !== "0.00" && model.totals.discount !== "0.00" ? [{ label: "Original amount", value: model.totals.originalAmount }] : []),
    ...(model.totals.discount !== "0.00" ? [{ label: "Discount", value: model.totals.discount }] : []),
    { label: model.totals.discount !== "0.00" ? "Post-discount base" : "Subtotal", value: model.totals.subtotal },
    ...(model.totals.standardRatedValue !== "0.00" ? [{ label: "Standard-rated value", value: model.totals.standardRatedValue }] : []),
    ...(model.totals.zeroRatedValue !== "0.00" ? [{ label: "Zero-rated value", value: model.totals.zeroRatedValue }] : []),
    ...(model.totals.exemptValue !== "0.00" ? [{ label: "Exempt value", value: model.totals.exemptValue }] : []),
    ...(model.totals.relievedValue !== "0.00" ? [{ label: "Relieved value", value: model.totals.relievedValue }] : []),
    ...model.appliedRates.map((rate) => ({ label: rate.label, value: rate.amount })),
    ...(model.totals.trustedTax !== "0.00" ? [{ label: "Total statutory tax", value: model.totals.trustedTax }] : []),
    ...(model.tax ? [{ label: "Total tax-inclusive value", value: model.totals.totalTaxInclusiveValue }] : []),
    { label: "Grand total", value: model.totals.grandTotal, emphasis: !model.totals.withholding },
    ...(model.totals.withholding ? [{
      label: `VAT withholding credit (${model.totals.withholding.reference}${model.totals.withholding.date ? ` · ${model.totals.withholding.date}` : ""})`,
      value: model.totals.withholding.amount,
    }] : []),
    ...(model.totals.withholding && model.totals.netPayable ? [{ label: "Net amount payable / settled", value: model.totals.netPayable, emphasis: true }] : []),
  ];
}

function fitTextSize(value: string, font: PDFFont, preferred: number, minimum: number, maxWidth: number) {
  let size = preferred;
  while (size > minimum && font.widthOfTextAtSize(value, size) > maxWidth) size -= 0.5;
  return size;
}

export async function renderDocumentPdf(
  model: DocumentPdfModel,
  assets: { logoImage?: Uint8Array | null } = {},
) {
  const document = await PDFDocument.create();
  const regular = await document.embedFont("Helvetica");
  const bold = await document.embedFont("Helvetica-Bold");
  const verificationCode = model.lifecycle === "ISSUED" ? model.verificationCode : null;
  const verificationBarcode = verificationCode
    ? await renderVerificationBarcodePng(verificationCode)
    : null;
  const logoImage = assets.logoImage
    ? await document.embedPng(assets.logoImage).catch(() => null)
    : null;
  document.setTitle(`${model.title} ${model.number}`);
  document.setAuthor("CIV");
  document.setCreator("CIV server-side PDF service");
  document.setProducer("CIV");
  const subject = [
    ...(model.lifecycle === "DRAFT" ? [DRAFT_WARNING] : []),
    ...(model.isTestDocument ? [TEST_WARNING] : []),
    ...(model.isVoided ? [VOID_WARNING] : []),
  ].join(" · ") || "Issued CIV document";
  document.setSubject(subject);
  document.setKeywords(model.lifecycle === "DRAFT"
    ? ["CIV", "draft document"]
    : ["CIV", "document verification", ...(verificationCode ? [verificationCode] : [])]);
  const documentDate = new Date(model.issuedAt ?? `${model.issueDate}T00:00:00.000Z`);
  document.setCreationDate(documentDate);
  document.setModificationDate(documentDate);

  let page: PDFPage = document.addPage(PageSizes.A4);
  let y = 0;
  let pageNumber = 0;

  const warnings = buildPdfPageWarnings(model).map((text) => ({
    text,
    color: text === TEST_WARNING || text === VOID_WARNING ? colors.red : colors.blue,
  }));
  const contentTop = () => PAGE_HEIGHT - MARGIN - warnings.length * 27;

  const drawPageFurniture = () => {
    pageNumber += 1;
    page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: colors.white });
    page.drawText(CIV_FOOTER, {
      x: MARGIN,
      y: 18,
      size: 7.5,
      font: regular,
      color: colors.muted,
    });
    const pageLabel = `Page ${pageNumber}`;
    page.drawText(pageLabel, {
      x: PAGE_WIDTH - MARGIN - regular.widthOfTextAtSize(pageLabel, 8),
      y: 18,
      size: 8,
      font: regular,
      color: colors.muted,
    });
    warnings.forEach((warning, index) => {
      const bandBottom = PAGE_HEIGHT - 27 * (index + 1);
      page.drawRectangle({
        x: 0,
        y: bandBottom,
        width: PAGE_WIDTH,
        height: 27,
        color: warning.color,
      });
      const warningWidth = bold.widthOfTextAtSize(warning.text, 12);
      page.drawText(warning.text, {
        x: (PAGE_WIDTH - warningWidth) / 2,
        y: bandBottom + 8,
        size: 12,
        font: bold,
        color: colors.white,
      });
    });
    if (model.isTestDocument) {
      page.drawText(TEST_WARNING, {
        x: 96,
        y: 300,
        size: 39,
        font: bold,
        color: colors.red,
        opacity: 0.08,
        rotate: degrees(34),
      });
    }
    if (model.lifecycle === "DRAFT") page.drawText(DRAFT_WARNING, {
      x: 108,
      y: 430,
      size: 43,
      font: bold,
      color: colors.blue,
      opacity: 0.07,
      rotate: degrees(34),
    });
  };

  const newPage = () => {
    page = document.addPage(PageSizes.A4);
    drawPageFurniture();
    y = contentTop();
  };

  const ensureSpace = (height: number) => {
    if (y - height < FOOTER_HEIGHT + MARGIN) newPage();
  };

  const drawRule = () => {
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 0.7, color: colors.line });
    y -= 14;
  };

  const drawLabel = (label: string, x: number, labelY: number) => {
    page.drawText(label.toUpperCase(), { x, y: labelY, size: 7.5, font: bold, color: colors.blue });
  };

  const wrapDetailLines = (lines: string[], width: number) => lines
    .filter(Boolean)
    .flatMap((line) => wrapText(line, regular, 9, width));

  const tableX = [MARGIN, MARGIN + 221, MARGIN + 271, MARGIN + 351, MARGIN + 431];
  const tableWidths = [221, 50, 80, 80, 80];
  const drawTableHeader = () => {
    ensureSpace(34);
    page.drawRectangle({ x: MARGIN, y: y - 24, width: PAGE_WIDTH - MARGIN * 2, height: 24, color: colors.pale });
    const headings = ["Description", "Qty", "Unit price", "Rate amount", "Total"];
    headings.forEach((heading, index) => {
      const width = bold.widthOfTextAtSize(heading, 8);
      page.drawText(heading, {
        x: index === 0 ? tableX[index]! + 6 : tableX[index]! + tableWidths[index]! - width - 6,
        y: y - 16,
        size: 8,
        font: bold,
        color: colors.muted,
      });
    });
    y -= 24;
  };

  const drawRight = (value: string, column: number, rowY: number, font: PDFFont = regular) => {
    const safe = pdfSafeText(value, font);
    const size = fitTextSize(safe, font, 8.5, 5.5, tableWidths[column]! - 12);
    page.drawText(safe, {
      x: tableX[column]! + tableWidths[column]! - font.widthOfTextAtSize(safe, size) - 6,
      y: rowY,
      size,
      font,
      color: colors.dark,
    });
  };

  drawPageFurniture();
  y = contentTop();

  const identityName = model.issuer.tradingName ?? model.issuer.legalName;
  let identityX = MARGIN;
  if (logoImage) {
    const logoScale = Math.min(52 / logoImage.width, 46 / logoImage.height);
    const logoWidth = logoImage.width * logoScale;
    const logoHeight = logoImage.height * logoScale;
    page.drawImage(logoImage, { x: MARGIN, y: y - logoHeight + 3, width: logoWidth, height: logoHeight });
    identityX += logoWidth + 12;
  }
  const identityLines = wrapText(identityName, bold, 12, 270 - (identityX - MARGIN)).slice(0, 3);
  identityLines.forEach((line, index) => page.drawText(line, {
    x: identityX,
    y: y - 5 - index * 14,
    size: 12,
    font: bold,
    color: colors.dark,
  }));
  const title = model.title.toUpperCase();
  page.drawText(title, {
    x: PAGE_WIDTH - MARGIN - bold.widthOfTextAtSize(title, 18),
    y: y - 5,
    size: 18,
    font: bold,
    color: colors.blue,
  });
  if (model.lifecycle === "DRAFT") {
    const draftLabel = "DRAFT PREVIEW";
    page.drawText(draftLabel, {
      x: PAGE_WIDTH - MARGIN - bold.widthOfTextAtSize(draftLabel, 8),
      y: y - 20,
      size: 8,
      font: bold,
      color: colors.red,
    });
  }
  y -= 58;
  drawRule();
  drawLabel(model.lifecycle === "DRAFT" ? "Draft reference" : "Document number", MARGIN, y + 1);
  y -= 16;
  const documentNumber = pdfSafeText(model.number, bold);
  const documentNumberSize = fitTextSize(documentNumber, bold, 15, 8, 260);
  page.drawText(documentNumber, { x: MARGIN, y, size: documentNumberSize, font: bold, color: colors.dark });
  const dateLabel = `${model.lifecycle === "DRAFT" ? "Draft" : "Issue"} date: ${formatDate(model.issueDate)}`;
  page.drawText(dateLabel, {
    x: PAGE_WIDTH - MARGIN - regular.widthOfTextAtSize(dateLabel, 9),
    y: y + 2,
    size: 9,
    font: regular,
    color: colors.muted,
  });
  y -= 18;
  if (model.dueDate) {
    const dueLabel = `Due date: ${formatDate(model.dueDate)}`;
    page.drawText(dueLabel, {
      x: PAGE_WIDTH - MARGIN - regular.widthOfTextAtSize(dueLabel, 9),
      y,
      size: 9,
      font: regular,
      color: colors.muted,
    });
  }
  y -= 17;
  const transactionDetails = [
    model.issuedAt ? `Issued at: ${new Date(model.issuedAt).toLocaleString("en-GH", { timeZone: "Africa/Accra" })}` : null,
    model.supplyDateTime ? `Supply: ${new Date(model.supplyDateTime).toLocaleString("en-GH", { timeZone: "Africa/Accra" })}` : model.supplyDate ? `Supply date: ${formatDate(model.supplyDate)}` : null,
    model.taxPointDateTime ? `Tax point: ${new Date(model.taxPointDateTime).toLocaleString("en-GH", { timeZone: "Africa/Accra" })}` : null,
    `Transaction: ${model.transactionType.replaceAll("_", " ").toLowerCase()}`,
    model.title === "Receipt" ? `Receipt class: ${model.receiptType === "VAT_SALES_RECEIPT" ? model.isTestDocument ? "VAT sales receipt simulation" : "Authorized VAT sales receipt" : "Commercial receipt"}` : null,
    `Prices: ${model.priceMode === "TAX_INCLUSIVE" ? "Tax inclusive" : "Tax exclusive"}`,
  ].filter(Boolean).join(" · ");
  const transactionSize = fitTextSize(transactionDetails, regular, 8.5, 6, PAGE_WIDTH - MARGIN * 2);
  page.drawText(transactionDetails, { x: MARGIN, y, size: transactionSize, font: regular, color: colors.muted });
  y -= 18;
  if (model.adjustment) {
    const adjustment = `${model.adjustment.direction === "REDUCE" ? "Credit against" : "Debit against"} ${model.adjustment.originalDocumentNumber} (${formatDate(model.adjustment.originalIssueDate)}) · Reason: ${model.adjustment.reason}`;
    const adjustmentLines = wrapText(adjustment, bold, 8.5, PAGE_WIDTH - MARGIN * 2);
    ensureSpace(adjustmentLines.length * 11 + 8);
    adjustmentLines.forEach((line, index) => page.drawText(line, { x: MARGIN, y: y - index * 11, size: 8.5, font: bold, color: colors.dark }));
    y -= adjustmentLines.length * 11 + 7;
    const values = `Original supply value: ${amount(model.currency, model.adjustment.originalSupplyValue)} · Corrected supply value: ${amount(model.currency, model.adjustment.adjustedSupplyValue)} · Difference: ${amount(model.currency, model.adjustment.difference)} · Tax attributable: ${amount(model.currency, model.adjustment.taxAttributable)}`;
    const valueLines = wrapText(values, regular, 8, PAGE_WIDTH - MARGIN * 2);
    valueLines.forEach((line, index) => page.drawText(line, { x: MARGIN, y: y - index * 10, size: 8, font: regular, color: colors.muted }));
    y -= valueLines.length * 10 + 5;
  }
  if (model.servicePeriod) {
    const period = `Service / rental period: ${new Date(model.servicePeriod.start).toLocaleString("en-GH", { timeZone: "Africa/Accra" })} to ${new Date(model.servicePeriod.end).toLocaleString("en-GH", { timeZone: "Africa/Accra" })}`;
    const periodLines = wrapText(period, regular, 8, PAGE_WIDTH - MARGIN * 2);
    periodLines.forEach((line, index) => page.drawText(line, { x: MARGIN, y: y - index * 10, size: 8, font: regular, color: colors.muted }));
    y -= periodLines.length * 10 + 5;
  }
  const fiscalText = `Fiscal status: ${model.fiscalizationLabel}. CIV verification is separate from GRA certification.`;
  const fiscalFont = model.fiscalizationLabel === "GRA Certified" ? bold : regular;
  const fiscalLines = wrapText(fiscalText, fiscalFont, 8, PAGE_WIDTH - MARGIN * 2);
  fiscalLines.forEach((line, index) => page.drawText(line, { x: MARGIN, y: y - index * 10, size: 8, font: fiscalFont, color: model.fiscalizationLabel === "GRA Certified" ? colors.dark : colors.red }));
  y -= fiscalLines.length * 10 + 5;
  drawRule();

  const leftX = MARGIN;
  const rightX = 320;
  const blockWidth = 230;
  const issuerLines = [
    model.issuer.legalName,
    model.issuer.tradingName && model.issuer.tradingName !== model.issuer.legalName ? `Trading as ${model.issuer.tradingName}` : "",
    model.issuer.address ?? "",
    model.issuer.email ?? "",
    model.issuer.phone ?? "",
    model.issuer.registrationNumber ? `Registration no.: ${model.issuer.registrationNumber}` : "",
    model.issuer.taxpayerId && model.issuer.taxpayerIdLabel ? `${model.issuer.taxpayerIdLabel}: ${model.issuer.taxpayerId}` : "",
    model.issuer.taxpayerVerificationStatus ? `Taxpayer status: ${model.issuer.taxpayerVerificationStatus === "VERIFIED" ? "Verified" : "Unverified"}` : "",
    model.issuer.vatRegistrationStatus ? `VAT status: ${model.issuer.vatRegistrationStatus.replaceAll("_", " ").toLowerCase()}` : model.issuer.vatRegistered === null ? "" : `VAT registered: ${model.issuer.vatRegistered ? "Yes" : "No"}`,
  ];
  const customerLines = model.customer ? [
    model.customer.name,
    model.customer.address ?? "",
    model.customer.email ?? "",
    model.customer.phone ?? "",
    model.customer.taxpayerId && model.customer.taxpayerIdLabel ? `${model.customer.taxpayerIdLabel}: ${model.customer.taxpayerId}` : "",
    model.customer.vatRegistrationStatus ? `Recorded VAT status: ${model.customer.vatRegistrationStatus.replaceAll("_", " ").toLowerCase()}` : "",
  ] : ["Customer not recorded"];
  const issuerDetails = wrapDetailLines(issuerLines, blockWidth);
  const customerDetails = wrapDetailLines(customerLines, blockWidth);
  let issuerOffset = 0;
  let customerOffset = 0;
  let detailPage = 0;
  while (issuerOffset < issuerDetails.length || customerOffset < customerDetails.length) {
    if (y < FOOTER_HEIGHT + MARGIN + 45) newPage();
    drawLabel(detailPage ? "From (continued)" : "From", leftX, y);
    drawLabel(detailPage ? "Customer (continued)" : "Customer", rightX, y);
    y -= 17;
    const fits = Math.max(1, Math.floor((y - FOOTER_HEIGHT - MARGIN - 8) / 12));
    const issuerFragment = issuerDetails.slice(issuerOffset, issuerOffset + fits);
    const customerFragment = customerDetails.slice(customerOffset, customerOffset + fits);
    const fragmentLength = Math.max(issuerFragment.length, customerFragment.length, 1);
    issuerFragment.forEach((line, index) => page.drawText(line, { x: leftX, y: y - index * 12, size: 9, font: regular, color: colors.dark }));
    customerFragment.forEach((line, index) => page.drawText(line, { x: rightX, y: y - index * 12, size: 9, font: regular, color: colors.dark }));
    issuerOffset += issuerFragment.length;
    customerOffset += customerFragment.length;
    y -= fragmentLength * 12 + 10;
    detailPage += 1;
    if (issuerOffset < issuerDetails.length || customerOffset < customerDetails.length) newPage();
  }

  ensureSpace(50);
  drawTableHeader();
  for (const line of model.lines) {
    const treatment = line.relief
      ? `Tax treatment: Relieved standard-rated · ${line.relief.reason} · Ref ${line.relief.reference}`
      : `Tax treatment: ${line.taxTreatment.replaceAll("_", " ").toLowerCase()}${line.taxTreatmentReason ? ` · ${line.taxTreatmentReason}` : ""}${line.taxTreatmentReference ? ` · Ref ${line.taxTreatmentReference}` : ""}`;
    const details = [
      line.description,
      line.unitOfMeasure ? `Unit: ${line.unitOfMeasure}` : null,
      treatment,
      line.discount !== "0.00" ? `Discount: ${amount(model.currency, line.discount)}` : null,
      `Base: ${amount(model.currency, line.taxableBase)}`,
      line.taxAmount !== "0.00" ? `Statutory tax: ${amount(model.currency, line.taxAmount)}` : null,
      line.rateLabel ? `Custom rate: ${line.rateLabel}` : null,
    ].filter(Boolean).join("\n");
    const description = details;
    const descriptionLines = wrapText(description, regular, 8.5, tableWidths[0]! - 12);
    let offset = 0;
    let firstFragment = true;
    while (offset < descriptionLines.length) {
      const availableLines = Math.max(1, Math.floor((y - FOOTER_HEIGHT - MARGIN - 14) / 11));
      if (availableLines < 1 || y < FOOTER_HEIGHT + MARGIN + 28) {
        newPage();
        drawTableHeader();
      }
      const fits = Math.max(1, Math.floor((y - FOOTER_HEIGHT - MARGIN - 14) / 11));
      const fragment = descriptionLines.slice(offset, offset + fits);
      const rowHeight = Math.max(27, fragment.length * 11 + 12);
      if (y - rowHeight < FOOTER_HEIGHT + MARGIN) {
        newPage();
        drawTableHeader();
        continue;
      }
      const textY = y - 17;
      fragment.forEach((description, index) => {
        page.drawText(description, { x: tableX[0]! + 6, y: textY - index * 11, size: 8.5, font: regular, color: colors.dark });
      });
      if (firstFragment) {
        drawRight(line.quantity, 1, textY);
        drawRight(amount(model.currency, line.unitPrice), 2, textY);
        drawRight(line.rateAmount ? amount(model.currency, line.rateAmount) : "—", 3, textY);
        drawRight(amount(model.currency, line.total), 4, textY, bold);
      }
      page.drawLine({ start: { x: MARGIN, y: y - rowHeight }, end: { x: PAGE_WIDTH - MARGIN, y: y - rowHeight }, thickness: 0.5, color: colors.line });
      y -= rowHeight;
      offset += fragment.length;
      firstFragment = false;
      if (offset < descriptionLines.length) {
        newPage();
        drawTableHeader();
      }
    }
  }

  const totalRows = buildPdfTotalRows(model);
  const totalsX = 322;
  const totalsLabelWidth = 125;
  const preparedTotalRows = totalRows.map((row) => {
    const rowFont = row.emphasis ? bold : regular;
    const size = row.emphasis ? 11 : 9;
    const labelLines = wrapText(row.label, rowFont, size, totalsLabelWidth);
    return { ...row, rowFont, size, labelLines, height: Math.max(20, labelLines.length * (size + 2) + 7) };
  });
  const totalsHeight = preparedTotalRows.reduce((sum, row) => sum + row.height, 28);
  if (totalsHeight < contentTop() - FOOTER_HEIGHT - MARGIN) ensureSpace(totalsHeight);
  else ensureSpace(48);
  y -= 14;
  page.drawLine({ start: { x: totalsX, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 0.8, color: colors.line });
  y -= 19;
  for (const row of preparedTotalRows) {
    ensureSpace(row.height);
    row.labelLines.forEach((label, index) => page.drawText(label, {
      x: totalsX,
      y: y - index * (row.size + 2),
      size: row.size,
      font: row.rowFont,
      color: colors.dark,
    }));
    const value = amount(model.currency, row.value);
    const valueSize = fitTextSize(value, row.rowFont, row.size, 6, PAGE_WIDTH - MARGIN - totalsX - totalsLabelWidth - 8);
    page.drawText(value, {
      x: PAGE_WIDTH - MARGIN - row.rowFont.widthOfTextAtSize(value, valueSize),
      y,
      size: valueSize,
      font: row.rowFont,
      color: colors.dark,
    });
    if (row.emphasis) {
      page.drawLine({ start: { x: totalsX, y: y + 16 }, end: { x: PAGE_WIDTH - MARGIN, y: y + 16 }, thickness: 1.2, color: colors.blue });
    }
    y -= row.height;
  }

  if (model.notes) {
    const noteLines = wrapText(model.notes, regular, 9, PAGE_WIDTH - MARGIN * 2);
    let offset = 0;
    while (offset < noteLines.length) {
      ensureSpace(42);
      if (offset === 0) {
        y -= 4;
        drawLabel("Notes / terms", MARGIN, y);
        y -= 17;
      }
      const fits = Math.max(1, Math.floor((y - FOOTER_HEIGHT - MARGIN) / 12));
      const fragment = noteLines.slice(offset, offset + fits);
      for (const noteLine of fragment) {
        page.drawText(noteLine, { x: MARGIN, y, size: 9, font: regular, color: colors.dark });
        y -= 12;
      }
      offset += fragment.length;
      if (offset < noteLines.length) {
        newPage();
        drawLabel("Notes / terms (continued)", MARGIN, y);
        y -= 17;
      }
    }
  }

  if (model.payments.length) {
    ensureSpace(40);
    y -= 4;
    drawLabel("Recorded payment events", MARGIN, y);
    y -= 17;
    for (const payment of model.payments) {
      ensureSpace(14);
      const paymentText = `${new Date(payment.occurredAt).toLocaleString("en-GH", { timeZone: "Africa/Accra" })} · ${amount(model.currency, payment.amount)}${payment.method ? ` · ${payment.method}` : ""}${payment.reference ? ` · Ref ${payment.reference}` : ""}${payment.isPartial ? " · Partial" : ""}`;
      page.drawText(pdfSafeText(paymentText, regular), { x: MARGIN, y, size: fitTextSize(paymentText, regular, 8, 5.5, PAGE_WIDTH - MARGIN * 2), font: regular, color: colors.dark });
      y -= 14;
    }
  }

  if (model.isVoided) {
    ensureSpace(48);
    y -= 6;
    drawLabel("Void record", MARGIN, y);
    y -= 17;
    const voidText = `Voided${model.voidedAt ? ` ${new Date(model.voidedAt).toLocaleString("en-GH", { timeZone: "Africa/Accra" })}` : ""}${model.voidReason ? ` · Reason: ${model.voidReason}` : ""}. The original immutable financial record is retained.`;
    for (const line of wrapText(voidText, bold, 8.5, PAGE_WIDTH - MARGIN * 2)) {
      ensureSpace(12);
      page.drawText(line, { x: MARGIN, y, size: 8.5, font: bold, color: colors.red });
      y -= 12;
    }
  }

  if (model.lifecycle === "ISSUED") {
    ensureSpace(verificationCode ? (verificationBarcode ? 106 : 58) : 42);
    y -= 8;
    drawRule();
    drawLabel("CIV verification", MARGIN, y);
    y -= 17;
    if (verificationCode) {
      if (verificationBarcode) {
        const barcodeImage = await document.embedPng(verificationBarcode.bytes);
        const scale = Math.min(300 / barcodeImage.width, 48 / barcodeImage.height, 1);
        const width = barcodeImage.width * scale;
        const height = barcodeImage.height * scale;
        page.drawImage(barcodeImage, { x: MARGIN, y: y - height, width, height });
        y -= height + 8;
      }
      page.drawText(`Verification Code: ${pdfSafeText(verificationCode, bold)}`, { x: MARGIN, y, size: 9, font: bold, color: colors.dark });
      y -= 13;
      page.drawText("Verify this CIV document identity using the code above. This does not mean GRA certification.", { x: MARGIN, y, size: 8, font: regular, color: colors.muted });
      y -= 14;
    } else {
      page.drawText("Verification code unavailable for this historical document.", { x: MARGIN, y, size: 8.5, font: regular, color: colors.muted });
      y -= 14;
    }
  }

  ensureSpace(28);
  y -= 6;
  const actorLabel = `${model.lifecycle === "DRAFT" ? "Prepared" : "Issued"} by ${pdfSafeText(model.preparedBy, regular)}`;
  page.drawText(actorLabel, { x: MARGIN, y, size: 7.5, font: regular, color: colors.muted });

  return document.save({ useObjectStreams: false });
}

export function renderIssuedDocumentPdf(model: IssuedDocumentPdfModel, assets: { logoImage?: Uint8Array | null } = {}) {
  return renderDocumentPdf(model, assets);
}

export { DRAFT_WARNING, TEST_WARNING, VOID_WARNING };
