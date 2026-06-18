import { NextResponse }                  from "next/server";
import { requireAuth }                   from "@/lib/auth/guards";
import { prisma }                        from "@/lib/prisma";
import { previewTransactionNumber }      from "@/lib/customization/utils";

/**
 * GET /api/invoices/next-number
 *
 * Returns the suggested next invoice number from the INVOICE transaction number series.
 * Does NOT advance nextNumber — this is a pure preview.
 *
 * Response shape:
 *   { data: { suggestedNumber, allowManualOverride, preventDuplicates, seriesId, isEnabled, helperText } }
 */
export async function GET() {
  const { ctx, response } = await requireAuth();
  if (!ctx) return response!;

  const series = await prisma.transactionNumberSeries.findFirst({
    where: { tenantId: ctx.tenantId, module: "INVOICE" },
  });

  if (!series || !series.isEnabled) {
    return NextResponse.json({
      data: {
        suggestedNumber:     null,
        allowManualOverride: true,
        preventDuplicates:   true,
        seriesId:            null,
        isEnabled:           false,
        helperText:
          "Invoice numbering is not configured. Please check Transaction Number Series in Settings.",
      },
    });
  }

  const suggestedNumber = previewTransactionNumber(series);

  const helperParts: string[] = [];
  if (!series.allowManualOverride) {
    helperParts.push("Invoice number is controlled by your transaction number series.");
  } else {
    helperParts.push("Invoice number is auto-generated. You may override it before saving.");
  }
  if (!series.preventDuplicates) {
    helperParts.push("Duplicate invoice numbers are allowed by your current settings.");
  }

  return NextResponse.json({
    data: {
      suggestedNumber,
      allowManualOverride: series.allowManualOverride,
      preventDuplicates:   series.preventDuplicates,
      seriesId:            series.id,
      isEnabled:           true,
      helperText:          helperParts.join(" "),
    },
  });
}
