/**
 * Real end-to-end test that mirrors exactly what the API route does.
 * Run with: node test-real.mjs
 *
 * Creates a realistic pickwave PDF and label PDF, then runs the full pipeline.
 */
import fs from 'fs';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { processLabelsPdf, parsePickwaveRecords } from './lib/pdfProcessor.js';

// ─── 1. Build a realistic pickwave PDF (mimics the merged pdf-parse output) ───
async function buildPickwavePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([600, 800]);

  // Exactly the format pdf-parse produces — columns merged, no spaces between SKU and item name
  const lines = [
    'Page - 1 - Printed on: 2026 Jun 05 - 19:28:59',
    'ImageSKUItemQuantityBinSource',
    'Order IdSubSourceOrder DateOrder Reference Shipping Address',
    '87703-IHOWLING BEAGLE PUPPY STATUE11.G.01DATAIMPORT',
    'EXPORT',
    'THE HOME DEPOT',
    'US',
    '6/5/2026 1:32:37 PM48832750Pamela Bowen',
    '12164 Sunchase Drive',
    '87728-ACAT SLEEPING LYING DOWN -',
    'BLACK/WHITE',
    '111.D.01DATAIMPORT',
    'EXPORT',
    'THE HOME DEPOT',
    'US',
    '6/5/2026 1:32:37 PM48786211Melinda Carr',
    '251 10th Ct Vero Beach',
    '87938PIG-SITTING-LARGE111.D.03DATAIMPORT',
    'EXPORT',
    'THE HOME DEPOT',
    '6/5/2026 1:32:37 PM48722932Kay Sebetka',
    '87697-BDUCKLINGS 2PC SET421.C.02DATAIMPORT',
    '6/5/2026 1:32:37 PM63572938Nicole Hendrickson',
    '6/5/2026 1:32:37 PM48753674Vickie Oliver',
    '78415-ASOLAR FLORAL GLASS BIRD BATH W/STAND14.G.01DATAIMPORT',
    '6/5/2026 1:32:37 PM48866310Kimberly Whitlock',
    '305 Pine St Greer SC',
  ];

  let y = 780;
  for (const line of lines) {
    page.drawText(line, { x: 10, y, font, size: 9 });
    y -= 13;
  }

  return Buffer.from(await doc.save());
}

// ─── 2. Build a label PDF with a text layer (like the real UPS labels) ────────
async function buildLabelsPdf(orders) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (const { trxRef, name } of orders) {
    const page = doc.addPage([288, 432]); // 4×6 inch label
    page.drawText('UPS GROUND', { x: 20, y: 410, font, size: 14 });
    page.drawText('SHIP TO:', { x: 20, y: 380, font, size: 10 });
    page.drawText(name, { x: 20, y: 365, font, size: 10 });
    page.drawText('BILLING: 3RD PARTY', { x: 20, y: 105, font, size: 9 });
    page.drawText(`Trx Ref No.:${trxRef}`, { x: 20, y: 90, font, size: 9 });
    page.drawText('Purchase No.:337359-0', { x: 20, y: 75, font, size: 9 });
  }

  return Buffer.from(await doc.save());
}

// ─── 3. Run everything ─────────────────────────────────────────────────────────
async function run() {
  console.log('\n════════════════════════════════════════');
  console.log(' STEP 1: Build pickwave PDF');
  console.log('════════════════════════════════════════');
  const pickwaveBuffer = await buildPickwavePdf();

  console.log('\n════════════════════════════════════════');
  console.log(' STEP 2: Extract pickwave text with pdf-parse (same as API route)');
  console.log('════════════════════════════════════════');
  const pwData = await pdfParse(pickwaveBuffer);
  const pickwaveRawText = pwData.text;
  console.log('Raw text sample:\n', pickwaveRawText.substring(0, 400));

  console.log('\n════════════════════════════════════════');
  console.log(' STEP 3: Parse pickwave records');
  console.log('════════════════════════════════════════');
  const records = parsePickwaveRecords(pickwaveRawText);
  console.log('Records found:');
  records.forEach(r => console.log(`  orderRef=${r.orderRef}  sku=${r.sku}`));

  if (records.length === 0) {
    console.error('\n❌ FAIL: No records parsed from pickwave. Pickwave regex is broken.');
    process.exit(1);
  }

  console.log('\n════════════════════════════════════════');
  console.log(' STEP 4: Build labels PDF');
  console.log('════════════════════════════════════════');
  const orders = [
    { trxRef: '48832750', name: 'Pamela Bowen' },
    { trxRef: '48786211', name: 'Melinda Carr' },
    { trxRef: '48722932', name: 'Kay Sebetka' },
    { trxRef: '63572938', name: 'Nicole Hendrickson' },
    { trxRef: '48753674', name: 'Vickie Oliver' },
    { trxRef: '48866310', name: 'Kimberly Whitlock' },
  ];
  const labelsBuffer = await buildLabelsPdf(orders);
  console.log(`Created ${orders.length} label pages`);

  console.log('\n════════════════════════════════════════');
  console.log(' STEP 5: processLabelsPdf (full pipeline)');
  console.log('════════════════════════════════════════');
  const result = await processLabelsPdf(labelsBuffer, pickwaveRawText);

  console.log(`\n✅ Done: ${result.matchedCount}/${result.totalPages} labels matched`);
  if (result.matchedCount === 0) {
    console.error('❌ FAIL: 0 labels matched. Check extractTrxRefNo or pickwave parsing.');
    process.exit(1);
  }

  fs.writeFileSync('output-test.pdf', result.buffer);
  console.log('📄 Saved output-test.pdf — open it to verify SKU stamps are correct');
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
