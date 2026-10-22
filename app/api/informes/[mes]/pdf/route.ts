import { NextResponse, type NextRequest } from "next/server";
import { getOptionalUser } from "@/lib/auth";
import { getReportPdf } from "@/lib/dal/reports";
import { isMonth, reportFileName } from "@/lib/reports/month";

/**
 * GET /api/informes/{AAAA-MM}/pdf[?descargar=1]
 *
 * El PDF guardado del informe mensual, solo con sesión. Sin `descargar` se abre en el navegador (vista previa);
 * con `descargar=1` se baja con el nombre "informe-octubre-2026-marca.pdf".
 */
export async function GET(request: NextRequest, { params }: RouteContext<"/api/informes/[mes]/pdf">) {
  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ error: "Tu sesión terminó. Vuelve a entrar." }, { status: 401 });

  const { mes } = await params;
  if (!isMonth(mes)) return NextResponse.json({ error: "Mes no válido." }, { status: 404 });
  const report = await getReportPdf(mes);
  if (!report) return NextResponse.json({ error: "Ese informe todavía no existe. Genéralo desde Inicio → Informes." }, { status: 404 });

  const download = request.nextUrl.searchParams.get("descargar") === "1";
  return new Response(new Uint8Array(report.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(report.pdf.byteLength),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${reportFileName(mes, report.brandName)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
