const fs = require('fs');
const path = 'C:\\Users\\raulj\\user_inputs.jsonl';
const content = fs.readFileSync(path, 'utf-8');
const lines = content.trim().split('\n');
lines.forEach((line, i) => {
  try {
    const obj = JSON.parse(line);
    console.log(`\n--- USER INPUT ${i} ---`);
    console.log(obj.content);
  } catch(e) {}
});
