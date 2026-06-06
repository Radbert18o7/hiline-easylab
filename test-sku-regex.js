const strings = [
  "87703-IHOWLING BEAGLE",
  "87728-ACAT SLEEPING",
  "87938PIG-SITTING",
  "87675-IMONKEY",
  "87719-CFOX",
  "87771-07PANDA"
];

const regex = /(?<!\d)(\d{4,6}(?:-[A-Z]|-\d{2})?)/g;

for (const s of strings) {
  let m = regex.exec(s);
  if (m) {
    console.log(`${s} -> ${m[1]}`);
  }
  regex.lastIndex = 0;
}
