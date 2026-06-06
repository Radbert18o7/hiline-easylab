import os from 'os';
import { PNG } from 'pngjs';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract the 8-digit Trx Ref No from a label page's text.
 * Tries regex patterns first, then last resort: any 8-digit number.
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

  // Fuzzy: OCR garbling (e.g. "To Raf No.48866310")
  const fuzzy = text.match(/(?:ref|raf|ret|trx|tre)[^0-9]{0,25}([0-9]{8})/i);
  if (fuzzy) return fuzzy[1];

  return null;
}

/**
 * Given OCR text and a list of known pickwave order refs,
 * find which one appears in the text (any 8-digit number match).
 * This is more robust than regex because it doesn't rely on 
 * the surrounding "Trx Ref No." label being OCR-readable.
 */
function findTrxRefByDirectMatch(text, pickwaveList) {
  if (!text || !pickwaveList.length) return null;
  // Extract all runs of 8 consecutive digits from OCR output
  const allNums = text.match(/\d{8}/g) || [];
  console.log(`[findTrxRefByDirectMatch] 8-digit numbers found in OCR: [${allNums.join(', ')}]`);
  for (const num of allNums) {
    if (pickwaveList.find(r => r.orderRef === num)) {
      console.log(`[findTrxRefByDirectMatch] Direct pickwave hit: ${num}`);
      return num;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pickwave parser
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse Pickwave PDF text into records: { orderRef, sku }
 */
export function parsePickwaveRecords(fullText) {
  console.log('[parsePickwaveRecords] Text length:', fullText ? fullText.length : 0);
  const records = [];
  if (!fullText) return records;

  // 1. Find all SKUs in order of appearance
  const skuPattern = /(?<!\d)(\d{5}(?:-[A-Z]|-\d{1,2})?)(?=[A-Z])/g;
  const skus = [];
  let m;
  while ((m = skuPattern.exec(fullText)) !== null) {
    const val = m[1].toUpperCase();
    if (/^\d+$/.test(val) && !/^[78]/.test(val)) continue;
    skus.push({ sku: val, index: m.index });
  }
  console.log(`[parsePickwaveRecords] Found ${skus.length} SKUs:`, skus.map(s => s.sku).join(', '));

  // 2. Find all Order References (8-digit numbers)
  const orderRefPattern = /(?<!\d)(\d{8})(?!\d)/g;
  const orderRefs = [];
  while ((m = orderRefPattern.exec(fullText)) !== null) {
    orderRefs.push({ ref: m[1], index: m.index });
  }
  console.log(`[parsePickwaveRecords] Found ${orderRefs.length} order refs:`, orderRefs.map(r => r.ref).join(', '));

  // 3. Group SKUs that appeared before each Order Reference
  let skuIdx = 0;
  for (const ref of orderRefs) {
    const orderSkus = [];
    while (skuIdx < skus.length && skus[skuIdx].index < ref.index) {
      orderSkus.push(skus[skuIdx].sku);
      skuIdx++;
    }
    if (orderSkus.length === 0) continue;

    const counts = {};
    for (const s of orderSkus) counts[s] = (counts[s] || 0) + 1;
    const parts = Object.entries(counts).map(([s, qty]) =>
      qty > 1 ? `${s} (Qty:${qty})` : s
    );
    records.push({ orderRef: ref.ref, sku: parts.join(' + ') });
  }

  console.log(`[parsePickwaveRecords] Final: ${records.length} records`);
  return records;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

export async function processLabelsPdf(labelsPdfBuffer, pickwaveRecords) {
  console.log('[processLabelsPdf] START — labelsBuffer:', labelsPdfBuffer?.length, 'bytes');

  const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');

  // 1. Parse Pickwave
  let pickwaveList = [];
  if (typeof pickwaveRecords === 'string') {
    pickwaveList = parsePickwaveRecords(pickwaveRecords);
  } else if (Array.isArray(pickwaveRecords)) {
    pickwaveList = parsePickwaveRecords(pickwaveRecords.join('\n'));
  }
  console.log(`[processLabelsPdf] Pickwave: ${pickwaveList.length} records`);
  console.log('[processLabelsPdf] All orderRefs:', pickwaveList.map(r => r.orderRef).join(', '));

  // 2. Load labels PDF
  console.log('[processLabelsPdf] Loading labels PDF with pdfjs...');
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.js');
  const parsedPdf = await pdfjsLib.getDocument({
    data: new Uint8Array(labelsPdfBuffer),
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
    disableWorker: true,
  }).promise;
  const numPages = parsedPdf.numPages;
  console.log(`[processLabelsPdf] PDF loaded: ${numPages} pages`);

  // 3. Init Tesseract
  let worker = null;
  try {
    const { createWorker } = await import('tesseract.js');
    worker = await createWorker('eng', 1, {
      logger: () => {},
      cachePath: os.tmpdir(),
    });
    console.log('[processLabelsPdf] Tesseract ready');
  } catch (e) {
    console.warn('[processLabelsPdf] Tesseract init failed:', e.message);
  }

  // 4. Per-page extraction
  const pageResults = [];

  for (let i = 1; i <= numPages; i++) {
    console.log(`\n[Page ${i}/${numPages}] ─────`);
    try {
      const page = await parsedPdf.getPage(i);
      const textContent = await page.getTextContent();
      let fullText = textContent.items.map(item => item.str).join(' ');
      let billingX = null;
      let billingY = null;

      console.log(`[Page ${i}] textItems=${textContent.items.length} fullTextLen=${fullText.length}`);
      if (fullText.trim().length > 0) {
        console.log(`[Page ${i}] textSample=${JSON.stringify(fullText.substring(0, 200))}`);
      }

      // Find BILLING anchor for stamp placement
      for (const item of textContent.items) {
        if (/billing/i.test(item.str)) {
          billingX = item.transform[4];
          billingY = item.transform[5];
          console.log(`[Page ${i}] BILLING found at x=${billingX?.toFixed(0)} y=${billingY?.toFixed(0)}`);
          break;
        }
      }

      // Try text-layer extraction first
      let trxRefNo = extractTrxRefNo(fullText);
      console.log(`[Page ${i}] TrxRef from text layer: "${trxRefNo}"`);

      // Fallback to OCR for image-only pages
      if (!trxRefNo && fullText.trim().length < 20) {
        if (!worker) {
          console.warn(`[Page ${i}] No text layer AND no Tesseract — cannot match`);
        } else {
          console.log(`[Page ${i}] No text layer (${fullText.trim().length} chars) — starting OCR`);
          try {
            const operatorList = await page.getOperatorList();
            console.log(`[Page ${i}] Operator list: ${operatorList.fnArray.length} ops`);

            let imageObj = null;
            let imageCount = 0;
            for (let j = 0; j < operatorList.fnArray.length; j++) {
              if (
                operatorList.fnArray[j] === pdfjsLib.OPS.paintImageXObject ||
                operatorList.fnArray[j] === pdfjsLib.OPS.paintJpegXObject
              ) {
                imageCount++;
                const imgName = operatorList.argsArray[j][0];
                console.log(`[Page ${i}] Image op #${imageCount} at j=${j}, name="${imgName}"`);
                try {
                  const obj = await new Promise(resolve =>
                    page.objs.get(imgName, o => resolve(o))
                  );
                  console.log(`[Page ${i}] imageObj: ${obj ? `w=${obj.width} h=${obj.height} kind=${obj.kind} dataLen=${obj.data?.length}` : 'NULL'}`);
                  if (obj && obj.data) {
                    imageObj = obj;
                    break;
                  }
                } catch (e2) {
                  console.warn(`[Page ${i}] objs.get failed: ${e2.message}`);
                }
              }
            }
            console.log(`[Page ${i}] Total image ops found: ${imageCount}`);

            if (!imageObj || !imageObj.data) {
              console.warn(`[Page ${i}] No valid imageObj — OCR skipped`);
            } else {
              // Convert pixel data → PNG
              const png = new PNG({ width: imageObj.width, height: imageObj.height });
              const px = imageObj.width * imageObj.height;
              console.log(`[Page ${i}] Converting to PNG: ${imageObj.width}x${imageObj.height} (${px} px, format=${imageObj.data.length === px*4 ? 'RGBA' : imageObj.data.length === px*3 ? 'RGB' : imageObj.data.length === px ? 'GRAY' : 'UNKNOWN'})`);

              if (imageObj.data.length === px * 4) {
                png.data.set(imageObj.data);
              } else if (imageObj.data.length === px * 3) {
                for (let p = 0; p < px; p++) {
                  png.data[p*4]   = imageObj.data[p*3];
                  png.data[p*4+1] = imageObj.data[p*3+1];
                  png.data[p*4+2] = imageObj.data[p*3+2];
                  png.data[p*4+3] = 255;
                }
              } else if (imageObj.data.length === px) {
                for (let p = 0; p < px; p++) {
                  const v = imageObj.data[p];
                  png.data[p*4] = png.data[p*4+1] = png.data[p*4+2] = v;
                  png.data[p*4+3] = 255;
                }
              } else {
                console.warn(`[Page ${i}] Unknown pixel format: dataLen=${imageObj.data.length} vs px*3=${px*3}`);
              }

              const imgBuf = PNG.sync.write(png);
              console.log(`[Page ${i}] Running Tesseract on ${imgBuf.length} byte PNG...`);
              const { data } = await worker.recognize(imgBuf);
              const ocrText = data.text || '';
              console.log(`[Page ${i}] OCR text (${ocrText.length} chars): ${JSON.stringify(ocrText.substring(0, 400))}`);
              fullText = ocrText;

              // Strategy 1: regex patterns
              trxRefNo = extractTrxRefNo(ocrText);
              console.log(`[Page ${i}] TrxRef from regex: "${trxRefNo}"`);

              // Strategy 2: direct match — find any 8-digit number that's in our pickwave
              if (!trxRefNo) {
                trxRefNo = findTrxRefByDirectMatch(ocrText, pickwaveList);
                console.log(`[Page ${i}] TrxRef from direct match: "${trxRefNo}"`);
              }

              // Get billing position from OCR word bboxes
              if (billingY === null && data.words) {
                const anchor = data.words.find(w => /billing/i.test(w.text));
                if (anchor) {
                  const vp = page.getViewport({ scale: 1.0 });
                  billingX = anchor.bbox.x0 / (imageObj.width / vp.width);
                  billingY = vp.height - anchor.bbox.y1 / (imageObj.height / vp.height);
                  console.log(`[Page ${i}] OCR billing at x=${billingX?.toFixed(0)} y=${billingY?.toFixed(0)}`);
                }
              }
            }
          } catch (ocrErr) {
            console.error(`[Page ${i}] OCR error: ${ocrErr.message}`);
          }
        }
      }

      pageResults.push({ trxRefNo, billingX, billingY });
      console.log(`[Page ${i}] FINAL: TrxRef="${trxRefNo}" billingX=${billingX?.toFixed(0)} billingY=${billingY?.toFixed(0)}`);

    } catch (err) {
      console.error(`[Page ${i}] CRASH: ${err.message}`);
      pageResults.push({ trxRefNo: null, billingX: null, billingY: null });
    }
  }

  if (worker) await worker.terminate();

  // 5. Stamp
  console.log('\n[processLabelsPdf] Stamping PDF...');
  const pdfDoc = await PDFDocument.load(labelsPdfBuffer);
  const pdfPages = pdfDoc.getPages();
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  let matchedCount = 0;

  for (let i = 0; i < numPages; i++) {
    const { trxRefNo, billingX, billingY } = pageResults[i];
    if (!trxRefNo) {
      console.warn(`[Stamp ${i+1}] SKIP — no TrxRefNo`);
      continue;
    }

    const record = pickwaveList.find(r => r.orderRef === trxRefNo);
    if (!record) {
      console.warn(`[Stamp ${i+1}] SKIP — no pickwave match for "${trxRefNo}"`);
      continue;
    }

    const pdfPage = pdfPages[i];
    const { width: pageWidth, height: pageHeight } = pdfPage.getSize();
    const fontSize = 10;
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
    pdfPage.drawText(skuText, { x: textX, y: textY, size: fontSize, font, color: rgb(0,0,0) });
    console.log(`[Stamp ${i+1}] ✓ TrxRef="${trxRefNo}" → ${skuText} at x=${textX.toFixed(0)} y=${textY.toFixed(0)}`);
    matchedCount++;
  }

  console.log(`[processLabelsPdf] DONE: ${matchedCount}/${numPages} matched`);
  const bytes = await pdfDoc.save();
  return { buffer: Buffer.from(bytes), matchedCount, totalPages: numPages };
}
