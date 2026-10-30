// Keyword search (BM25). No generated answers, so it cannot make things up.
const HI = 'का की के है हैं में से को और पर यह वह ये वे क्या कौन कैसे क्यों कब कहाँ कहां एक भी नहीं था थी थे ने तो जो कि या हो होता होती होते लिए साथ द्वारा इस उस इन उन कर करता करती करते'
const STOP = new Set((HI + ' a an the is are was were be been of in on at to for from by with and or but not what which who whom how why when where does do did this that these those it its as into about than then so if can could should would will may might your you i me my we our their they them his her he she there here also').split(' '))
const stem = (w) => (/^[a-z]+$/.test(w) && w.length > 4 ? w.replace(/(ing|ed|es|s)$/, '') : w)
const tok = (t) => (t.toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) || []).filter((w) => !STOP.has(w)).map(stem)

export function buildIndex(docs) {
  const chunks = []
  docs.forEach((d, di) =>
    d.pages.forEach((txt, pi) => {
      const s = [...txt.matchAll(/[^.!?\u0964\n]+[.!?\u0964]*/g)].filter((m) => m[0].trim().length > 2)
      for (let i = 0; i < s.length; i++) {
        const last = s[Math.min(i + 1, s.length - 1)]
        const a = s[i].index
        const b = last.index + last[0].length
        const toks = tok(txt.slice(a, b))
        const tf = {}
        toks.forEach((w) => (tf[w] = (tf[w] || 0) + 1))
        chunks.push({ di, pi, a, b, tf, len: toks.length || 1 })
      }
    })
  )
  const df = {}
  let total = 0
  chunks.forEach((c) => {
    total += c.len
    Object.keys(c.tf).forEach((w) => (df[w] = (df[w] || 0) + 1))
  })
  return { chunks, df, avg: total / (chunks.length || 1) }
}

// Returns null (no usable question) or { chunk, coverage }.
export function search(index, q) {
  const qt = [...new Set(tok(q))]
  if (!qt.length || !index.chunks.length) return null
  const N = index.chunks.length
  let best = null
  for (const c of index.chunks) {
    let score = 0, hit = 0
    for (const w of qt) {
      const f = c.tf[w]
      if (!f) continue
      hit++
      const n = index.df[w]
      score += Math.log(1 + (N - n + 0.5) / (n + 0.5)) * f * 2.5 / (f + 1.5 * (0.25 + 0.75 * c.len / index.avg))
    }
    if (!best || score > best.score) best = { chunk: c, score, coverage: hit / qt.length }
  }
  return best
}
