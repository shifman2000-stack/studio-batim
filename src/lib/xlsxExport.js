// src/lib/xlsxExport.js
//
// Minimal, dependency-free .xlsx (OOXML) writer for "export this table"
// buttons. This app has no existing spreadsheet-export utility (the only
// precedent, HoursReport.jsx, exports to PDF via window.print) and the
// one npm package that writes real .xlsx client-side ("xlsx" / SheetJS)
// currently ships only unpatched versions on the npm registry with
// known HIGH-severity advisories (prototype pollution GHSA-4r6h-8v6p-xvw6,
// ReDoS GHSA-5pgg-2g8v-p4x9) and no fixed version available via npm.
// Since export only ever WRITES data already trusted from this app (never
// parses an uploaded file), a small hand-rolled writer avoids pulling in
// that risk for a few dozen lines of well-understood, static logic.
//
// Every cell is written as an inline string (t="inlineStr") so the
// exported file shows exactly the same text already on screen — no
// numeric/date reformatting or locale surprises.

function crc32(bytes) {
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
      t[n] = c >>> 0
    }
    return t
  })())
  let crc = 0xFFFFFFFF
  for (let i = 0; i < bytes.length; i++) {
    crc = table[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8)
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function xmlEscape(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  }[ch]))
}

/* 1-based column index → Excel column letter (A, B, ..., Z, AA, ...). */
function colLetter(n) {
  let s = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    s = String.fromCharCode(65 + rem) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

function buildSheetXml(rows) {
  const rowsXml = rows.map((cells, ri) => {
    const cellsXml = cells.map((val, ci) => {
      const ref = `${colLetter(ci + 1)}${ri + 1}`
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(val)}</t></is></c>`
    }).join('')
    return `<row r="${ri + 1}">${cellsXml}</row>`
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<sheetViews><sheetView rightToLeft="1" workbookViewId="0"/></sheetViews>`
    + `<sheetData>${rowsXml}</sheetData>`
    + `</worksheet>`
}

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
  + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
  + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
  + `<Default Extension="xml" ContentType="application/xml"/>`
  + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
  + `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  + `</Types>`

const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
  + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
  + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>`
  + `</Relationships>`

function workbookXml(sheetName) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
    + `<sheets><sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/></sheets>`
    + `</workbook>`
}

const WORKBOOK_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
  + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
  + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>`
  + `</Relationships>`

/* Builds the raw bytes of a valid, minimal .xlsx — a ZIP archive with
   STORED (uncompressed) entries, so no compression/library is needed. */
function buildZip(files) {
  const enc = new TextEncoder()
  const parts = []
  const centralParts = []
  let offset = 0

  for (const { name, content } of files) {
    const nameBytes = enc.encode(name)
    const dataBytes = enc.encode(content)
    const crc = crc32(dataBytes)
    const size = dataBytes.length

    const local = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)      // version needed
    lv.setUint16(6, 0, true)       // flags
    lv.setUint16(8, 0, true)       // method: stored
    lv.setUint16(10, 0, true)      // mod time
    lv.setUint16(12, 0x21, true)   // mod date (1980-01-01)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, size, true)   // compressed size
    lv.setUint32(22, size, true)   // uncompressed size
    lv.setUint16(26, nameBytes.length, true)
    lv.setUint16(28, 0, true)      // extra length
    local.set(nameBytes, 30)

    parts.push(local, dataBytes)

    const central = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)      // version made by
    cv.setUint16(6, 20, true)      // version needed
    cv.setUint16(8, 0, true)       // flags
    cv.setUint16(10, 0, true)      // method
    cv.setUint16(12, 0, true)      // mod time
    cv.setUint16(14, 0x21, true)   // mod date
    cv.setUint32(16, crc, true)
    cv.setUint32(20, size, true)
    cv.setUint32(24, size, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint16(30, 0, true)      // extra length
    cv.setUint16(32, 0, true)      // comment length
    cv.setUint16(34, 0, true)      // disk number start
    cv.setUint16(36, 0, true)      // internal attrs
    cv.setUint32(38, 0, true)      // external attrs
    cv.setUint32(42, offset, true) // offset of local header
    central.set(nameBytes, 46)

    centralParts.push(central)
    offset += local.length + dataBytes.length
  }

  const centralSize = centralParts.reduce((s, p) => s + p.length, 0)
  const centralOffset = offset

  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(4, 0, true)
  ev.setUint16(6, 0, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, centralOffset, true)
  ev.setUint16(20, 0, true)

  return new Blob([...parts, ...centralParts, end], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

/**
 * Export a simple table to a downloaded .xlsx file (single sheet).
 * @param {string} filename — without extension, e.g. "דוח-שעות-לפי-פרויקט"
 * @param {string} sheetName — Excel sheet tab name
 * @param {Array<Array<string>>} rows — every row (header + data rows),
 *   each a flat array of cell text. Cells are written as text exactly as
 *   given — no reformatting — so callers should pass already-formatted
 *   display strings.
 */
export function exportRowsToXlsx(filename, sheetName, rows) {
  const blob = buildZip([
    { name: '[Content_Types].xml',        content: CONTENT_TYPES_XML },
    { name: '_rels/.rels',                content: ROOT_RELS_XML },
    { name: 'xl/workbook.xml',            content: workbookXml(sheetName) },
    { name: 'xl/_rels/workbook.xml.rels', content: WORKBOOK_RELS_XML },
    { name: 'xl/worksheets/sheet1.xml',   content: buildSheetXml(rows) },
  ])
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}.xlsx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
