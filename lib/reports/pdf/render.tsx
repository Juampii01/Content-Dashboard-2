import "server-only";
import { renderToBuffer } from "@react-pdf/renderer";
import type { MonthlyReportData } from "../types";
import { ReportDocument, type ReportImages } from "./document";
import { pdfImage, pdfImages } from "./images";
import { pdfTheme, registerFonts } from "./theme";

/**
 * Dibuja el PDF del informe en el servidor de la app (no en el worker): @react-pdf/renderer arma el documento
 * con componentes y lo escribe con pdfkit, sin navegador. Tarda 1 o 2 segundos con las miniaturas.
 */
export async function renderReportPdf(data: MonthlyReportData): Promise<Buffer> {
  registerFonts();
  const pieces = [...data.top, ...(data.worst ? [data.worst] : [])];
  const [brand, thumbs] = await Promise.all([
    pdfImage(data.brand.image, 160, 160),
    pdfImages(
      pieces.map((p) => p.thumbnail),
      216,
      288,
    ),
  ]);
  const images: ReportImages = { brand, pieces: Object.fromEntries(pieces.map((p, i) => [p.id, thumbs[i] ?? null])) };
  return renderToBuffer(<ReportDocument data={data} theme={pdfTheme(data.brand)} images={images} />);
}
