import "server-only";

import {
  calculateLayoutManifestChecksum,
  documentTemplateLayoutManifestSchema,
  type BuiltInTemplateCode,
  type DocumentTemplateLayoutManifest,
} from "./manifest";

type BuiltInTemplateDefinition = Readonly<{
  code: BuiltInTemplateCode;
  name: string;
  description: string;
  version: 1;
  layoutSchemaVersion: 1;
  rendererCompatibilityVersion: 1;
  manifest: DocumentTemplateLayoutManifest;
  checksum: string;
}>;

type PositionedField = DocumentTemplateLayoutManifest["fields"][number];
type TextField = Extract<PositionedField, { kind: "TEXT" }>;

const regular: TextField["style"] = {
  font: "CIV_SANS" as const,
  weight: "REGULAR" as const,
  fontSizeHundredths: 900,
  lineHeightPermille: 1250,
  align: "LEFT" as const,
  color: "#172033",
  backgroundColor: null,
  padding: 40,
};

function text(
  field: TextField["field"],
  x: number,
  y: number,
  width: number,
  height: number,
  overrides: Partial<TextField["style"]> = {},
): TextField {
  return {
    kind: "TEXT" as const,
    field,
    box: { x, y, width, height },
    pageRole: "ALL" as const,
    style: { ...regular, ...overrides },
  };
}

function makeManifest(accent: string, variant: "STANDARD" | "MODERN" | "COMPACT") {
  const compact = variant === "COMPACT";
  const modern = variant === "MODERN";
  const lineTop = compact ? 2800 : 3400;
  const lineHeight = compact ? 4400 : 3800;
  const totalsTop = lineTop + lineHeight + 180;
  const fields: DocumentTemplateLayoutManifest["fields"] = [
    {
      kind: "IMAGE",
      field: "issuer.logo",
      box: { x: 500, y: 450, width: modern ? 1500 : 1200, height: 900 },
      pageRole: "FIRST",
      fit: "CONTAIN",
      opacityPermille: 1000,
    },
    text("issuer.identity", modern ? 2200 : 1850, 450, modern ? 4300 : 4650, 550, {
      weight: "BOLD",
      fontSizeHundredths: modern ? 1800 : 1600,
      color: accent,
    }),
    text("issuer.contact", modern ? 2200 : 1850, 1030, modern ? 4300 : 4650, 650),
    text("document.type", 7000, 450, 2500, 500, {
      weight: "BOLD",
      fontSizeHundredths: 1500,
      align: "RIGHT",
      color: accent,
    }),
    text("document.officialNumber", 7000, 980, 2500, 350, { align: "RIGHT" }),
    text("document.issueDate", 7000, 1380, 2500, 320, { align: "RIGHT" }),
    text("document.dueDate", 7000, 1740, 2500, 320, { align: "RIGHT" }),
    text("customer.details", 500, compact ? 1850 : 2250, 4800, compact ? 700 : 850, {
      weight: "MEDIUM",
      backgroundColor: modern ? "#F0F4FF" : null,
      padding: modern ? 120 : 40,
    }),
    text("totals.subtotal", 5900, totalsTop, 3600, 330, { align: "RIGHT" }),
    text("tax.nhil", 5900, totalsTop + 360, 3600, 300, { align: "RIGHT" }),
    text("tax.getfund", 5900, totalsTop + 690, 3600, 300, { align: "RIGHT" }),
    text("tax.taxableValue", 5900, totalsTop + 1020, 3600, 300, { align: "RIGHT" }),
    text("tax.vat", 5900, totalsTop + 1350, 3600, 300, { align: "RIGHT" }),
    text("totals.grandTotal", 5900, totalsTop + 1710, 3600, 480, {
      weight: "BOLD",
      fontSizeHundredths: 1300,
      align: "RIGHT",
      color: accent,
      backgroundColor: modern ? "#F0F4FF" : null,
    }),
    text("document.notes", 500, totalsTop, 4800, 1450, { fontSizeHundredths: 850 }),
    {
      kind: "IMAGE",
      field: "issuer.signature",
      box: { x: 500, y: 8650, width: 2300, height: 650 },
      pageRole: "FINAL",
      fit: "CONTAIN",
      opacityPermille: 1000,
    },
    {
      kind: "RESERVED",
      field: "verification.block",
      box: { x: 7600, y: 8550, width: 1900, height: 1000 },
      pageRole: "FINAL",
      quietZone: 120,
    },
  ];

  return documentTemplateLayoutManifestSchema.parse({
    manifestVersion: 1,
    page: {
      size: "A4",
      orientation: "PORTRAIT",
      safeArea: { x: 400, y: 350, width: 9200, height: 9300 },
    },
    fields,
    lineTable: {
      field: "lines.table",
      box: { x: 500, y: lineTop, width: 9000, height: lineHeight },
      pageRole: "ALL",
      headerHeight: compact ? 350 : 420,
      minimumRowHeight: compact ? 260 : 330,
      maximumRowHeight: compact ? 700 : 900,
      cellPadding: compact ? 55 : 80,
      fontSizeHundredths: compact ? 800 : 900,
      repeatHeader: true,
      wrapDescriptions: true,
      columns: [
        { column: "DESCRIPTION", widthBasisPoints: 4600, align: "LEFT" },
        { column: "QUANTITY", widthBasisPoints: 1100, align: "CENTER" },
        { column: "UNIT_PRICE", widthBasisPoints: 1500, align: "RIGHT" },
        { column: "RATE", widthBasisPoints: 1100, align: "RIGHT" },
        { column: "TOTAL", widthBasisPoints: 1700, align: "RIGHT" },
      ],
    },
  });
}

function definition(
  code: BuiltInTemplateCode,
  name: string,
  description: string,
  accent: string,
  variant: "STANDARD" | "MODERN" | "COMPACT",
): BuiltInTemplateDefinition {
  const manifest = makeManifest(accent, variant);
  return Object.freeze({
    code,
    name,
    description,
    version: 1,
    layoutSchemaVersion: 1,
    rendererCompatibilityVersion: 1,
    manifest,
    checksum: calculateLayoutManifestChecksum(manifest),
  });
}

export const BUILT_IN_TEMPLATE_DEFINITIONS = Object.freeze([
  definition("CIV_STANDARD", "Standard", "CIV's balanced general-purpose A4 layout.", "#172033", "STANDARD"),
  definition("CIV_MODERN", "Modern", "A clean A4 layout with a stronger visual hierarchy.", "#2457D6", "MODERN"),
  definition("CIV_COMPACT", "Compact", "A space-efficient A4 layout for denser line-item records.", "#176B5B", "COMPACT"),
]);

export function getBuiltInTemplateDefinition(code: BuiltInTemplateCode) {
  const definition = BUILT_IN_TEMPLATE_DEFINITIONS.find((item) => item.code === code);
  if (!definition) throw new Error("Built-in document template definition was not found.");
  return definition;
}
