import { bootstrapBuiltInDocumentTemplates } from "@/features/document-templates/bootstrap";
import { db } from "@/lib/db";

try {
  const result = await bootstrapBuiltInDocumentTemplates();
  console.log(
    result.createdTemplates === 0
      ? "Built-in document templates already match the published CIV definitions."
      : `Created ${result.createdTemplates} built-in document templates.`,
  );
} finally {
  await db.$disconnect();
}
