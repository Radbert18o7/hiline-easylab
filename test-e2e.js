import fs from 'fs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import processLabels from './lib/pdfProcessor.js';

async function createDummyPdfs() {
  // Create dummy Pickwave
  const pickwaveDoc = await PDFDocument.create();
  const pickPage = pickwaveDoc.addPage([600, 400]);
  const font = await pickwaveDoc.embedFont(StandardFonts.Helvetica);
  pickPage.drawText('Order IdSubSourceOrder DateOrder Reference Shipping Address', { x: 10, y: 380, font, size: 10 });
  pickPage.drawText('78415-A SOLAR FLORAL GLASS BIRD BATH W/STAND 1 4.G.01 DATAIMPORT EXPORT THE HOME DEPOT US 6/5/2026 1:32:37 PM 48866310 Kimberly Whitlock 305 Pine St', { x: 10, y: 360, font, size: 10 });
  const pickwaveBytes = await pickwaveDoc.save();

  // Create dummy Label
  const labelDoc = await PDFDocument.create();
  // 4x6 label (288 x 432 points)
  const labelPage = labelDoc.addPage([288, 432]);
  labelPage.drawText('UPS GROUND', { x: 20, y: 400, font, size: 12 });
  labelPage.drawText('BILLING: 3RD PARTY', { x: 20, y: 70, font, size: 10 });
  labelPage.drawText('Trx Ref No.: 48866310', { x: 20, y: 15, font, size: 10 });
  const labelBytes = await labelDoc.save();

  return { pickwaveBuffer: Buffer.from(pickwaveBytes), labelBuffer: Buffer.from(labelBytes) };
}

async function runTest() {
  try {
    console.log("Generating dummy PDFs...");
    const { pickwaveBuffer, labelBuffer } = await createDummyPdfs();
    
    console.log("Running processLabels locally...");
    const result = await processLabels(labelBuffer, pickwaveBuffer);
    
    console.log(`Success! Processed ${result.totalPages} pages, Matched: ${result.matchedCount}`);
    fs.writeFileSync('output-test.pdf', result.buffer);
    console.log("Saved output to output-test.pdf");
  } catch (error) {
    console.error("Test failed:", error);
  }
}

runTest();
