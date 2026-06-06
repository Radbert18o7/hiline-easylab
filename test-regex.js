const fullText = "THE HOME DEPOT78415-A SOLAR FLORAL GLASS";
const skuPattern = /(?<!\d)(\d{4,6}(?:-[A-Z0-9]{1,3})?)/g;
let m;
while ((m = skuPattern.exec(fullText)) !== null) {
  console.log("MATCHED:", m[1]);
}
