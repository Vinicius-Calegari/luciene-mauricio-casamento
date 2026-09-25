import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, CalendarDays, Check, Clock3, Copy, Heart, Leaf, MapPin, ShieldCheck, Users, X } from 'lucide-react'
import { brDate, displayStatus } from './data'
import type { Guest, Status, WeddingSettings } from './data'
import { BrandMark, OliveBranch } from './sharedUi'

export function Countdown({ date, time = '23:59' }: { date: string; time?: string }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const interval = window.setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(interval) }, [])
  if (!date) return null
  const seconds = Math.max(0, Math.floor((new Date(`${date}T${time || '23:59'}:00-03:00`).getTime() - now) / 1000))
  if (!Number.isFinite(seconds)) return null
  return <div className="live-countdown" aria-label="Contagem regressiva"><span><strong>{Math.floor(seconds / 86400)}</strong><small>dias</small></span><span><strong>{String(Math.floor(seconds / 3600) % 24).padStart(2, '0')}</strong><small>horas</small></span><span><strong>{String(Math.floor(seconds / 60) % 60).padStart(2, '0')}</strong><small>minutos</small></span><span><strong>{String(seconds % 60).padStart(2, '0')}</strong><small>segundos</small></span></div>
}

export default function PublicPage({ settings, onEnterAdmin, lookupGuest, answerGuest }: {
  settings: WeddingSettings; onEnterAdmin: () => void
  lookupGuest: (name: string, last4: string, keyword: string, signal: AbortSignal) => Promise<{ guest: Guest | { id: string; full_name: string; status: Status }; token: string } | { ambiguous: true } | null>
  answerGuest: (token: string, guestId: string, status: Status, message: string | null, keyword: string) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [keyword, setKeyword] = useState('')
  const [last4, setLast4] = useState('')
  const [found, setFound] = useState<{ guest: Guest | { id: string; full_name: string; status: Status }; token: string } | null>(null)
  const [ambiguous, setAmbiguous] = useState(false)
  const [message, setMessage] = useState('')
  const [messageEdited, setMessageEdited] = useState(false)
  const [selectedStatus, setSelectedStatus] = useState<'confirmed' | 'declined' | null>(null)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [success, setSuccess] = useState(false)
  const [addressNotice, setAddressNotice] = useState('')
  const deadline = settings.rsvp_deadline ? new Date(`${settings.rsvp_deadline}T23:59:59-03:00`).getTime() : 0
  const [deadlinePassed, setDeadlinePassed] = useState(() => !deadline || deadline < Date.now())
  const lookupAbort = useRef<AbortController | null>(null)
  const resultHeading = useRef<HTMLHeadingElement | null>(null)
  useEffect(() => () => { lookupAbort.current?.abort() }, [])
  useEffect(() => { if (found) resultHeading.current?.focus({ preventScroll: true }) }, [found, success])
  useEffect(() => {
    const updateDeadline = () => setDeadlinePassed(!deadline || deadline < Date.now())
    updateDeadline()
    const interval = window.setInterval(updateDeadline, 1000)
    return () => clearInterval(interval)
  }, [deadline])

  async function lookup(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    if (!keyword.trim()) { setNotice('Digite a palavra-chave informada no convite.'); return }
    const controller = new AbortController()
    lookupAbort.current = controller
    setNotice(''); setFound(null); setSuccess(false); setBusy(true)
    try {
      const result = await lookupGuest(name, last4, keyword, controller.signal)
      if (controller.signal.aborted) return
      if (!result) { setNotice('Não encontramos seu convite. Confira o nome completo ou o nome alternativo cadastrado. Se precisar, fale com os noivos para conferir a grafia.'); return }
      if ('ambiguous' in result) { setAmbiguous(true); setNotice('Encontramos mais de uma pessoa com esse nome. Para proteger sua privacidade, informe os 4 últimos números do telefone cadastrado.'); return }
      setAmbiguous(false); setFound(result); setMessage(''); setMessageEdited(false)
      setSelectedStatus(result.guest.status === 'pending' ? null : result.guest.status)
    } catch (error) { if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : 'Não foi possível buscar agora. Tente novamente em instantes.') }
    finally { if (lookupAbort.current === controller) { lookupAbort.current = null; setBusy(false) } }
  }
  async function answer(event: FormEvent) {
    event.preventDefault()
    if (!found || busy || deadlinePassed || !selectedStatus) return
    setBusy(true); setNotice('')
    try {
      await answerGuest(found.token, found.guest.id, selectedStatus, messageEdited ? message.trim() : null, keyword)
      setFound({ ...found, guest: { ...found.guest, status: selectedStatus } }); setSuccess(true); setMessageEdited(false)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Não foi possível registrar sua resposta.') }
    finally { setBusy(false) }
  }
  const visibleSchedule = settings.show_schedule ? settings.schedule.filter(item => item.visible).sort((a, b) => a.time.localeCompare(b.time)) : []
  const visibleVenues = settings.show_venues ? settings.venues.filter(item => item.visible) : []
  const visibleAnnouncements = settings.show_announcements ? settings.announcements.filter(item => item.visible && (!item.expires_at || new Date(`${item.expires_at}T23:59:59-03:00`) >= new Date())).sort((a, b) => Number(b.pinned) - Number(a.pinned)) : []

  return <div className="public-site">
    <header className="public-nav">
      <a className="nav-brand" href="#inicio"><BrandMark small /><span>{settings.couple_names}</span></a>
      <nav aria-label="Navegação principal">
        <a href="#confirmacao">Confirmação</a><a href="#programacao">O dia</a><a href="#local">Local</a>
      </nav>
      <button className="nav-rsvp" onClick={() => document.querySelector('#confirmacao')?.scrollIntoView({ behavior: 'smooth' })}>Confirmar presença <ArrowRight size={15} /></button>
      <button className="admin-link" onClick={onEnterAdmin} aria-label="Acesso dos noivos"><ShieldCheck size={17} /></button>
    </header>

    <main>
      <section className="hero" id="inicio">
        <div className="hero-glow" /><OliveBranch className="hero-branch hero-branch--left" /><OliveBranch className="hero-branch hero-branch--right" />
        <div className="hero-content">
          <span className="eyebrow reveal">UM DIA, UMA PROMESSA, UMA VIDA INTEIRA</span>
          <BrandMark />
          <h1 className="couple-title reveal delay-1">{settings.couple_names}</h1>
          <p className="hero-subtitle reveal delay-2">Vamos nos casar!</p>
          <div className="verse reveal delay-3"><span className="verse-rule" /><p>“{settings.bible_verse_text}”</p><small>{settings.bible_verse_ref}</small><span className="verse-rule" /></div>
          <div className="hero-date reveal delay-3"><CalendarDays size={16} strokeWidth={1.5} />
            <span>{settings.wedding_date ? `${brDate(settings.wedding_date)}${settings.wedding_time ? ` · ${settings.wedding_time}` : ''}` : 'A data será compartilhada em breve'}</span>
          </div>
          <a className="button button--primary hero-cta reveal delay-3" href="#confirmacao">Confirmar presença <ArrowDown size={16} /></a>
          <span className="hero-caption">Com muito carinho, esperamos você</span><Countdown date={settings.wedding_date} time={settings.wedding_time} />{visibleVenues[0] && <span className="hero-venue"><MapPin size={14} />{visibleVenues[0].name}</span>}
        </div>
        <div className="hero-bottom"><span>01</span><span className="hero-bottom-line" /><span>UM NOVO CAPÍTULO</span></div>
        <div className="hero-side-note">FEITO COM AMOR <span>✳</span> {settings.wedding_date?.slice(0, 4) || new Date().getFullYear()}</div>
      </section>

      <section className="rsvp-section section-pad" id="confirmacao">
        <div className="section-heading"><span className="eyebrow">UM LUGAR À MESA</span><h2>Sua presença é o nosso<br /><em>maior presente.</em></h2><p>Conte para nós se poderá celebrar esse dia ao nosso lado.</p></div>
        <div className="rsvp-card">
          <div className="rsvp-card-index">{found ? '02' : '01'} <span>·</span> {found ? 'SUA RESPOSTA' : 'ENCONTRE SEU CONVITE'}</div>
          {deadlinePassed && !found && <div className="deadline-note"><Clock3 size={17} /><span>O prazo de confirmação encerrou. Você ainda pode consultar a resposta registrada.</span></div>}
          {success && found ? <div className="success-state" aria-live="polite">
            <span className="success-seal"><Check size={26} /></span><span className="eyebrow">RESPOSTA REGISTRADA</span>
            <h3 ref={resultHeading} tabIndex={-1}>Obrigado, {found.guest.full_name.split(' ')[0]}!</h3>
            <p>{found.guest.status === 'confirmed' ? 'Sua presença está confirmada! Vamos adorar celebrar juntos.' : 'Recebemos seu carinho. Obrigado por nos avisar — você estará em nossos pensamentos.'}</p>
            <div className="response-receipt"><strong>{found.guest.full_name}</strong><span>{found.guest.status === 'confirmed' ? 'Presença confirmada' : 'Não poderá comparecer'}</span></div>
            <div className="success-petals" aria-hidden="true">{Array.from({ length: 10 }, (_, i) => <i key={i} style={{ '--petal-index': i } as React.CSSProperties}>✦</i>)}</div>
            {!deadlinePassed && <button className="text-button" onClick={() => { setSuccess(false); setNotice('') }}>Editar minha resposta</button>}
          </div> : found ? <div className="found-state">
            <span className="eyebrow">CONVITE ENCONTRADO</span><h3 ref={resultHeading} tabIndex={-1}>Olá, {found.guest.full_name.split(' ')[0]}!</h3>
            <p className="guest-identity">Convite de <strong>{found.guest.full_name}</strong></p>
            {(found.guest.status === 'confirmed' || found.guest.status === 'declined') && <p className="existing-answer">Sua resposta está registrada: <strong>{displayStatus[found.guest.status]}</strong>. {!deadlinePassed && <>Você pode alterá-la até {brDate(settings.rsvp_deadline)}.</>}</p>}
            {!deadlinePassed ? <form className="response-form" onSubmit={answer} aria-busy={busy}>
              <fieldset className="answer-options" disabled={busy}>
                <legend>Você poderá celebrar com a gente?</legend>
                <div className="answer-buttons">
                  <label className={'answer-choice ' + (selectedStatus === 'confirmed' ? 'is-selected' : '')}><input type="radio" name="attendance" required value="confirmed" checked={selectedStatus === 'confirmed'} onChange={() => setSelectedStatus('confirmed')} /><Heart size={18} /><span>Sim, estarei presente</span></label>
                  <label className={'answer-choice ' + (selectedStatus === 'declined' ? 'is-selected' : '')}><input type="radio" name="attendance" required value="declined" checked={selectedStatus === 'declined'} onChange={() => setSelectedStatus('declined')} /><span>Não poderei comparecer</span></label>
                </div>
              </fieldset>
              <label className="field-label" htmlFor="guest-message">Um recado para os noivos <span>opcional</span></label>
              <textarea id="guest-message" disabled={busy} maxLength={500} value={message} onChange={e => { setMessage(e.target.value); setMessageEdited(true) }} placeholder="Uma mensagem carinhosa, um desejo, uma lembrança…" aria-describedby="message-privacy message-count" />
              <div id="message-count" className={'char-count ' + (message.length >= 450 ? 'near-limit' : '')}>{message.length} / 500</div>
              {found.guest.status !== 'pending' && <p className="message-preservation">Seu recado anterior será mantido. Escreva acima se quiser substituí-lo.</p>}
              <p className="privacy-note" id="message-privacy"><ShieldCheck size={16} /> Seu recado será visto apenas pelos noivos.</p>
              {notice && <p className="form-notice" role="alert">{notice}</p>}
              <button className="button button--primary response-submit" disabled={busy || !selectedStatus}>{busy ? 'Salvando…' : 'Enviar minha resposta'}{busy ? <span className="leaf-loader"><Leaf size={17} /></span> : <ArrowRight size={17} />}</button>
              <p className="response-help">Sua resposta será registrada ao enviar.</p>
            </form> : <div className="deadline-note"><Clock3 size={17} /><span>O prazo para confirmar presença já encerrou. Obrigado pelo carinho!</span></div>}
            <button className="text-button back-to-lookup" disabled={busy} onClick={() => { setFound(null); setSuccess(false); setNotice(''); setAmbiguous(false); setLast4(''); setSelectedStatus(null) }}><ArrowLeft size={14} /> Buscar outro nome</button>
          </div> : <form onSubmit={lookup} className="lookup-form" aria-busy={busy}>
            <label className="field-label" htmlFor="guest-name">Seu nome completo</label>
            <div className="input-wrap"><Users size={18} /><input autoComplete="name" autoCapitalize="words" autoCorrect="off" enterKeyHint="next" id="guest-name" aria-describedby="guest-name-help" disabled={busy} value={name} onChange={e => { setName(e.target.value); setAmbiguous(false); setLast4(''); setNotice('') }} placeholder="Nome como foi cadastrado pelos noivos" required minLength={3} maxLength={160} /></div>
            <p className="lookup-help" id="guest-name-help">Use o nome completo ou o nome alternativo cadastrado.</p>
            <label className="field-label" htmlFor="invite-keyword">Palavra-chave do convite</label>
            <div className="input-wrap"><ShieldCheck size={18} /><input id="invite-keyword" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="search" aria-describedby="invite-keyword-help" disabled={busy} value={keyword} onChange={e => { setKeyword(e.target.value); setFound(null); setSuccess(false); setAmbiguous(false); setLast4(''); setNotice('') }} placeholder="Digite a palavra-chave recebida" required maxLength={100} /></div>
            <p className="lookup-help" id="invite-keyword-help">Você encontra essa palavra no convite que recebeu.</p>
            {ambiguous && <div className="disambiguation"><label className="field-label" htmlFor="last4">4 últimos números do telefone cadastrado</label><input id="last4" inputMode="numeric" autoComplete="off" autoFocus disabled={busy} required pattern="[0-9]{4}" minLength={4} maxLength={4} value={last4} onChange={e => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="••••" /></div>}
            {notice && <p className="form-notice" role="alert">{notice}</p>}
            <button className="button button--primary lookup-submit" disabled={busy}>{busy ? 'Buscando…' : 'Encontrar meu convite'}{busy ? <span className="leaf-loader"><Leaf size={17} /></span> : <ArrowRight size={17} />}</button>
            <p className="privacy-note lookup-privacy"><ShieldCheck size={16} /> Sua resposta e seu recado ficam só entre você e os noivos.</p>
          </form>}
        </div>
        <div className="rsvp-footnote"><span className="ornament">✳</span><p>Se tiver qualquer dúvida, fale com os noivos.<br />Será uma alegria ajudar.</p></div>
      </section>

      <section className="day-section section-pad" id="programacao">
        <div className="section-kicker"><span className="eyebrow">UM DIA PARA GUARDAR</span><span className="section-number">02 / 04</span></div>
        <div className="section-heading section-heading--left"><h2>Cada instante,<br /><em>uma memória.</em></h2><p>Estamos preparando tudo para celebrar ao seu lado.</p></div>
        <div className="timeline">
          {visibleSchedule.length ? visibleSchedule.map((item, i) => <article className="timeline-item" key={item.id ?? i}><span className="timeline-time">{item.time || '—'}</span><span className="timeline-dot"><span>✳</span></span><div><h3>{item.title}</h3><p>{item.description}</p></div><span className="timeline-icon">{item.icon === 'glass' ? '◌' : item.icon === 'music' ? '♫' : '♡'}</span></article>) : <div className="empty-public"><span>✳</span><p>Em breve, mais informações por aqui.</p></div>}
        </div>
      </section>

      <section className="venue-section section-pad" id="local">
        <div className="section-kicker"><span className="eyebrow">ONDE VAMOS NOS ENCONTRAR</span><span className="section-number">03 / 04</span></div>
        <div className="venue-layout">
          <div className="section-heading section-heading--left"><h2>Um lugar<br />especial para <em>nós.</em></h2><p>Escolhemos cada detalhe pensando em dividir esse momento com você.</p></div>
          <div className="venue-cards">{visibleVenues.length ? visibleVenues.map((venue, i) => <article className="venue-card" key={`${venue.name}-${i}`}>
            <div className="venue-map">{venue.address ? <iframe title={`Mapa de ${venue.name}`} loading="lazy" referrerPolicy="no-referrer" src={`https://maps.google.com/maps?q=${encodeURIComponent(venue.address)}&output=embed`} style={{ width: '100%', height: '100%', minHeight: 220, border: 0 }} /> : <span className="map-caption">Endereço em breve</span>}</div>
            <div className="venue-details"><span className="eyebrow">{venue.type || 'NOSSO LUGAR'}</span><h3>{venue.name}</h3><p>{venue.address}</p>{venue.notes && <p className="venue-notes">{venue.notes}</p>}
              <div className="venue-actions">{venue.address && <><a className="button button--primary" target="_blank" rel="noreferrer" href={/^https:\/\//i.test(venue.map_url) ? venue.map_url : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue.address)}`}>Abrir mapa <ArrowUpRight size={14} /></a><a className="text-button" target="_blank" rel="noreferrer" href={`https://waze.com/ul?q=${encodeURIComponent(venue.address)}`}>Waze <ArrowUpRight size={13} /></a></>}
                <button className="text-button" onClick={async () => { try { await navigator.clipboard.writeText(venue.address); setAddressNotice('Endereço copiado!'); setTimeout(() => setAddressNotice(''), 2200) } catch { setAddressNotice('Copie o endereço: ' + venue.address) } }}><Copy size={14} /> Copiar endereço</button>
              </div>
            </div>
          </article>) : <div className="empty-public"><span>✳</span><p>Em breve, mais informações por aqui.</p></div>}</div>
        </div>
      </section>

      <section className="notes-section section-pad" id="recados-publicos">
        <div className="section-kicker"><span className="eyebrow">UM RECADO COM CARINHO</span><span className="section-number">04 / 04</span></div>
        <div className="notes-heading"><BrandMark small /><h2>Pequenos avisos,<br /><em>grandes cuidados.</em></h2></div>
        <div className="announcement-grid">{visibleAnnouncements.length ? visibleAnnouncements.map((item, i) => <article className={`announcement-card ${item.pinned ? 'is-pinned' : ''}`} key={item.id ?? i}><span className="announcement-flower">✳</span>{item.pinned && <span className="pinned-label">PARA VOCÊ</span>}<h3>{item.title}</h3><p>{item.body}</p></article>) : <div className="empty-public"><span>✳</span><p>Em breve, mais informações por aqui.</p></div>}</div>
      </section>
      <section className="final-call"><OliveBranch className="final-branch" /><span className="eyebrow">ESTAMOS CONTANDO OS DIAS</span><h2>Vai ser ainda mais bonito<br />com <em>você por perto.</em></h2><button className="button button--light" onClick={() => document.querySelector('#confirmacao')?.scrollIntoView({ behavior: 'smooth' })}>Confirmar presença <ArrowRight size={15} /></button></section>
    </main>
    <footer className="public-footer"><BrandMark small /><p>Com amor, <span>{settings.couple_names}</span></p><span className="footer-copyright">{settings.wedding_date?.slice(0, 4) || new Date().getFullYear()} · FEITO COM CARINHO</span></footer>
    {!found && <a href="#confirmacao" className="mobile-rsvp">Confirmar presença <ArrowRight size={16} /></a>}
    {addressNotice && <div className="toast toast--public" role="status">{addressNotice}<button onClick={() => setAddressNotice('')}><X size={15} /></button></div>}
  </div>
}
