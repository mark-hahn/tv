import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const homePagePath = path.resolve(__dirname, '..', 'samples', 'sample-reelgood', 'homepage.html');
const html = fs.readFileSync(homePagePath, 'utf8');

const rx_short = /show:.*?:@global/g;
const rx_full = /"show:.*?:@global": ?\{(.*?)\}/sg;

const matches_short = [...html.matchAll(rx_short)];
const matches_full = [...html.matchAll(rx_full)];

console.log('Short regex matches:', matches_short.length);
console.log('Full regex matches:', matches_full.length);
console.log('\n--- Example where short matches but full does not ---\n');

// Find first occurrence where short matches but full doesn't
for (let i = 0; i < Math.min(20, matches_short.length); i++) {
  const pos = matches_short[i].index;
  const context = html.substring(pos - 50, pos + 300);
  
  // Check if this position has a full match
  const rx_full_test = /"show:.*?:@global": ?\{/s;
  if (!rx_full_test.test(html.substring(pos - 5, pos + 200))) {
    console.log('Position:', pos);
    console.log('Context:');
    console.log(context.replace(/\n/g, '\\n').substring(0, 250));
    console.log('\n---\n');
    break;
  }
}
