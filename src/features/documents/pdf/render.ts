import "server-only";

import {
  degrees,
  PDFDocument,
  type PDFFont,
  type PDFPage,
  PageSizes,
  rgb,
} from "pdf-lib";

import type { IssuedDocumentPdfModel } from "./model";

const PAGE_WIDTH = PageSizes.A4[0];
const PAGE_HEIGHT = PageSizes.A4[1];
const MARGIN = 42;
const FOOTER_HEIGHT = 28;
const TEST_WARNING = "TEST DOCUMENT — NOT VALID";

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
  return `${currency} ${value}`;
}

function fitTextSize(value: string, font: PDFFont, preferred: number, minimum: number, maxWidth: number) {
  let size = preferred;
  while (size > minimum && font.widthOfTextAtSize(value, size) > maxWidth) size -= 0.5;
  return size;
}

export async function renderIssuedDocumentPdf(model: IssuedDocumentPdfModel) {
  const document = await PDFDocument.create();
  const regular = await document.embedFont("Helvetica");
  const bold = await document.embedFont("Helvetica-Bold");
  document.setTitle(`${model.title} ${model.number}`);
  document.setAuthor("CIV");
  document.setCreator("CIV server-side PDF service");
  document.setProducer("CIV");
  document.setSubject(model.isTestDocument ? TEST_WARNING : "Issued CIV document");
  document.setCreationDate(new Date(model.issuedAt));
  document.setModificationDate(new Date(model.issuedAt));

  let page: PDFPage = document.addPage(PageSizes.A4);
  let y = 0;
  let pageNumber = 0;

  const drawPageFurniture = () => {
    pageNumber += 1;
    page.drawText(`CIV · ${pdfSafeText(model.number, regular)}`, {
      x: MARGIN,
      y: 18,
      size: 8,
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
    if (model.isTestDocument) {
      page.drawText(TEST_WARNING, {
        x: 96,
        y: 305,
        size: 39,
        font: bold,
        color: colors.red,
        opacity: 0.08,
        rotate: degrees(34),
      });
      page.drawRectangle({
        x: 0,
        y: PAGE_HEIGHT - 30,
        width: PAGE_WIDTH,
        height: 30,
        color: colors.red,
      });
      const warningWidth = bold.widthOfTextAtSize(TEST_WARNING, 13);
      page.drawText(TEST_WARNING, {
        x: (PAGE_WIDTH - warningWidth) / 2,
        y: PAGE_HEIGHT - 20,
        size: 13,
        font: bold,
        color: colors.white,
      });
    }
  };

  const newPage = () => {
    page = document.addPage(PageSizes.A4);
    drawPageFurniture();
    y = PAGE_HEIGHT - MARGIN - (model.isTestDocument ? 24 : 0);
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

  const drawDetailLines = (lines: string[], x: number, startY: number, width: number) => {
    let detailY = startY;
    for (const line of lines.filter(Boolean)) {
      for (const wrapped of wrapText(line, regular, 9, width)) {
        page.drawText(wrapped, { x, y: detailY, size: 9, font: regular, color: colors.dark });
        detailY -= 12;
      }
    }
    return detailY;
  };

  const tableX = [MARGIN, MARGIN + 221, MARGIN + 271, MARGIN + 351, MARGIN + 431];
  const tableWidths = [221, 50, 80, 80, 80];
  const drawTableHeader = () => {
    ensureSpace(34);
    page.drawRectangle({ x: MARGIN, y: y - 24, width: PAGE_WIDTH - MARGIN * 2, height: 24, color: colors.pale });
    const headings = ["Description", "Qty", "Unit price", "Rate", "Total"];
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
  y = PAGE_HEIGHT - MARGIN - (model.isTestDocument ? 24 : 0);

  page.drawText("CIV", { x: MARGIN, y: y - 9, size: 18, font: bold, color: colors.blue });
  const title = model.title.toUpperCase();
  page.drawText(title, {
    x: PAGE_WIDTH - MARGIN - bold.widthOfTextAtSize(title, 18),
    y: y - 9,
    size: 18,
    font: bold,
    color: colors.dark,
  });
  y -= 36;
  const documentNumber = pdfSafeText(model.number, bold);
  const documentNumberSize = fitTextSize(documentNumber, bold, 15, 8, 260);
  page.drawText(documentNumber, { x: MARGIN, y, size: documentNumberSize, font: bold, color: colors.dark });
  const dateLabel = `Issue date: ${formatDate(model.issueDate)}`;
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
  if (model.isTestDocument) page.drawText(TEST_WARNING, { x: MARGIN, y, size: 9, font: bold, color: colors.red });
  y -= 18;
  drawRule();

  const leftX = MARGIN;
  const rightX = 320;
  const blockWidth = 230;
  const blockTop = y;
  drawLabel("From", leftX, blockTop);
  drawLabel("Customer", rightX, blockTop);
  const issuerLines = [
    model.issuer.legalName,
    model.issuer.tradingName && model.issuer.tradingName !== model.issuer.legalName ? `Trading as ${model.issuer.tradingName}` : "",
    model.issuer.address ?? "",
    model.issuer.email ?? "",
    model.issuer.phone ?? "",
    model.issuer.registrationNumber ? `Registration no.: ${model.issuer.registrationNumber}` : "",
    model.issuer.taxpayerId && model.issuer.taxpayerIdLabel ? `${model.issuer.taxpayerIdLabel}: ${model.issuer.taxpayerId}` : "",
    model.issuer.taxpayerVerificationStatus ? `Taxpayer status: ${model.issuer.taxpayerVerificationStatus === "VERIFIED" ? "Verified" : "Unverified"}` : "",
    model.issuer.vatRegistered === null ? "" : `VAT registered: ${model.issuer.vatRegistered ? "Yes" : "No"}`,
  ];
  const customerLines = model.customer ? [
    model.customer.name,
    model.customer.address ?? "",
    model.customer.email ?? "",
    model.customer.phone ?? "",
    model.customer.taxpayerId ? `Customer TIN/VAT no.: ${model.customer.taxpayerId}` : "",
  ] : ["Customer not recorded"];
  const issuerBottom = drawDetailLines(issuerLines, leftX, blockTop - 17, blockWidth);
  const customerBottom = drawDetailLines(customerLines, rightX, blockTop - 17, blockWidth);
  y = Math.min(issuerBottom, customerBottom) - 10;

  if (model.verificationCode) {
    const verificationLines = wrapText(model.verificationCode, bold, 9, PAGE_WIDTH - MARGIN * 2 - 100);
    ensureSpace(Math.max(30, verificationLines.length * 11 + 18));
    drawRule();
    drawLabel("Verification code", MARGIN, y + 2);
    verificationLines.forEach((line, index) => page.drawText(line, { x: MARGIN + 100, y: y + 1 - index * 11, size: 9, font: bold, color: colors.dark }));
    y -= Math.max(20, verificationLines.length * 11 + 8);
  }

  ensureSpace(50);
  drawTableHeader();
  for (const line of model.lines) {
    const description = line.rateName ? `${line.description}\nRate: ${line.rateName}` : line.description;
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

  const totalRows: Array<{ label: string; value: string; emphasis?: boolean }> = [
    { label: "Subtotal", value: model.totals.subtotal },
    ...(model.totals.discount !== "0.00" ? [{ label: "Discount", value: model.totals.discount }] : []),
    ...(model.totals.customRates !== "0.00" ? [{ label: "Custom rates", value: model.totals.customRates }] : []),
    ...(model.tax?.components.map((component) => ({
      label: `${component.name} (${component.rate}%)`,
      value: component.amount,
    })) ?? []),
    ...(model.tax ? [{ label: "Taxable base", value: model.totals.taxableValue }] : []),
    { label: "Grand total", value: model.totals.grandTotal, emphasis: true },
  ];
  const totalsHeight = totalRows.length * 20 + 28;
  ensureSpace(totalsHeight);
  y -= 14;
  const totalsX = 322;
  page.drawLine({ start: { x: totalsX, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 0.8, color: colors.line });
  y -= 19;
  for (const row of totalRows) {
    const rowFont = row.emphasis ? bold : regular;
    const size = row.emphasis ? 11 : 9;
    page.drawText(row.label, { x: totalsX, y, size, font: rowFont, color: colors.dark });
    const value = amount(model.currency, row.value);
    page.drawText(value, {
      x: PAGE_WIDTH - MARGIN - rowFont.widthOfTextAtSize(value, size),
      y,
      size,
      font: rowFont,
      color: colors.dark,
    });
    if (row.emphasis) {
      page.drawLine({ start: { x: totalsX, y: y + 16 }, end: { x: PAGE_WIDTH - MARGIN, y: y + 16 }, thickness: 1.2, color: colors.blue });
    }
    y -= 20;
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

  page.drawText(`Issued by ${pdfSafeText(model.issuedBy, regular)}`, {
    x: MARGIN,
    y: 34,
    size: 7.5,
    font: regular,
    color: colors.muted,
  });

  return document.save({ useObjectStreams: false });
}

export { TEST_WARNING };
