import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

export const BUILT_IN_TEMPLATE_CODES = [
  "CIV_STANDARD",
  "CIV_MODERN",
  "CIV_COMPACT",
] as const;

export const builtInTemplateCodeSchema = z.enum(BUILT_IN_TEMPLATE_CODES);
export type BuiltInTemplateCode = z.infer<typeof builtInTemplateCodeSchema>;

export const TEMPLATE_FIELD_IDS = [
  "issuer.identity",
  "issuer.logo",
  "issuer.contact",
  "customer.details",
  "document.officialNumber",
  "document.type",
  "document.issueDate",
  "document.dueDate",
  "lines.table",
  "totals.subtotal",
  "tax.nhil",
  "tax.getfund",
  "tax.taxableValue",
  "tax.vat",
  "totals.grandTotal",
  "document.notes",
  "issuer.signature",
  "verification.block",
] as const;

const textFieldIds = [
  "issuer.identity",
  "issuer.contact",
  "customer.details",
  "document.officialNumber",
  "document.type",
  "document.issueDate",
  "document.dueDate",
  "totals.subtotal",
  "tax.nhil",
  "tax.getfund",
  "tax.taxableValue",
  "tax.vat",
  "totals.grandTotal",
  "document.notes",
] as const;

const positionedFieldIds = [
  ...textFieldIds,
  "issuer.logo",
  "issuer.signature",
  "verification.block",
] as const;

const coordinateSchema = z.number().int().min(0).max(10_000);
const positiveDimensionSchema = z.number().int().min(1).max(10_000);

const boxSchema = z
  .object({
    x: coordinateSchema,
    y: coordinateSchema,
    width: positiveDimensionSchema,
    height: positiveDimensionSchema,
  })
  .strict()
  .superRefine((box, context) => {
    if (box.x + box.width > 10_000) {
      context.addIssue({
        code: "custom",
        path: ["width"],
        message: "The region exceeds the page width.",
      });
    }
    if (box.y + box.height > 10_000) {
      context.addIssue({
        code: "custom",
        path: ["height"],
        message: "The region exceeds the page height.",
      });
    }
  });

const textStyleSchema = z
  .object({
    font: z.enum(["CIV_SANS"]),
    weight: z.enum(["REGULAR", "MEDIUM", "BOLD"]),
    fontSizeHundredths: z.number().int().min(700).max(2_400),
    lineHeightPermille: z.number().int().min(900).max(2_000),
    align: z.enum(["LEFT", "CENTER", "RIGHT"]),
    color: z.string().regex(/^#[0-9A-F]{6}$/),
    backgroundColor: z.string().regex(/^#[0-9A-F]{6}$/).nullable(),
    padding: z.number().int().min(0).max(500),
  })
  .strict();

const textFieldSchema = z
  .object({
    kind: z.literal("TEXT"),
    field: z.enum(textFieldIds),
    box: boxSchema,
    pageRole: z.enum(["FIRST", "CONTINUATION", "FINAL", "ALL"]),
    style: textStyleSchema,
  })
  .strict();

const imageFieldSchema = z
  .object({
    kind: z.literal("IMAGE"),
    field: z.enum(["issuer.logo", "issuer.signature"]),
    box: boxSchema,
    pageRole: z.enum(["FIRST", "FINAL", "ALL"]),
    fit: z.enum(["CONTAIN"]),
    opacityPermille: z.number().int().min(0).max(1_000),
  })
  .strict();

const reservedFieldSchema = z
  .object({
    kind: z.literal("RESERVED"),
    field: z.literal("verification.block"),
    box: boxSchema,
    pageRole: z.enum(["FIRST", "FINAL", "ALL"]),
    quietZone: z.number().int().min(0).max(1_000),
  })
  .strict();

const positionedFieldSchema = z.discriminatedUnion("kind", [
  textFieldSchema,
  imageFieldSchema,
  reservedFieldSchema,
]);

const lineTableColumnIds = [
  "DESCRIPTION",
  "QUANTITY",
  "UNIT_PRICE",
  "RATE",
  "TOTAL",
] as const;

const lineTableColumnSchema = z
  .object({
    column: z.enum(lineTableColumnIds),
    widthBasisPoints: z.number().int().min(1).max(10_000),
    align: z.enum(["LEFT", "CENTER", "RIGHT"]),
  })
  .strict();

const lineTableColumnsSchema = z
  .array(lineTableColumnSchema)
  .length(lineTableColumnIds.length)
  .superRefine((columns, context) => {
    const identifiers = new Set(columns.map(({ column }) => column));
    if (identifiers.size !== lineTableColumnIds.length) {
      context.addIssue({ code: "custom", message: "Line-table columns must be unique." });
    }
    if (columns.reduce((total, column) => total + column.widthBasisPoints, 0) !== 10_000) {
      context.addIssue({
        code: "custom",
        message: "Line-table column widths must total 10000 basis points.",
      });
    }
  });

const lineTableSchema = z
  .object({
    field: z.literal("lines.table"),
    box: boxSchema,
    pageRole: z.literal("ALL"),
    headerHeight: z.number().int().min(100).max(1_000),
    minimumRowHeight: z.number().int().min(100).max(1_000),
    maximumRowHeight: z.number().int().min(100).max(2_000),
    cellPadding: z.number().int().min(0).max(300),
    fontSizeHundredths: z.number().int().min(700).max(1_400),
    repeatHeader: z.literal(true),
    wrapDescriptions: z.literal(true),
    columns: lineTableColumnsSchema,
  })
  .strict()
  .refine((table) => table.maximumRowHeight >= table.minimumRowHeight, {
    path: ["maximumRowHeight"],
    message: "Maximum row height must not be smaller than minimum row height.",
  });

const positionedFieldsSchema = z
  .array(positionedFieldSchema)
  .length(positionedFieldIds.length)
  .superRefine((fields, context) => {
    const identifiers = new Set(fields.map(({ field }) => field));
    if (identifiers.size !== positionedFieldIds.length) {
      context.addIssue({ code: "custom", message: "Template fields must be unique." });
      return;
    }
    for (const requiredField of positionedFieldIds) {
      if (!identifiers.has(requiredField)) {
        context.addIssue({
          code: "custom",
          message: `Template field ${requiredField} is required.`,
        });
      }
    }
  });

export const documentTemplateLayoutManifestSchema = z
  .object({
    manifestVersion: z.literal(1),
    page: z
      .object({
        size: z.literal("A4"),
        orientation: z.literal("PORTRAIT"),
        safeArea: boxSchema,
      })
      .strict(),
    fields: positionedFieldsSchema,
    lineTable: lineTableSchema,
  })
  .strict();

export type DocumentTemplateLayoutManifest = z.infer<
  typeof documentTemplateLayoutManifestSchema
>;

function canonicalizeJsonValue(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Manifest contains a non-finite number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeJsonValue).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalizeJsonValue(record[key])}`)
      .join(",")}}`;
  }
  throw new Error("Manifest contains an unsupported value.");
}

export function canonicalizeLayoutManifest(input: unknown) {
  return canonicalizeJsonValue(documentTemplateLayoutManifestSchema.parse(input));
}

export function calculateLayoutManifestChecksum(input: unknown) {
  return createHash("sha256").update(canonicalizeLayoutManifest(input)).digest("hex");
}
