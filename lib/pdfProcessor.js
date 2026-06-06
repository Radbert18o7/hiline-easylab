import path from 'path';
import os from 'os';
import { PNG } from 'pngjs';

/**
 * Extract Trx Ref No from a label's text
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
  // Fallback: if "Purchase No" exists, the 8-digit number near it is the Trx Ref No
  if (/Purchase\s*No/i.test(text)) {
    const eights = text.match(/\b[0-9]{8}\b/g);
    if (eights && eights.length > 0) return eights[eights.length - 1];
  }
  return null;
}

/**
 * Parse Pickwave PDF text into { orderRef, sku } records.
 *
 * In the raw pdf-parse output, columns are merged with NO spaces:
 *   "87703-IHOWLING BEAGLE PUPPY STATUE11.G.01DATAIMPORT"
 *   "87728-ACAT SLEEPING LYING DOWN - BLACK/WHITE111.D.01DATAIMPORT"
 *   "87938PIG-SITTING-LARGE111.D.03DATAIMPORT"
 *
 * KEY INSIGHT: The item description (ALL CAPS) immediately follows the SKU.
 * Use a positive lookahead for an uppercase letter to identify SKUs vs stray numbers:
 *   ✅ "87703-I" in "87703-IHOWLING"  → followed by H (uppercase)
 *   ✅ "87728-A" in "87728-ACAT"       → followed by C (uppercase)
 *   ✅ "87938"   in "87938PIG"          → followed by P (uppercase)
 *   ❌ "12164"   in "12164 Sunchase"    → followed by space → rejected
 *   ❌ "24230"   zip code               → followed by \n or space → rejected
 */
export function parsePickwaveRecords(fullText) {
  const records = [];
  if (!fullText) return records;

  // Match SKU: 5 digits optionally followed by -letter or -2digits,
  // ONLY when immediately followed by an uppercase letter (start of item description)
  const skuPattern = /(?<!\d)(\d{5}(?:-[A-Z]|-\d{1,2})?)(?=[A-Z])/g;
  const skus = [];
  let m;

  while ((m = skuPattern.exec(fullText)) !== null) {
    const val = m[1].toUpperCase();
    // Pure 5-digit SKUs must start with 7 or 8 (all Hiline Gift SKUs do)
    if (/^\d+$/.test(val) && !/^[78]/.test(val)) continue;
    skus.push({ sku: val, index: m.index });
  }

  console.log(`Found ${skus.length} SKUs:`, skus.map(s => s.sku).join(', '));

  // Order References are exactly 8 digits, not adjacent to other digits
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

/**
 * Stamp each label page with its SKU ID from the Pickwave.
 */
export async function processLabelsPdf(labelsPdfBuffer, pickwaveRecords) {
  const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');

  // 1. Build SKU lookup from Pickwave text
  let pickwaveRecordsList = [];
  if (typeof pickwaveRecords === 'string') {
    pickwaveRecordsList = parsePickwaveRecords(pickwaveRecords);
  } else if (Array.isArray(pickwaveRecords)) {
    pickwaveRecordsList = parsePickwaveRecords(pickwaveRecords.join('\n'));
  }
  console.log(`Pickwave loaded: ${pickwaveRecordsList.length} records`);

  // 2. Init pdfjs for per-page text and coordinate extraction
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.js');
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(labelsPdfBuffer),
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
    disableWorker: true,
  });
  const parsedPdf = await loadingTask.promise;
  const numPages = parsedPdf.numPages;

  // 3. Try to init Tesseract — gracefully skip if unavailable on Vercel
  let worker = null;
  try {
    const { createWorker } = await import('tesseract.js');
    // No custom corePath — let Tesseract find its own WASM
    worker = await createWorker('eng', 1, { logger: () => {} });
    console.log('Tesseract ready');
  } catch (e) {
    console.warn('Tesseract unavailable, OCR skipped:', e.message);
  }

  // 4. Extract TrxRefNo + billing coordinates from each label page
  const pageExtractionResults = [];

  for (let i = 1; i <= numPages; i++) {
    try {
      const page = await parsedPdf.getPage(i);
      const textContent = await page.getTextContent();
      let fullText = textContent.items.map(item => item.str).join(' ');
      let billingX = null;
      let billingY = null;

      // Find BILLING position in text layer for stamp placement
      for (const item of textContent.items) {
        if (/billing/i.test(item.str)) {
          billingX = item.transform[4];
          billingY = item.transform[5];
          break;
        }
      }

      // Extract TrxRefNo from text layer
      let trxRefNo = extractTrxRefNo(fullText);

      // If text layer gave nothing and Tesseract is available, try OCR
      if (!trxRefNo && fullText.trim().length < 20 && worker) {
        console.log(`Page ${i}: No text layer — trying OCR...`);
        try {
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
              } catch (e) {}
            }
          }

          if (imageObj && imageObj.data) {
            const png = new PNG({ width: imageObj.width, height: imageObj.height });
            const pixelCount = imageObj.width * imageObj.height;

            if (imageObj.data.length === pixelCount * 3) {
              for (let p = 0; p < pixelCount; p++) {
                png.data[p * 4]     = imageObj.data[p * 3];
                png.data[p * 4 + 1] = imageObj.data[p * 3 + 1];
                png.data[p * 4 + 2] = imageObj.data[p * 3 + 2];
                png.data[p * 4 + 3] = 255;
              }
            } else if (imageObj.data.length === pixelCount * 4) {
              png.data.set(imageObj.data);
            } else if (imageObj.data.length === pixelCount) {
              for (let p = 0; p < pixelCount; p++) {
                const val = imageObj.data[p];
                png.data[p * 4]     = val;
                png.data[p * 4 + 1] = val;
                png.data[p * 4 + 2] = val;
                png.data[p * 4 + 3] = 255;
              }
            }

            const imageBuffer = PNG.sync.write(png);
            const { data } = await worker.recognize(imageBuffer);
            fullText = data.text;
            trxRefNo = extractTrxRefNo(fullText);

            // Get billing position from OCR word bounding boxes
            if (billingY === null) {
              const anchorWord = data.words?.find(w => /billing/i.test(w.text));
              if (anchorWord) {
                const viewport = page.getViewport({ scale: 1.0 });
                billingX = anchorWord.bbox.x0 / (imageObj.width / viewport.width);
                billingY = viewport.height - (anchorWord.bbox.y1 / (imageObj.height / viewport.height));
              }
            }
          }
        } catch (ocrErr) {
          console.warn(`Page ${i}: OCR failed: ${ocrErr.message}`);
        }
      }

      pageExtractionResults.push({ trxRefNo, billingX, billingY });
      console.log(`Page ${i}: TrxRef="${trxRefNo}", billingY=${billingY?.toFixed(1) ?? 'null'}`);
    } catch (pageErr) {
      console.error(`Page ${i}: crashed: ${pageErr.message}`);
      pageExtractionResults.push({ trxRefNo: null, billingX: null, billingY: null });
    }
  }

  if (worker) await worker.terminate();

  // 5. Load the labels PDF with pdf-lib for stamping
  const pdfDoc = await PDFDocument.load(labelsPdfBuffer);
  const pdfPages = pdfDoc.getPages();
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  let matchedCount = 0;

  // 6. Draw SKU ID on each matched label page
  for (let i = 0; i < numPages; i++) {
    const { trxRefNo, billingX, billingY } = pageExtractionResults[i];
    const pdfPage = pdfPages[i];
    const { width: pageWidth, height: pageHeight } = pdfPage.getSize();

    if (!trxRefNo) {
      console.warn(`Page ${i + 1}: No TrxRefNo — skipping`);
      continue;
    }

    const matchedRecord = pickwaveRecordsList.find(r => r.orderRef === trxRefNo);
    if (!matchedRecord) {
      console.warn(`Page ${i + 1}: No Pickwave match for TrxRef="${trxRefNo}"`);
      continue;
    }

    const fontSize = 10;
    // Stamp position: just below BILLING line if found, else fixed fallback at 8% from bottom
    const textX = Math.max(5, Math.min(billingX ?? 20, pageWidth - 120));
    const textY = Math.max(fontSize + 5, Math.min(
      billingY !== null ? billingY - 18 : pageHeight * 0.08,
      pageHeight - 5
    ));

    const skuText = `SKU ID: "${matchedRecord.sku}"`;
    const textWidth = font.widthOfTextAtSize(skuText, fontSize);

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

    console.log(`✓ Page ${i + 1}: "${skuText}"`);
    matchedCount++;
  }

  const modifiedBytes = await pdfDoc.save();
  return { buffer: Buffer.from(modifiedBytes), matchedCount, totalPages: numPages };
}
