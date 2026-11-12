const fs = require('fs');
const path = require('path');
const asarPath = 'D:\\apps\\DeepSeek Harness\\DSH NEXT\\resources\\app.asar';
const fd = fs.openSync(asarPath, 'r');
const stat = fs.fstatSync(fd);
const headerSizeBuf = Buffer.alloc(8);
fs.readSync(fd, headerSizeBuf, 0, 8, 0);
const headerSize = headerSizeBuf.readUInt32LE(4); // lower 32 bits
// header starts at offset 8, length headerSize
let offset = 8 + headerSize;
let pos = 8;
const headerBuf = Buffer.alloc(headerSize);
fs.readSync(fd, headerBuf, 0, headerSize, pos);
const header = JSON.parse(headerBuf.toString('utf8'));
// Build full path -> fileInfo
const files = header.files;
function walk(obj, prefix) {
  for (const [name, info] of Object.entries(obj)) {
    const full = prefix ? prefix + '/' + name : name;
    if (info.files) {
      walk(info.files, full);
    } else if (typeof info.size === 'number' || info.offset !== undefined) {
      found[full] = info;
    }
  }
}
const found = {};
walk(files, '');
// Search for catalog.js containing buildModelCatalog
const matches = Object.keys(found).filter(p => /catalog\.js$/.test(p) || /session-controller.*\.js$/.test(p));
console.log('CATALOG/SC JS FILES:');
for (const m of matches.slice(0, 40)) console.log('  ' + m);
// also find any file with 'buildModelCatalog' text by scanning? too big. Instead search known package dirs.
console.log('TOTAL FILES IN ASAR:', Object.keys(found).length);
