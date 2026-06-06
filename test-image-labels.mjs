/**
 * Test with an image-based label PDF (no text layer) — exactly like the real thermal labels.
 * Run with: node test-image-labels.mjs
 */
import fs from 'fs';
import path from 'path';
import { createCanvas } from '@napi-rs/canvas';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { processLabelsPdf, parsePickwaveRecords } from './lib/pdfProcessor.js';

// Build a label image that looks like a UPS thermal label, embedded as a PNG in a PDF
async function buildImageLabelsPdf(orders) {
  const doc = await PDFDocument.create();
  
  for (const { trxRef, name } of orders) {
    // Create a 4x6 inch canvas at 72dpi = 288x432 px
    const canvas = createCanvas(288, 432);
    const ctx = canvas.getContext('2d');
    
    // White background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 288, 432);
    
    // Simulate UPS label text
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('UPS GROUND', 20, 30);
    ctx.font = '10px sans-serif';
    ctx.fillText('SHIP TO:', 20, 60);
    ctx.fillText(name, 20, 75);
    ctx.fillText('305 PINE ST', 20, 90);
    ctx.fillText('GREER SC 29650', 20, 105);
    
    // Barcode area placeholder
    ctx.strokeStyle = '#000';
    ctx.strokeRect(20, 150, 248, 80);
    ctx.font = '9px sans-serif';
    ctx.fillText('1Z 240 RF1 03 XXXX', 40, 195);
    
    // BILLING section at bottom
    ctx.font = '9px sans-serif';
    ctx.fillText('BILLING: 3RD PARTY', 20, 320);
    ctx.fillText(`Trx Ref No.:${trxRef}`, 20, 335);
    ctx.fillText('Purchase No.:337359-0', 20, 350);
    
    // Embed the canvas as PNG image in PDF page
    const pngBuffer = canvas.toBuffer('image/png');
    const page = doc.addPage([288, 432]);
    const embeddedImage = await doc.embedPng(pngBuffer);
    page.drawImage(embeddedImage, { x: 0, y: 0, width: 288, height: 432 });
  }
  
  return Buffer.from(await doc.save());
}

async function buildPickwavePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([600, 800]);
  const lines = [
    'Page - 1 - Printed on: 2026 Jun 05 - 19:28:59',
    'ImageSKUItemQuantityBinSource',
    'Order IdSubSourceOrder DateOrder Reference Shipping Address',
    '87703-IHOWLING BEAGLE PUPPY STATUE11.G.01DATAIMPORT',
    'EXPORT', 'THE HOME DEPOT', 'US',
    '6/5/2026 1:32:37 PM48832750Pamela Bowen',
    '12164 Sunchase Drive',
    '87728-ACAT SLEEPING LYING DOWN -',
    'BLACK/WHITE', '111.D.01DATAIMPORT', 'EXPORT', 'THE HOME DEPOT', 'US',
    '6/5/2026 1:32:37 PM48786211Melinda Carr',
    '251 10th Ct Vero Beach',
    '78415-ASOLAR FLORAL GLASS BIRD BATH W/STAND14.G.01DATAIMPORT',
    '6/5/2026 1:32:37 PM48866310Kimberly Whitlock',
    '305 Pine St Greer SC',
  ];
  let y = 780;
  for (const line of lines) { page.drawText(line, { x: 10, y, font, size: 9 }); y -= 13; }
  return Buffer.from(await doc.save());
}

async function run() {
  console.log('\n=== STEP 1: Build pickwave PDF and extract text ===');
  const pickwaveBuffer = await buildPickwavePdf();
  const pwData = await pdfParse(Buffer.from(pickwaveBuffer));
  const pickwaveRawText = pwData.text;
  
  const records = parsePickwaveRecords(pickwaveRawText);
  console.log('Pickwave records:', records.map(r => `${r.orderRef}=${r.sku}`).join(', '));

  console.log('\n=== STEP 2: Build IMAGE-BASED label PDF (no text layer) ===');
  const orders = [
    { trxRef: '48832750', name: 'Pamela Bowen' },
    { trxRef: '48786211', name: 'Melinda Carr' },
    { trxRef: '48866310', name: 'Kimberly Whitlock' },
  ];
  const labelsBuffer = await buildImageLabelsPdf(orders);
  console.log(`Built ${orders.length} image-based label pages`);

  console.log('\n=== STEP 3: Run processLabelsPdf with image labels ===');
  const result = await processLabelsPdf(labelsBuffer, pickwaveRawText);
  
  console.log(`\nResult: ${result.matchedCount}/${result.totalPages} matched`);
  if (result.matchedCount === 0) {
    console.error('FAIL: 0 matched. OCR is not working for image-based labels.');
    process.exit(1);
  }
  
  fs.writeFileSync('output-image-test.pdf', result.buffer);
  console.log('Saved output-image-test.pdf');
}

run().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
