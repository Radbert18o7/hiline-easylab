import os from 'os';
import { PNG } from 'pngjs';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function extractTrxRefNo(text) {
  console.log('[extractTrxRefNo] Input text length:', text ? text.length : 0);
  console.log('[extractTrxRefNo] First 200 chars:', text ? JSON.stringify(text.substring(0, 200)) : 'NULL');
  if (!text) return null;

  const patterns = [
    /Trx\s*Ref\s*No[.:]*\s*([0-9]{8})/i,
    /TRX\s*REF[.:]*\s*([0-9]{8})/i,
    /Ref\s*No[.:]*\s*([0-9]{8})/i,
    /(?:Trx|Ref)[^0-9]{0,20}([0-9]{8})/i,
  ];

  for (let p = 0; p < patterns.length; p++) {
    const m = text.match(patterns[p]);
    if (m) {
      console.log(`[extractTrxRefNo] Pattern #${p} matched: "${m[1]}"`);
      return m[1].trim();
    }
  }
  console.log('[extractTrxRefNo] No exact pattern matched, trying fuzzy...');

  const fuzzy = text.match(/(?:ref|raf|ret|trx|tre)[^0-9]{0,25}([0-9]{8})/i);
  if (fuzzy) {
    console.log(`[extractTrxRefNo] Fuzzy matched: "${fuzzy[1]}"`);
    return fuzzy[1];
  }

  if (/purchase|billing|3rd\s*party/i.test(text)) {
    console.log('[extractTrxRefNo] Found billing/purchase, scanning for 8-digit number...');
    const nums = text.match(/\b([0-9]{8})\b/g);
    console.log('[extractTrxRefNo] All 8-digit numbers found:', nums);
    if (nums && nums.length > 0) return nums[nums.length - 1];
  }

  console.log('[extractTrxRefNo] FAILED — returning null');
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pickwave parser
// ─────────────────────────────────────────────────────────────────────────────

export function parsePickwaveRecords(fullText) {
  console.log('[parsePickwaveRecords] Called. Text length:', fullText ? fullText.length : 0);
  const records = [];
  if (!fullText) {
    console.log('[parsePickwaveRecords] Empty text — returning []');
    return records;
  }

  // 1. Find all SKUs
  const skuPattern = /(?<!\d)(\d{5}(?:-[A-Z]|-\d{1,2})?)(?=[A-Z])/g;
  const skus = [];
  let m;
  while ((m = skuPattern.exec(fullText)) !== null) {
    const val = m[1].toUpperCase();
    if (/^\d+$/.test(val) && !/^[78]/.test(val)) {
      console.log(`[parsePickwaveRecords] Skipping non-SKU number: ${val}`);
      continue;
    }
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

  // 3. For each Order Reference, group all SKUs that appeared before it
  let skuIdx = 0;
  for (const ref of orderRefs) {
    const orderSkus = [];
    while (skuIdx < skus.length && skus[skuIdx].index < ref.index) {
      orderSkus.push(skus[skuIdx].sku);
      skuIdx++;
    }
    if (orderSkus.length === 0) {
      console.log(`[parsePickwaveRecords] OrderRef ${ref.ref} has NO SKUs before it — skipping`);
      continue;
    }
    const counts = {};
    for (const s of orderSkus) counts[s] = (counts[s] || 0) + 1;
    const parts = Object.entries(counts).map(([s, qty]) =>
      qty > 1 ? `${s} (Qty:${qty})` : s
    );
    const skuDisplay = parts.join(' + ');
    console.log(`[parsePickwaveRecords] OrderRef ${ref.ref} → SKU: "${skuDisplay}"`);
    records.push({ orderRef: ref.ref, sku: skuDisplay });
  }

  console.log(`[parsePickwaveRecords] Final: ${records.length} records`);
  return records;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main: stamp labels PDF with SKU IDs
// ─────────────────────────────────────────────────────────────────────────────

export async function processLabelsPdf(labelsPdfBuffer, pickwaveRecords) {
  console.log('[processLabelsPdf] START');
  console.log('[processLabelsPdf] labelsPdfBuffer size:', labelsPdfBuffer ? labelsPdfBuffer.length : 0);
  console.log('[processLabelsPdf] pickwaveRecords type:', typeof pickwaveRecords, '| length:', pickwaveRecords ? pickwaveRecords.length : 0);

  const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');
  console.log('[processLabelsPdf] pdf-lib imported OK');

  // 1. Parse Pickwave
  let pickwaveList = [];
  if (typeof pickwaveRecords === 'string') {
    console.log('[processLabelsPdf] Parsing pickwaveRecords as string...');
    pickwaveList = parsePickwaveRecords(pickwaveRecords);
  } else if (Array.isArray(pickwaveRecords)) {
    console.log('[processLabelsPdf] Parsing pickwaveRecords as array, joining...');
    pickwaveList = parsePickwaveRecords(pickwaveRecords.join('\n'));
  } else {
    console.log('[processLabelsPdf] WARNING: pickwaveRecords is neither string nor array!', typeof pickwaveRecords);
  }
  console.log(`[processLabelsPdf] Pickwave loaded: ${pickwaveList.length} records:`, JSON.stringify(pickwaveList));

  // 2. Load labels PDF with pdfjs
  console.log('[processLabelsPdf] Importing pdfjs-dist...');
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.js');
  console.log('[processLabelsPdf] pdfjs-dist imported OK');

  const parsedPdf = await pdfjsLib.getDocument({
    data: new Uint8Array(labelsPdfBuffer),
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
    disableWorker: true,
  }).promise;
  const numPages = parsedPdf.numPages;
  console.log(`[processLabelsPdf] PDF loaded OK — ${numPages} pages`);

  // 3. Init Tesseract (only for image-only pages)
  let worker = null;
  try {
    console.log('[processLabelsPdf] Initializing Tesseract...');
    const { createWorker } = await import('tesseract.js');
    worker = await createWorker('eng', 1, {
      logger: () => {},
      cachePath: os.tmpdir(),
    });
    console.log('[processLabelsPdf] Tesseract ready. cachePath:', os.tmpdir());
  } catch (e) {
    console.warn('[processLabelsPdf] Tesseract FAILED to init:', e.message, e.stack);
  }

  // 4. Extract TrxRefNo + billing coords from each page
  const pageResults = [];

  for (let i = 1; i <= numPages; i++) {
    console.log(`\n[Page ${i}] ── Processing ──`);
    try {
      const page = await parsedPdf.getPage(i);
      console.log(`[Page ${i}] getPage OK`);

      const textContent = await page.getTextContent();
      const allStrings = textContent.items.map(item => item.str);
      let fullText = allStrings.join(' ');
      console.log(`[Page ${i}] Text items: ${textContent.items.length} | fullText length: ${fullText.length}`);
      console.log(`[Page ${i}] fullText sample: ${JSON.stringify(fullText.substring(0, 300))}`);

      let billingX = null;
      let billingY = null;

      // Find BILLING anchor for stamp placement
      for (const item of textContent.items) {
        if (/billing/i.test(item.str)) {
          billingX = item.transform[4];
          billingY = item.transform[5];
          console.log(`[Page ${i}] Found BILLING item: "${item.str}" at x=${billingX} y=${billingY}`);
          break;
        }
      }

      let trxRefNo = extractTrxRefNo(fullText);
      console.log(`[Page ${i}] TrxRefNo from text layer: "${trxRefNo}"`);

      // Fallback to OCR if no text layer
      if (!trxRefNo && fullText.trim().length < 20 && worker) {
        console.log(`[Page ${i}] Short text (${fullText.trim().length} chars) — triggering OCR...`);
        try {
          const operatorList = await page.getOperatorList();
          console.log(`[Page ${i}] Operator list: ${operatorList.fnArray.length} ops`);
          let imageObj = null;

          for (let j = 0; j < operatorList.fnArray.length; j++) {
            if (
              operatorList.fnArray[j] === pdfjsLib.OPS.paintImageXObject ||
              operatorList.fnArray[j] === pdfjsLib.OPS.paintJpegXObject
            ) {
              const imgName = operatorList.argsArray[j][0];
              console.log(`[Page ${i}] Found image op at j=${j}, imgName="${imgName}"`);
              try {
                imageObj = await new Promise(resolve =>
                  page.objs.get(imgName, obj => resolve(obj))
                );
                console.log(`[Page ${i}] imageObj: ${imageObj ? `w=${imageObj.width} h=${imageObj.height} kind=${imageObj.kind} dataLen=${imageObj.data?.length}` : 'NULL'}`);
                if (imageObj && imageObj.data) break;
              } catch (imgErr) {
                console.warn(`[Page ${i}] Failed to get image obj "${imgName}": ${imgErr.message}`);
              }
            }
          }

          if (imageObj && imageObj.data) {
            console.log(`[Page ${i}] Converting image to PNG for Tesseract...`);
            const png = new PNG({ width: imageObj.width, height: imageObj.height });
            const px = imageObj.width * imageObj.height;
            if (imageObj.data.length === px * 4) {
              console.log(`[Page ${i}] Using RGBA_32BPP path`);
              png.data.set(imageObj.data);
            } else if (imageObj.data.length === px * 3) {
              console.log(`[Page ${i}] Using RGB_24BPP path`);
              for (let p = 0; p < px; p++) {
                png.data[p * 4]     = imageObj.data[p * 3];
                png.data[p * 4 + 1] = imageObj.data[p * 3 + 1];
                png.data[p * 4 + 2] = imageObj.data[p * 3 + 2];
                png.data[p * 4 + 3] = 255;
              }
            } else if (imageObj.data.length === px) {
              console.log(`[Page ${i}] Using GRAYSCALE path`);
              for (let p = 0; p < px; p++) {
                const v = imageObj.data[p];
                png.data[p * 4] = png.data[p * 4 + 1] = png.data[p * 4 + 2] = v;
                png.data[p * 4 + 3] = 255;
              }
            } else {
              console.warn(`[Page ${i}] UNKNOWN pixel format: dataLen=${imageObj.data.length} px*3=${px*3} px*4=${px*4}`);
            }

            const imgBuf = PNG.sync.write(png);
            console.log(`[Page ${i}] Running Tesseract on ${imgBuf.length} byte PNG...`);
            const { data } = await worker.recognize(imgBuf);
            console.log(`[Page ${i}] OCR result text: ${JSON.stringify(data.text.substring(0, 200))}`);
            fullText = data.text;
            trxRefNo = extractTrxRefNo(fullText);
            console.log(`[Page ${i}] TrxRefNo from OCR: "${trxRefNo}"`);

            if (billingY === null && data.words) {
              const anchor = data.words.find(w => /billing/i.test(w.text));
              if (anchor) {
                const vp = page.getViewport({ scale: 1.0 });
                billingX = anchor.bbox.x0 / (imageObj.width / vp.width);
                billingY = vp.height - anchor.bbox.y1 / (imageObj.height / vp.height);
                console.log(`[Page ${i}] OCR billing anchor at x=${billingX?.toFixed(1)} y=${billingY?.toFixed(1)}`);
              }
            }
          } else {
            console.warn(`[Page ${i}] No image object found in operator list`);
          }
        } catch (ocrErr) {
          console.warn(`[Page ${i}] OCR error: ${ocrErr.message}\n${ocrErr.stack}`);
        }
      } else if (!trxRefNo) {
        console.log(`[Page ${i}] TrxRefNo null but text length ${fullText.trim().length} >= 20 — not trying OCR`);
      }

      pageResults.push({ trxRefNo, billingX, billingY });
      console.log(`[Page ${i}] RESULT: TrxRef="${trxRefNo}" billingX=${billingX?.toFixed(1)} billingY=${billingY?.toFixed(1)}`);

    } catch (err) {
      console.error(`[Page ${i}] CRASHED: ${err.message}\n${err.stack}`);
      pageResults.push({ trxRefNo: null, billingX: null, billingY: null });
    }
  }

  if (worker) {
    await worker.terminate();
    console.log('[processLabelsPdf] Tesseract worker terminated');
  }

  // 5. Stamp SKU IDs with pdf-lib
  console.log('\n[processLabelsPdf] Starting PDF stamping...');
  const pdfDoc = await PDFDocument.load(labelsPdfBuffer);
  const pdfPages = pdfDoc.getPages();
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  let matchedCount = 0;

  for (let i = 0; i < numPages; i++) {
    const { trxRefNo, billingX, billingY } = pageResults[i];
    console.log(`[Stamp ${i + 1}] TrxRef="${trxRefNo}" billingX=${billingX} billingY=${billingY}`);

    if (!trxRefNo) {
      console.warn(`[Stamp ${i + 1}] SKIP — no TrxRefNo`);
      continue;
    }

    const record = pickwaveList.find(r => r.orderRef === trxRefNo);
    console.log(`[Stamp ${i + 1}] Pickwave lookup for "${trxRefNo}": ${record ? `FOUND → "${record.sku}"` : 'NOT FOUND'}`);

    if (!record) {
      console.warn(`[Stamp ${i + 1}] SKIP — no Pickwave match`);
      continue;
    }

    const pdfPage = pdfPages[i];
    const { width: pageWidth, height: pageHeight } = pdfPage.getSize();
    console.log(`[Stamp ${i + 1}] Page size: ${pageWidth}x${pageHeight}`);

    const fontSize = 10;
    let textX = Math.max(5, Math.min(billingX ?? 20, pageWidth - 150));
    let textY = billingY !== null
      ? Math.max(fontSize + 5, billingY - 18)
      : pageHeight * 0.08;
    textY = Math.max(fontSize + 5, Math.min(textY, pageHeight - 5));

    const skuText = `SKU: ${record.sku}`;
    console.log(`[Stamp ${i + 1}] Drawing "${skuText}" at x=${textX.toFixed(1)} y=${textY.toFixed(1)}`);

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

    console.log(`[Stamp ${i + 1}] ✓ DONE`);
    matchedCount++;
  }

  console.log(`\n[processLabelsPdf] COMPLETE: ${matchedCount}/${numPages} matched`);
  const bytes = await pdfDoc.save();
  return { buffer: Buffer.from(bytes), matchedCount, totalPages: numPages };
}
