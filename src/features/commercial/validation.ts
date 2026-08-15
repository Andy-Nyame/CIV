import { z } from "zod";

import { betaPlanCodeSchema } from "@/features/subscriptions/validation";

const nullablePositiveInteger = z.preprocess(
  (value) => (value === "" || value === null ? null : value),
  z.coerce.number().int().positive().max(2_000_000_000).nullable(),
);
const priceSchema = z
  .string()
  .trim()
  .regex(/^\d{1,15}(\.\d{1,4})?$/)
  .refine((value) => Number(value) >= 0);
const currencySchema = z.string().trim().toUpperCase().length(3);

export const planConfigurationSchema = z.object({
  code: betaPlanCodeSchema,
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(2_000).transform((value) => value || null),
  memberLimit: nullablePositiveInteger,
  documentLimit: nullablePositiveInteger,
  betaPrice: priceSchema,
  currency: currencySchema,
  isActive: z.boolean(),
  isPublic: z.boolean(),
  isAvailableForNewWorkspaces: z.boolean(),
  sortOrder: z.coerce.number().int().min(0).max(10_000),
});

export const creditPackCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9_]{2,49}$/);

export const creditPackConfigurationSchema = z.object({
  code: creditPackCodeSchema,
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(2_000).transform((value) => value || null),
  creditAmount: z.coerce.number().int().positive().max(2_000_000_000),
  price: priceSchema,
  currency: currencySchema,
  isActive: z.boolean(),
  isPublic: z.boolean(),
  sortOrder: z.coerce.number().int().min(0).max(10_000),
});

export const creditPackUpdateSchema = creditPackConfigurationSchema.extend({
  id: z.string().uuid(),
});

export const betaCreditAcquisitionSchema = z.object({
  packCode: creditPackCodeSchema,
});

export const consumeDocumentCapacitySchema = z.object({
  workspaceId: z.string().uuid(),
  amount: z.number().int().positive().max(100_000),
  sourceReference: z.string().trim().min(8).max(255),
  actorUserId: z.string().uuid().nullable().default(null),
});
