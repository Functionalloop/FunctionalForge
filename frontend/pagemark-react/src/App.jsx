import { useEffect, useState } from 'react'
import Tool from './Tool.jsx'

const GITHUB = '#' // TODO: put your repo link here

const FEATURES = [
  ['Works offline', 'Add your pages once. Ask questions with no internet.'],
  ['Any language', 'Read photos in Hindi, Marathi, Tamil and more.'],
  ['Only your pages', 'No outside answers. If it is not there, we say so.'],
  ['Open source', 'Free to use, fix and translate. Join us on GitHub.'],
]

// A textbook page dissolving into pixels, like the template's card.
function PixelPage() {
  const cells = []
  for (let y = 0; y < 12; y++)
    for (let x = 0; x < 12; x++) {
      const h = (x * 37 + y * 57 + x * y * 11) % 100
      if (h < (x + y) * 5) cells.push(<i key={x + '-' + y} className={'px p' + (h % 3)} style={{ gridColumn: x + 1, gridRow: y + 1 }} />)
    }
  return (
    <div className="visual" aria-hidden="true">
      <div className="sheet">
        <b className="ln w1" /><b className="ln w2" /><b className="ln w3 hl" /><b className="ln w2" /><b className="ln w1" />
      </div>
      <div className="pixels">{cells}</div>
    </div>
  )
}

export default function App() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false)
    addEventListener('online', on); addEventListener('offline', off)
    return () => { removeEventListener('online', on); removeEventListener('offline', off) }
  }, [])

  return (
    <div className="shell">
      <header className="nav">
        <a className="logo" href="#top"><span className="mark"><i /><i /></span>Pagemark</a>
        <nav aria-label="Main"><a href="#top">Home</a><a href="#tool">Try it</a><a href="#why">Why</a></nav>
        <span className={'net' + (online ? '' : ' off')}>{online ? 'Online' : 'Offline, still works'}</span>
        <a className="outline" href={GITHUB}>GitHub</a>
      </header>

      <section className="hero" id="top">
        <div>
          <h1>Study from your own pages, with or without internet</h1>
          <p>Add photos of your textbook or a PDF. Ask a question. Pagemark shows the exact spot in your pages that answers it, or tells you it is not there.</p>
          <a className="lime" href="#tool">Try it now <span aria-hidden="true">↗</span></a>
        </div>
        <PixelPage />
      </section>

      <section className="panel" id="tool">
        <div className="head">
          <h2>Ask your pages</h2>
          <p>Everything runs in your browser. Your material stays on your device.</p>
        </div>
        <Tool />
      </section>

      <section className="panel feats" id="why">
        {FEATURES.map(([t, d], i) => (
          <div key={t} className="feat"><i className={'ico i' + i} aria-hidden="true" /><h3>{t}</h3><p>{d}</p></div>
        ))}
      </section>

      <footer className="foot">
        <h2>Help us build it</h2>
        <p>Add a language, fix a bug, or improve the search. Every contribution helps a student somewhere.</p>
        <a className="lime" href={GITHUB}>Contribute on GitHub <span aria-hidden="true">↗</span></a>
        <small>Pagemark is open source. Built for a hackathon.</small>
      </footer>
    </div>
  )
}
