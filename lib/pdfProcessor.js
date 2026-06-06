import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

/**
 * Extract Trx Ref No from string
 */
function extractTrxRefNo(text) {
  if (!text) return null;
  const patterns = [
    /Trx\s*Ref\s*No[.:]*\s*([0-9]{7,9})/i,
    /TRX\s*REF[.:]*\s*([0-9]{7,9})/i,
    /Ref\s*No[.:]*\s*([0-9]{7,9})/i,
    /(?:Trx|Ref)[^0-9]{0,20}([0-9]{8})/i,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) return m[1].trim();
  }
  
  // Ultimate Fallback: If "Purchase No" exists, the 8-digit number near it is the Trx Ref No
  if (/Purchase\s*No/i.test(text)) {
    const eights = text.match(/\b[0-9]{8}\b/g);
    if (eights && eights.length > 0) return eights[eights.length - 1];
  }
  return null;
}

export function parsePickwaveRecords(fullText) {
  const records = [];
  if (!fullText) return records;

  // In the raw pdf-parse output, columns are merged with NO spaces:
  //   "87703-IHOWLING BEAGLE PUPPY STATUE11.G.01DATAIMPORT"
  //   "87728-ACAT SLEEPING LYING DOWN - BLACK/WHITE111.D.01DATAIMPORT"
  //   "87938PIG-SITTING-LARGE111.D.03DATAIMPORT"
  //
  // The KEY: the item description (uppercase letters) immediately follows the SKU.
  // Use a lookahead for an uppercase letter to identify SKUs vs stray 5-digit numbers.
  //   ✅ "87703-I" in "87703-IHOWLING"  → followed by H (uppercase)
  //   ✅ "87728-A" in "87728-ACAT"       → followed by C (uppercase)
  //   ✅ "87938"   in "87938PIG"          → followed by P (uppercase)
  //   ❌ "12164"   in "12164 Sunchase"    → followed by space (not uppercase) → rejected
  //   ❌ "24230"   zip code               → followed by \n or space → rejected

  const skuPattern = /(?<!\d)(\d{5}(?:-[A-Z]|-\d{1,2})?)(?=[A-Z])/g;
  const skus = [];
  let m;

  while ((m = skuPattern.exec(fullText)) !== null) {
    const val = m[1].toUpperCase();
    // Extra safety: pure 5-digit SKUs must start with 7 or 8 (all Hiline SKUs do)
    if (/^\d+$/.test(val) && !/^[78]/.test(val)) continue;
    skus.push({ sku: val, index: m.index });
  }

  console.log(`Found ${skus.length} SKUs:`, skus.map(s => s.sku).join(', '));

  // Order References are exactly 8 digits not adjacent to other digits
  const orderRefPattern = /(?<!\d)(\d{8})(?!\d)/g;
  const orderRefs = [];
  while ((m = orderRefPattern.exec(fullText)) !== null) {
    orderRefs.push({ ref: m[1], index: m.index });
  }

  // For each Order Reference, find the most recent SKU that precedes it in the text
  for (const ref of orderRefs) {
    let bestSku = null;
    let bestDist = Infinity;
    for (const s of skus) {
      if (s.index < ref.index) {
        const dist = ref.index - s.index;
        if (dist < bestDist) {
          bestDist = dist;
          bestSku = s.sku;
        }
      }
    }
    if (bestSku) {
      records.push({ orderRef: ref.ref, sku: bestSku });
    }
  }

  console.log(`Parsed ${records.length} Pickwave records`);
  return records;
}


import { PNG } from 'pngjs';

/**
 * Main: process labels PDF using Tesseract.js native OCR
 */
export async function processLabelsPdf(labelsPdfBuffer, pickwaveRecords) {
  const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');

  // 1. Build SKU lookup records with tough matching tokens
  let pickwaveRecordsList = [];
  if (typeof pickwaveRecords === 'string') {
    pickwaveRecordsList = parsePickwaveRecords(pickwaveRecords);
  } else if (Array.isArray(pickwaveRecords)) {
    pickwaveRecordsList = parsePickwaveRecords(pickwaveRecords.join('\n'));
  }

  // 2. Perform OCR on any image-based pages natively using Tesseract
  const { createWorker } = await import('tesseract.js');
  const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

  console.log('Loading PDF for OCR analysis...');
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(labelsPdfBuffer),
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
    disableWorker: true,
  });
  
  const parsedPdf = await loadingTask.promise;
  const numPages = parsedPdf.numPages;
  const pageExtractionResults = [];
  
  const worker = await createWorker('eng', 1, { 
    logger: () => {},
    cachePath: os.tmpdir(),
    corePath: path.join(process.cwd(), 'public', 'ocr', 'tesseract-core.wasm.js'),
  });

  for (let i = 1; i <= numPages; i++) {
    try {
      const page = await parsedPdf.getPage(i);
      const textContent = await page.getTextContent();
      let fullText = textContent.items.map(item => item.str).join(' ');
      let billingX = null;
      let billingY = null;
      
      // If the PDF page has no embedded text (it's a thermal image), run Tesseract OCR
      if (fullText.trim().length < 20) {
        console.log(`Page ${i}: Image-based label detected. Rasterizing and running OCR...`);
        const operatorList = await page.getOperatorList();
        let imageObj = null;

        for (let j = 0; j < operatorList.fnArray.length; j++) {
          if (
            operatorList.fnArray[j] === pdfjsLib.OPS.paintImageXObject || 
            operatorList.fnArray[j] === pdfjsLib.OPS.paintJpegXObject
          ) {
            const imgName = operatorList.argsArray[j][0];
            try {
               imageObj = await page.objs.get(imgName);
               if (imageObj && imageObj.data) break;
            } catch(e) {}
          }
        }

        if (!imageObj || !imageObj.data) {
          console.warn(`Page ${i}: Failed to find embedded image. Skipping OCR for this page.`);
          pageExtractionResults.push({ trxRefNo: null, billingX: null, billingY: null, fullText: '' });
          continue;
        }

        const png = new PNG({ width: imageObj.width, height: imageObj.height });
        const pixelCount = imageObj.width * imageObj.height;
        
        if (imageObj.data.length === pixelCount * 3) {
          for (let p = 0; p < pixelCount; p++) {
            png.data[p * 4] = imageObj.data[p * 3];
            png.data[p * 4 + 1] = imageObj.data[p * 3 + 1];
            png.data[p * 4 + 2] = imageObj.data[p * 3 + 2];
            png.data[p * 4 + 3] = 255;
          }
        } else if (imageObj.data.length === pixelCount * 4) {
          png.data.set(imageObj.data);
        } else if (imageObj.data.length === pixelCount) {
          for (let p = 0; p < pixelCount; p++) {
            const val = imageObj.data[p];
            png.data[p * 4] = val;
            png.data[p * 4 + 1] = val;
            png.data[p * 4 + 2] = val;
            png.data[p * 4 + 3] = 255;
          }
        } else {
           console.warn(`Page ${i}: Unknown image format depth. Skipping.`);
           pageExtractionResults.push({ trxRefNo: null, billingX: null, billingY: null, fullText: '' });
           continue;
        }

        const imageBuffer = PNG.sync.write(png);
        const { data } = await worker.recognize(imageBuffer);
        fullText = data.text;
        
        // Look for anchor words to place the SKU ID
        const anchorWord = data.words?.find(w => /(billing|trx|ref|purchase)/i.test(w.text.toLowerCase()));
        if (anchorWord) {
          const viewport = page.getViewport({ scale: 1.0 });
          const scaleX = imageObj.width / viewport.width;
          const scaleY = imageObj.height / viewport.height;
          
          billingX = anchorWord.bbox.x0 / scaleX;
          const scaledY = anchorWord.bbox.y1 / scaleY;
          billingY = viewport.height - scaledY; 
        }
      } else {
        // PDF already has a text layer, just extract coordinates natively
        for (const item of textContent.items) {
          if (/(billing|trx|ref|purchase)/i.test(item.str)) {
            billingX = item.transform[4];
            billingY = item.transform[5];
            if (/billing/i.test(item.str)) break; // Prefer BILLING above all else
          }
        }
      }
      
      pageExtractionResults.push({
        trxRefNo: extractTrxRefNo(fullText),
        billingX,
        billingY,
        fullText
      });
    } catch (pageErr) {
      console.error(`Page ${i}: OCR/extraction crashed: ${pageErr.message}`);
      pageExtractionResults.push({ trxRefNo: null, billingX: null, billingY: null, fullText: '' });
    }
  }
  
  await worker.terminate();

  // 4. Load the original PDF with PDF-lib for editing
  const pdfDoc = await PDFDocument.load(labelsPdfBuffer);
  const pdfPages = pdfDoc.getPages();
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  let matchedCount = 0;

  // 5. Draw the SKUs
  for (let i = 0; i < numPages; i++) {
    const pdfPage = pdfPages[i];
    const { width: pageWidth, height: pageHeight } = pdfPage.getSize();
    const { trxRefNo, billingX, billingY, fullText } = pageExtractionResults[i];

    console.log(`Page ${i + 1}: TrxRef="${trxRefNo}", billingY=${billingY?.toFixed(1)}`);

    let matchedRecord = null;
    
    // Match the label's Trx Ref No exactly to a Pickwave Order Reference
    if (trxRefNo) {
      matchedRecord = pickwaveRecordsList.find(r => r.orderRef === trxRefNo);
    }

    if (!matchedRecord) {
      console.warn(`Page ${i + 1}: FAILED matching. TrxRef="${trxRefNo}"`);
      continue;
    }

    const sku = matchedRecord.sku;

    const fontSize = 10;
    let textX, textY;

    if (billingY !== null) {
      // Place it right below the detected anchor word
      textY = billingY - 18;
      textX = billingX !== null ? billingX : 20;
      
      // If subtracting 18 puts it off the bottom of the page (Y < 15), push it back up slightly
      if (textY < 15) {
         textY = billingY + 25; // Put it above the anchor if it's at the absolute bottom
      }
    } else {
      textY = 25; // Safe bottom edge fallback
      textX = 20;
    }

    textX = Math.max(5, Math.min(textX, pageWidth - 120));
    textY = Math.max(fontSize + 5, Math.min(textY, pageHeight - 5));

    const skuText = `SKU ID: "${sku}"`;
    const textWidth = font.widthOfTextAtSize(skuText, fontSize);
    
    // Draw highlight yellow background box
    pdfPage.drawRectangle({
      x: textX - 4,
      y: textY - 4,
      width: textWidth + 8,
      height: fontSize + 8,
      color: rgb(1, 0.92, 0.59),
    });

    pdfPage.drawText(skuText, {
      x: textX,
      y: textY,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
    });

    console.log(`✓ Page ${i + 1}: overlaid "${skuText}"`);
    matchedCount++;
  }

  const modifiedBytes = await pdfDoc.save();
  return { buffer: Buffer.from(modifiedBytes), matchedCount, totalPages: numPages };
}
