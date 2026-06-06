/**
 * Server-side OCR helpers using Tesseract.js
 * Processes PDF pages rendered via pdfjs-dist
 */
import os from 'os';
import path from 'path';

/**
 * Extract text from a single image/canvas data URL using Tesseract
 */
export async function ocrImageBuffer(imageBuffer) {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, {
    logger: m => console.log(m),
    cachePath: os.tmpdir(),
    corePath: path.join(process.cwd(), 'public', 'ocr', 'tesseract-core.wasm.js'),
  });
  const { data: { text } } = await worker.recognize(imageBuffer);
  await worker.terminate();
  return text;
}

/**
 * Parse pickwave document text into structured records
 * Extracts: SKU, Item Name, Quantity, Bin, Order ID, Order Reference, Shipping Address
 */
export function parsePickwaveText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const records = [];
  let currentRecord = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect order header lines — typically contain order ID patterns
    const orderMatch = line.match(/Order\s*(?:ID|#|No\.?)[\s:]*([A-Z0-9\-]+)/i);
    const orderRefMatch = line.match(/Order\s*Ref(?:erence)?[\s:]*([A-Z0-9\-\/]+)/i);

    if (orderMatch) {
      if (currentRecord) records.push(currentRecord);
      currentRecord = {
        orderId: orderMatch[1],
        orderRef: '',
        sku: '',
        itemName: '',
        quantity: 1,
        bin: '',
        address: '',
      };
    }

    if (currentRecord) {
      if (orderRefMatch) currentRecord.orderRef = orderRefMatch[1];

      // SKU pattern: alphanumeric, often prefixed with SKU:
      const skuMatch = line.match(/SKU[\s:]+([A-Z0-9\-]+)/i) ||
                       line.match(/^([A-Z]{2,}\d{3,}[A-Z0-9\-]*)$/);
      if (skuMatch && !currentRecord.sku) currentRecord.sku = skuMatch[1];

      // Quantity
      const qtyMatch = line.match(/Qty[\s:]+(\d+)/i) ||
                       line.match(/Quantity[\s:]+(\d+)/i) ||
                       line.match(/^(\d+)\s+(?:units?|pcs?|pieces?)/i);
      if (qtyMatch) currentRecord.quantity = parseInt(qtyMatch[1], 10);

      // Bin
      const binMatch = line.match(/Bin[\s:]+([A-Z0-9\-]+)/i);
      if (binMatch) currentRecord.bin = binMatch[1];

      // Item name — typically a longer text line after SKU
      if (line.length > 10 && !skuMatch && !qtyMatch && !binMatch && !orderMatch && !orderRefMatch) {
        if (!currentRecord.itemName) currentRecord.itemName = line;
        else if (line.match(/[A-Z][a-z]/) && currentRecord.itemName.length < 5) {
          currentRecord.itemName = line;
        }
      }
    }
  }

  if (currentRecord) records.push(currentRecord);
  return records;
}

/**
 * Parse labels document text into structured records
 * Extracts: Trx Ref No., Purchase No., Recipient Name, Address, page index
 */
export function parseLabelsText(pageTexts) {
  return pageTexts.map((text, pageIndex) => {
    const record = {
      pageIndex,
      trxRefNo: '',
      purchaseNo: '',
      recipientName: '',
      address: '',
      rawText: text,
    };

    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Trx Ref No — matches "Trx Ref No" or "Transaction Reference"
      const trxMatch = line.match(/Trx\s*Ref\s*(?:No\.?|Number)?[\s:]*([A-Z0-9\-\/]+)/i) ||
                       line.match(/(?:Transaction|Trx)\s*Reference[\s:]*([A-Z0-9\-\/]+)/i);
      if (trxMatch) record.trxRefNo = trxMatch[1].trim();

      // Purchase No
      const purchaseMatch = line.match(/Purchase\s*(?:No\.?|Number)?[\s:]*([A-Z0-9\-]+)/i);
      if (purchaseMatch) record.purchaseNo = purchaseMatch[1].trim();

      // After "SHIP TO:" or "RECIPIENT:" grab name and address
      if (/SHIP\s*TO|RECIPIENT|DELIVER\s*TO/i.test(line) && i + 1 < lines.length) {
        record.recipientName = lines[i + 1] || '';
        record.address = lines.slice(i + 2, i + 5).join(', ');
      }
    }

    return record;
  });
}

/**
 * Find "BILLING: 3RD PARTY" text position in OCR result
 * Returns { x, y } in canvas/image coordinates, or null
 */
export function findBillingPosition(ocrData) {
  if (!ocrData || !ocrData.words) return null;

  // Look for "BILLING" word
  const billingWord = ocrData.words.find(w =>
    w.text.toLowerCase().includes('billing')
  );

  if (!billingWord) return null;

  // Return bottom of the billing line (y position below it)
  const bbox = billingWord.bbox;
  return {
    x: bbox.x0,
    y: bbox.y1 + 5, // just below the BILLING line
    lineHeight: bbox.y1 - bbox.y0,
  };
}
