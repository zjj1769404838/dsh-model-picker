// 从 app.asar 重建最小 DSH host root：把 /node_modules/@deepseek-ai/** 全部抽到
// tmp/host-root/node_modules/@deepseek-ai/，供 host-resolve-hooks.mjs 解析。
// 之前的临时解压目录 C:/Users/.../Temp/asarx/dsh 被系统清理，导致 smoke-plugin-record 找不到包。
// 只抽运行时需要的文件类型；unpacked 条目回退到 app.asar.unpacked 磁盘文件。
const fs = require('fs')
const path = require('path')

const asarPath = 'D:\\apps\\DeepSeek Harness\\DSH NEXT\\resources\\app.asar'
const unpackedRoot = 'D:\\apps\\DeepSeek Harness\\DSH NEXT\\resources\\app.asar.unpacked'
const outRoot = path.join(__dirname, '..', 'tmp', 'host-root', 'node_modules')
const fd = fs.openSync(asarPath, 'r')
const sizeBuf = Buffer.alloc(8)
fs.readSync(fd, sizeBuf, 0, 8, 0)
const headerPickleBytes = sizeBuf.readUInt32LE(4)
const headerBuf = Buffer.alloc(headerPickleBytes)
fs.readSync(fd, headerBuf, 0, headerPickleBytes, 8)
const jsonLen = headerBuf.readUInt32LE(4)
const header = JSON.parse(headerBuf.slice(8, 8 + jsonLen).toString('utf8'))
const base = 8 + headerPickleBytes

const KEEP = /\.(js|mjs|cjs|json|ts)$/
const files = []
function walk(node, prefix) {
  if (!node || !node.files) return
  for (const [name, child] of Object.entries(node.files)) {
    const p = prefix + '/' + name
    if (child.files) walk(child, p)
    else files.push({ p, offset: Number(child.offset), size: Number(child.size), unpacked: !!child.unpacked })
  }
}
walk(header, '')

let count = 0
for (const f of files) {
  const m = f.p.match(/^\/node_modules\/@deepseek-ai\/(.+)$/)
  if (!m || !KEEP.test(f.p)) continue
  const rel = m[1]
  const dest = path.join(outRoot, '@deepseek-ai', rel)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  if (f.unpacked) {
    const src = path.join(unpackedRoot, 'node_modules', '@deepseek-ai', rel)
    if (fs.existsSync(src)) fs.copyFileSync(src, dest)
    else continue
  } else {
    if (f.size <= 0) { fs.writeFileSync(dest, ''); continue }
    const b = Buffer.alloc(f.size)
    fs.readSync(fd, b, 0, f.size, base + f.offset)
    fs.writeFileSync(dest, b)
  }
  count++
}
fs.closeSync(fd)
console.log('extracted', count, 'files into', outRoot)
const sessionDir = path.join(outRoot, '@deepseek-ai', 'dsh-session')
console.log('dsh-session dir exists:', fs.existsSync(sessionDir))
if (fs.existsSync(sessionDir)) console.log('dsh-session files:', fs.readdirSync(path.join(sessionDir, 'lib')).slice(0, 12).join(', '))
