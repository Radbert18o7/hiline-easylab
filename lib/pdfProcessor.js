import os from 'os';
import { PNG } from 'pngjs';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract the 8-digit Trx Ref No from a label page's text.
 * The text usually contains "Trx Ref No.:48866310".
 * Handles garbled OCR as a fallback.
 */
function extractTrxRefNo(text) {
  if (!text) return null;

  // Primary: exact phrase match
  const patterns = [
    /Trx\s*Ref\s*No[.:]*\s*([0-9]{8})/i,
    /TRX\s*REF[.:]*\s*([0-9]{8})/i,
    /Ref\s*No[.:]*\s*([0-9]{8})/i,
    /(?:Trx|Ref)[^0-9]{0,20}([0-9]{8})/i,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) return m[1].trim();
  }

  // Fuzzy OCR fallback: e.g. "To Raf No.48632750"
  const fuzzy = text.match(/(?:ref|raf|ret|trx|tre)[^0-9]{0,25}([0-9]{8})/i);
  if (fuzzy) return fuzzy[1];

  // Last resort: label always contains "BILLING" or "Purchase No" → grab last 8-digit number
  if (/purchase|billing|3rd\s*party/i.test(text)) {
    const nums = text.match(/\b([0-9]{8})\b/g);
    if (nums && nums.length > 0) return nums[nums.length - 1];
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pickwave parser
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse Pickwave PDF text into records: { orderRef, sku }
 *
 * The raw pdf-parse output merges columns with NO spaces:
 *   "87703-IHOWLING BEAGLE PUPPY STATUE11.G.01DATAIMPORT"
 *   "87728-ACAT SLEEPING LYING DOWN - BLACK/WHITE111.D.01DATAIMPORT"
 *   "87938PIG-SITTING-LARGE111.D.03DATAIMPORT"
 *
 * SKU is identified by: 5 digits (starting 7 or 8) immediately followed by an uppercase letter
 * Order Ref is: exactly 8 digits not adjacent to other digits
 */
export function parsePickwaveRecords(fullText) {
  const records = [];
  if (!fullText) return records;

  // 1. Find all SKUs in order of appearance
  const skuPattern = /(?<!\d)(\d{5}(?:-[A-Z]|-\d{1,2})?)(?=[A-Z])/g;
  const skus = [];
  let m;
  while ((m = skuPattern.exec(fullText)) !== null) {
    const val = m[1].toUpperCase();
    // Pure 5-digit SKUs must start with 7 or 8
    if (/^\d+$/.test(val) && !/^[78]/.test(val)) continue;
    skus.push({ sku: val, index: m.index });
  }

  // 2. Find all Order References (8-digit numbers)
  const orderRefPattern = /(?<!\d)(\d{8})(?!\d)/g;
  const orderRefs = [];
  while ((m = orderRefPattern.exec(fullText)) !== null) {
    orderRefs.push({ ref: m[1], index: m.index });
  }

  // 3. For each Order Reference, collect all SKUs that appeared before it
  //    (since the last Order Reference). This handles multi-SKU + quantity.
  let skuIdx = 0;
  for (const ref of orderRefs) {
    const orderSkus = [];
    while (skuIdx < skus.length && skus[skuIdx].index < ref.index) {
      orderSkus.push(skus[skuIdx].sku);
      skuIdx++;
    }
    if (orderSkus.length === 0) continue;

    // Count quantities
    const counts = {};
    for (const s of orderSkus) counts[s] = (counts[s] || 0) + 1;
    const parts = Object.entries(counts).map(([s, qty]) =>
      qty > 1 ? `${s} (Qty:${qty})` : s
    );
    records.push({ orderRef: ref.ref, sku: parts.join(' + ') });
  }

  console.log(`Parsed ${records.length} Pickwave records`);
  return records;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main: stamp labels PDF with SKU IDs
// ─────────────────────────────────────────────────────────────────────────────

export async function processLabelsPdf(labelsPdfBuffer, pickwaveRecords) {
  const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');

  // 1. Parse Pickwave
  let pickwaveList = [];
  if (typeof pickwaveRecords === 'string') {
    pickwaveList = parsePickwaveRecords(pickwaveRecords);
  } else if (Array.isArray(pickwaveRecords)) {
    pickwaveList = parsePickwaveRecords(pickwaveRecords.join('\n'));
  }
  console.log(`Pickwave loaded: ${pickwaveList.length} records`);

  // 2. Load labels PDF with pdfjs for text/image extraction
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.js');
  const parsedPdf = await pdfjsLib.getDocument({
    data: new Uint8Array(labelsPdfBuffer),
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
    disableWorker: true,
  }).promise;
  const numPages = parsedPdf.numPages;

  // 3. Init Tesseract — only used for image-only pages (no text layer)
  let worker = null;
  try {
    const { createWorker } = await import('tesseract.js');
    worker = await createWorker('eng', 1, {
      logger: () => {},
      cachePath: os.tmpdir(),
    });
    console.log('Tesseract ready');
  } catch (e) {
    console.warn('Tesseract unavailable:', e.message);
  }

  // 4. Extract TrxRefNo + billing position from each label page
  const pageResults = [];

  for (let i = 1; i <= numPages; i++) {
    try {
      const page = await parsedPdf.getPage(i);
      const textContent = await page.getTextContent();
      let fullText = textContent.items.map(item => item.str).join(' ');
      let billingX = null;
      let billingY = null;

      // Find BILLING anchor in text layer for stamp placement
      for (const item of textContent.items) {
        if (/billing/i.test(item.str)) {
          billingX = item.transform[4];
          billingY = item.transform[5];
          break;
        }
      }

      // Try to extract TrxRefNo from text layer first
      let trxRefNo = extractTrxRefNo(fullText);

      // If no text layer (pure image label), fall back to OCR
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
                imageObj = await new Promise(resolve =>
                  page.objs.get(imgName, obj => resolve(obj))
                );
                if (imageObj && imageObj.data) break;
              } catch (_) {}
            }
          }

          if (imageObj && imageObj.data) {
            // Convert image pixel data to PNG buffer for Tesseract
            const png = new PNG({ width: imageObj.width, height: imageObj.height });
            const px = imageObj.width * imageObj.height;
            if (imageObj.data.length === px * 4) {
              png.data.set(imageObj.data);
            } else if (imageObj.data.length === px * 3) {
              for (let p = 0; p < px; p++) {
                png.data[p * 4]     = imageObj.data[p * 3];
                png.data[p * 4 + 1] = imageObj.data[p * 3 + 1];
                png.data[p * 4 + 2] = imageObj.data[p * 3 + 2];
                png.data[p * 4 + 3] = 255;
              }
            } else if (imageObj.data.length === px) {
              for (let p = 0; p < px; p++) {
                const v = imageObj.data[p];
                png.data[p * 4] = png.data[p * 4 + 1] = png.data[p * 4 + 2] = v;
                png.data[p * 4 + 3] = 255;
              }
            }

            const imgBuf = PNG.sync.write(png);
            const { data } = await worker.recognize(imgBuf);
            fullText = data.text;
            trxRefNo = extractTrxRefNo(fullText);

            // Get billing Y from OCR word positions
            if (billingY === null && data.words) {
              const anchor = data.words.find(w => /billing/i.test(w.text));
              if (anchor) {
                const vp = page.getViewport({ scale: 1.0 });
                billingX = anchor.bbox.x0 / (imageObj.width / vp.width);
                billingY = vp.height - anchor.bbox.y1 / (imageObj.height / vp.height);
              }
            }
          }
        } catch (ocrErr) {
          console.warn(`Page ${i}: OCR error: ${ocrErr.message}`);
        }
      }

      pageResults.push({ trxRefNo, billingX, billingY });
      console.log(`Page ${i}: TrxRef="${trxRefNo}", billingY=${billingY?.toFixed(1) ?? 'null'}`);
    } catch (err) {
      console.error(`Page ${i}: error: ${err.message}`);
      pageResults.push({ trxRefNo: null, billingX: null, billingY: null });
    }
  }

  if (worker) await worker.terminate();

  // 5. Stamp SKU IDs onto the PDF with pdf-lib
  const pdfDoc = await PDFDocument.load(labelsPdfBuffer);
  const pdfPages = pdfDoc.getPages();
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  let matchedCount = 0;

  for (let i = 0; i < numPages; i++) {
    const { trxRefNo, billingX, billingY } = pageResults[i];
    if (!trxRefNo) {
      console.warn(`Page ${i + 1}: No TrxRefNo — skipping`);
      continue;
    }

    const record = pickwaveList.find(r => r.orderRef === trxRefNo);
    if (!record) {
      console.warn(`Page ${i + 1}: No Pickwave match for TrxRef="${trxRefNo}"`);
      continue;
    }

    const pdfPage = pdfPages[i];
    const { width: pageWidth, height: pageHeight } = pdfPage.getSize();
    const fontSize = 10;

    // Stamp just below the BILLING line if found, else bottom of page
    let textX = Math.max(5, Math.min(billingX ?? 20, pageWidth - 150));
    let textY = billingY !== null
      ? Math.max(fontSize + 5, billingY - 18)
      : pageHeight * 0.08;
    textY = Math.max(fontSize + 5, Math.min(textY, pageHeight - 5));

    const skuText = `SKU: ${record.sku}`;
    const textWidth = font.widthOfTextAtSize(skuText, fontSize);

    pdfPage.drawRectangle({
      x: textX - 4, y: textY - 4,
      width: textWidth + 8, height: fontSize + 8,
      color: rgb(1, 0.92, 0.2),
    });
    pdfPage.drawText(skuText, {
      x: textX, y: textY,
      size: fontSize, font, color: rgb(0, 0, 0),
    });

    console.log(`✓ Page ${i + 1}: ${skuText}`);
    matchedCount++;
  }

  const bytes = await pdfDoc.save();
  return { buffer: Buffer.from(bytes), matchedCount, totalPages: numPages };
}
