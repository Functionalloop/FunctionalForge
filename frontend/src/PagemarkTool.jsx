import { useEffect, useMemo, useRef, useState } from 'react'
import { buildIndex, search } from './lib/search.js'
import { saveDoc, deleteDoc, loadDocs } from './lib/storage.js'
import { readPdf, readImage, splitText } from './lib/readers.js'

const LANGS = [['eng', 'English'], ['hin', 'Hindi'], ['mar', 'Marathi'], ['tam', 'Tamil'], ['tel', 'Telugu'], ['ben', 'Bengali'], ['spa', 'Spanish'], ['fra', 'French']]
const SAMPLE = [
  'Photosynthesis is the process by which green plants make food. It takes place in the chloroplasts, which contain chlorophyll. Chlorophyll absorbs sunlight and gives leaves their green colour.\n\nDuring photosynthesis, plants take in carbon dioxide from the air and water from the soil. Using light energy, they turn these into glucose and release oxygen.',
  'Respiration is the process that releases energy from food. It happens in the mitochondria of every living cell. Unlike photosynthesis, respiration uses oxygen and releases carbon dioxide.\n\nThe stomata are tiny pores on the underside of leaves. They open and close to let gases in and out.',
]

export default function Tool() {
  const [docs, setDocs] = useState([])
  const [status, setStatus] = useState('')
  const [lang, setLang] = useState('eng')
  const [q, setQ] = useState('')
  const [result, setResult] = useState(null) // { kind, ... }
  const [drag, setDrag] = useState(false)
  const fileRef = useRef()
  const markRef = useRef()
  const index = useMemo(() => buildIndex(docs), [docs])

  useEffect(() => {
    loadDocs().then((r) => { if (r && r.length) { setDocs(r); setStatus('Loaded your saved material.') } })
  }, [])
  useEffect(() => { markRef.current?.scrollIntoView({ block: 'center' }) }, [result])

  async function addDoc(name, pages) {
    pages = pages.filter(Boolean)
    if (!pages.length) return setStatus(`No text found in ${name}. Try a clearer photo.`)
    const d = { name, pages }
    await saveDoc(d)
    setDocs((cur) => [...cur.filter((x) => x.name !== name), d])
    setStatus(`Added ${name}. Ready for questions.`)
  }

  async function addFiles(files) {
    for (const f of files) {
      try {
        let pages
        if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) pages = await readPdf(f, setStatus)
        else if (f.type.startsWith('image/')) pages = await readImage(f, lang, setStatus)
        else pages = splitText(await f.text())
        await addDoc(f.name, pages)
      } catch (e) {
        setStatus(`Could not read ${f.name}. ${e.message}`)
      }
    }
  }

  async function remove(name) {
    await deleteDoc(name)
    setDocs((cur) => cur.filter((d) => d.name !== name))
    setResult(null)
  }

  function ask(e) {
    e.preventDefault()
    if (!q.trim()) return
    if (!docs.length) return setResult({ kind: 'empty' })
    const b = search(index, q)
    if (!b) return setResult({ kind: 'short' })
    if (b.coverage < 0.5) return setResult({ kind: 'none' }) // tune this threshold
    const c = b.chunk
    setResult({ kind: b.coverage >= 0.85 ? 'strong' : 'weak', doc: docs[c.di].name, page: c.pi, text: docs[c.di].pages[c.pi], a: c.a, b: c.b })
  }

  return (
    <div className="tool">
      <div className="col">
        <h3>1. Add your pages</h3>
        <div
          className={'drop' + (drag ? ' on' : '')}
          tabIndex={0}
          role="button"
          onClick={() => fileRef.current.click()}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), fileRef.current.click())}
          onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles([...e.dataTransfer.files]) }}
        >
          Choose a PDF, photo or .txt file, or drop it here
        </div>
        <input ref={fileRef} type="file" accept=".pdf,.txt,image/*" multiple hidden onChange={(e) => { addFiles([...e.target.files]); e.target.value = '' }} />
        <div className="row">
          <label htmlFor="lang" className="small">Language in photos</label>
          <select id="lang" value={lang} onChange={(e) => setLang(e.target.value)}>
            {LANGS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
          </select>
          <button type="button" className="ghost" onClick={() => addDoc('Sample: Biology ch.3', SAMPLE)}>Try a sample</button>
        </div>
        <p className="small" role="status" aria-live="polite">{status}</p>
        <ul className="docs">
          {docs.map((d) => (
            <li key={d.name}><span>{d.name} <span className="small">({d.pages.length} p)</span></span><button type="button" className="ghost sm" onClick={() => remove(d.name)}>Remove</button></li>
          ))}
        </ul>
        {docs.length > 0 && <p className="small">Saved on this device. Works without internet.</p>}
      </div>

      <div className="col">
        <h3>2. Ask a question</h3>
        <form onSubmit={ask} className="row nomt">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="What is photosynthesis?" aria-label="Your question" autoComplete="off" />
          <button className="lime" type="submit">Find answer</button>
        </form>
        <div className="answer" aria-live="polite">
          {result?.kind === 'empty' && <p className="small">Add some material first.</p>}
          {result?.kind === 'short' && <p className="small">Type a question with a few key words.</p>}
          {result?.kind === 'none' && (<><span className="badge no">Not found in your material</span><p className="small">Nothing in your pages answers this. Try other words, or add the right chapter.</p></>)}
          {(result?.kind === 'strong' || result?.kind === 'weak') && (
            <>
              <span className={'badge ' + (result.kind === 'strong' ? 'ok' : 'weak')}>{result.kind === 'strong' ? 'Strong match' : 'Closest match, check it'}</span>
              <p className="small">{result.doc}, page {result.page + 1}</p>
              <div className="page">
                {result.text.slice(0, result.a)}
                <mark ref={markRef}>{result.text.slice(result.a, result.b)}</mark>
                {result.text.slice(result.b)}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
