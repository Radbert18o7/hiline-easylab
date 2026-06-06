const fullText = "THE HOME DEPOT78415-A SOLAR FLORAL GLASS 48866310 123456789";
const skuPattern = /(?<!\d)(\d{4,6}(?:-[A-Z0-9]{1,3})?)(?!\d)/g;
let m;
while ((m = skuPattern.exec(fullText)) !== null) {
  console.log("MATCHED:", m[1]);
}
