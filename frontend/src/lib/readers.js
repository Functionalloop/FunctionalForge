// Turns PDFs, photos and text files into an array of "pages" (strings).
export function splitText(t) {
  const out = []
  let cur = ''
  for (const p of t.split(/\n\s*\n/)) {
    if ((cur + p).length > 1500 && cur) { out.push(cur.trim()); cur = '' }
    cur += p + '\n\n'
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

export async function readPdf(file, onStatus) {
  const pdfjs = await import('pdfjs-dist/build/pdf.mjs')
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = worker
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  const pages = []
  for (let i = 1; i <= pdf.numPages; i++) {
    onStatus(`Reading ${file.name}: page ${i} of ${pdf.numPages}`)
    const t = await (await pdf.getPage(i)).getTextContent()
    pages.push(t.items.map((x) => x.str).join(' ').replace(/\s+/g, ' ').trim())
  }
  if (!pages.some((p) => p.length > 20))
    throw new Error('This PDF has no selectable text. Add its pages as photos instead.')
  return pages
}

export async function readImage(file, lang, onStatus) {
  const Tesseract = (await import('tesseract.js')).default
  const r = await Tesseract.recognize(file, lang, {
    logger: (m) => m.status && onStatus(`Reading ${file.name}: ${m.status} ${Math.round((m.progress || 0) * 100)}%`),
  })
  return [r.data.text.trim()]
}
