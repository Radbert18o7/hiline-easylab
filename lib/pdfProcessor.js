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
 */
function findTrxRefByDirectMatch(text, pickwaveList) {
  if (!text || !pickwaveList.length) return null;
  const allNums = text.match(/\d{8}/g) || [];
  for (const num of allNums) {
    if (pickwaveList.find(r => r.orderRef === num)) {
      console.log(`[findTrxRefByDirectMatch] Direct pickwave hit: ${num}`);
      return num;
    }
  }
  return null;
}

/**
 * Replace Tesseract with an external cloud OCR API to bypass Vercel bundle limits.
 */
async function performCloudOCR(pngBuffer) {
  console.log(`[performCloudOCR] Sending ${pngBuffer.length} bytes to OCR.Space...`);
  try {
    const formData = new FormData();
    const blob = new Blob([pngBuffer], { type: 'image/png' });
    formData.append('file', blob, 'image.png');
    formData.append('apikey', 'K86968038988957'); // Public Free OCR API Key
    formData.append('language', 'eng');
    formData.append('isOverlayRequired', 'true'); // Required for bounding boxes

    const response = await fetch('https://api.ocr.space/parse/image', {
      method: 'POST',
      body: formData
    });
    
    if (!response.ok) {
      console.error(`[performCloudOCR] API error: ${response.status}`);
      return { text: '', words: [] };
    }
    
    const data = await response.json();
    if (data.IsErroredOnProcessing || !data.ParsedResults || !data.ParsedResults.length) {
      console.error(`[performCloudOCR] Processing error: ${data.ErrorMessage || 'Empty result'}`);
      return { text: '', words: [] };
    }

    const result = data.ParsedResults[0];
    const text = result.ParsedText || '';
    
    const words = [];
    if (result.TextOverlay && result.TextOverlay.Lines) {
      for (const line of result.TextOverlay.Lines) {
        for (const word of line.Words) {
          words.push({
            text: word.WordText,
            bbox: {
              x0: word.Left,
              y0: word.Top,
              x1: word.Left + word.Width,
              y1: word.Top + word.Height
            }
          });
        }
      }
    }
    console.log(`[performCloudOCR] Success! Found ${words.length} words.`);
    return { text, words };
  } catch (err) {
    console.error(`[performCloudOCR] Request failed: ${err.message}`);
    return { text: '', words: [] };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pickwave parser
// ─────────────────────────────────────────────────────────────────────────────

export function parsePickwaveRecords(fullText) {
  console.log('[parsePickwaveRecords] Text length:', fullText ? fullText.length : 0);
  const records = [];
  if (!fullText) return records;

  const skuPattern = /(?<!\d)(\d{5}(?:-[A-Z]|-\d{1,2})?)(?=[A-Z])/g;
  const skus = [];
  let m;
  while ((m = skuPattern.exec(fullText)) !== null) {
    const val = m[1].toUpperCase();
    if (/^\d+$/.test(val) && !/^[78]/.test(val)) continue;
    skus.push({ sku: val, index: m.index });
  }

  const orderRefPattern = /(?<!\d)(\d{8})(?!\d)/g;
  const orderRefs = [];
  while ((m = orderRefPattern.exec(fullText)) !== null) {
    orderRefs.push({ ref: m[1], index: m.index });
  }

  // Group by linking each Order Reference to the most recently seen SKU.
  // This correctly handles multiple Order References sharing the same SKU.
  for (const ref of orderRefs) {
    // Find all SKUs that appear BEFORE this order ref in the text
    const precedingSkus = skus.filter(s => s.index < ref.index);
    if (precedingSkus.length === 0) continue; // No SKU appeared before this order ref yet
    
    // The relevant SKU for this order is the most recent one seen before it
    const associatedSku = precedingSkus[precedingSkus.length - 1].sku;
    records.push({ orderRef: ref.ref, sku: associatedSku });
  }

  console.log(`[parsePickwaveRecords] Found ${skus.length} SKUs, ${orderRefs.length} OrderRefs. Grouped into ${records.length} records.`);
  return records;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

export async function processLabelsPdf(labelsPdfBuffer, pickwaveRecords) {
  console.log('[processLabelsPdf] START — labelsBuffer:', labelsPdfBuffer?.length, 'bytes');

  const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');

  let pickwaveList = [];
  if (typeof pickwaveRecords === 'string') {
    pickwaveList = parsePickwaveRecords(pickwaveRecords);
  } else if (Array.isArray(pickwaveRecords)) {
    pickwaveList = parsePickwaveRecords(pickwaveRecords.join('\n'));
  }
  console.log(`[processLabelsPdf] Pickwave: ${pickwaveList.length} records`);

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

  const pageResults = [];

  for (let i = 1; i <= numPages; i++) {
    console.log(`\n[Page ${i}/${numPages}] ─────`);
    try {
      const page = await parsedPdf.getPage(i);
      const textContent = await page.getTextContent();
      let fullText = textContent.items.map(item => item.str).join(' ');
      let billingX = null;
      let billingY = null;

      for (const item of textContent.items) {
        if (/billing/i.test(item.str)) {
          billingX = item.transform[4];
          billingY = item.transform[5];
          console.log(`[Page ${i}] BILLING found at x=${billingX?.toFixed(0)} y=${billingY?.toFixed(0)}`);
          break;
        }
      }

      let trxRefNo = extractTrxRefNo(fullText);

      // Fallback to OCR.Space for image-only pages
      if (!trxRefNo && fullText.trim().length < 20) {
        console.log(`[Page ${i}] No text layer — triggering Cloud OCR`);
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
                const obj = await new Promise(resolve => page.objs.get(imgName, o => resolve(o)));
                if (obj && obj.data) {
                  imageObj = obj;
                  break;
                }
              } catch (e2) {}
            }
          }

          if (imageObj && imageObj.data) {
            const png = new PNG({ width: imageObj.width, height: imageObj.height });
            const px = imageObj.width * imageObj.height;

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
            }

            const imgBuf = PNG.sync.write(png);
            const { text: ocrText, words } = await performCloudOCR(imgBuf);
            
            fullText = ocrText;
            trxRefNo = extractTrxRefNo(ocrText) || findTrxRefByDirectMatch(ocrText, pickwaveList);
            console.log(`[Page ${i}] Cloud OCR TrxRef: "${trxRefNo}"`);

            if (billingY === null && words.length > 0) {
              const anchor = words.find(w => /billing/i.test(w.text));
              if (anchor) {
                const vp = page.getViewport({ scale: 1.0 });
                billingX = anchor.bbox.x0 / (imageObj.width / vp.width);
                billingY = vp.height - anchor.bbox.y1 / (imageObj.height / vp.height);
                console.log(`[Page ${i}] OCR billing at x=${billingX?.toFixed(0)} y=${billingY?.toFixed(0)}`);
              }
            }
          }
        } catch (ocrErr) {
          console.error(`[Page ${i}] Cloud OCR error: ${ocrErr.message}`);
        }
      }

      pageResults.push({ trxRefNo, billingX, billingY });
      console.log(`[Page ${i}] FINAL: TrxRef="${trxRefNo}" billingX=${billingX?.toFixed(0)} billingY=${billingY?.toFixed(0)}`);

    } catch (err) {
      console.error(`[Page ${i}] CRASH: ${err.message}`);
      pageResults.push({ trxRefNo: null, billingX: null, billingY: null });
    }
  }

  console.log('\n[processLabelsPdf] Stamping PDF...');
  const pdfDoc = await PDFDocument.load(labelsPdfBuffer);
  const pdfPages = pdfDoc.getPages();
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  let matchedCount = 0;

  for (let i = 0; i < numPages; i++) {
    const { trxRefNo, billingX, billingY } = pageResults[i];
    if (!trxRefNo) continue;

    const record = pickwaveList.find(r => r.orderRef === trxRefNo);
    if (!record) {
      console.log(`[Stamp ${i+1}] SKIP: TrxRef="${trxRefNo}" NOT found in Pickwave!`);
      continue;
    }

    const pdfPage = pdfPages[i];
    const { width: pageWidth, height: pageHeight } = pdfPage.getSize();
    const fontSize = 10;
    let textX = Math.max(5, Math.min(billingX ?? 20, pageWidth - 150));
    let textY = billingY !== null ? Math.max(fontSize + 5, billingY - 18) : pageHeight * 0.08;
    textY = Math.max(fontSize + 5, Math.min(textY, pageHeight - 5));

    const skuText = `SKU: ${record.sku}`;
    const textWidth = font.widthOfTextAtSize(skuText, fontSize);
    pdfPage.drawRectangle({
      x: textX - 4, y: textY - 4,
      width: textWidth + 8, height: fontSize + 8,
      color: rgb(1, 0.92, 0.2),
    });
    pdfPage.drawText(skuText, { x: textX, y: textY, size: fontSize, font, color: rgb(0,0,0) });
    console.log(`[Stamp ${i+1}] ✓ TrxRef="${trxRefNo}" → ${skuText}`);
    matchedCount++;
  }

  console.log(`[processLabelsPdf] DONE: ${matchedCount}/${numPages} matched`);
  const bytes = await pdfDoc.save();
  return { buffer: Buffer.from(bytes), matchedCount, totalPages: numPages };
}
