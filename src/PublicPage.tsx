import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, CalendarDays, Check, Clock3, Copy, Heart, Leaf, MapPin, ShieldCheck, Users, X } from 'lucide-react'
import { brDate, displayStatus } from './data'
import type { EventInfo, Guest, Status, WeddingSettings } from './data'
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
  lookupGuest: (name: string, last4: string, keyword: string, signal: AbortSignal) => Promise<{ guest: Pick<Guest, 'id' | 'full_name' | 'status' | 'invited_to_celebration' | 'invited_to_ceremony' | 'celebration_status' | 'ceremony_status'>; token: string; event_info: EventInfo | null } | { ambiguous: true } | null>
  answerGuest: (token: string, guestId: string, responses: { celebration?: Status; ceremony?: Status }, message: string | null, keyword: string) => Promise<EventInfo | null>
}) {
  const [name, setName] = useState('')
  const [keyword, setKeyword] = useState('')
  const [last4, setLast4] = useState('')
  const [found, setFound] = useState<{ guest: Pick<Guest, 'id' | 'full_name' | 'status' | 'invited_to_celebration' | 'invited_to_ceremony' | 'celebration_status' | 'ceremony_status'>; token: string } | null>(null)
  const [eventInfo, setEventInfo] = useState<EventInfo | null>(null)
  const [ambiguous, setAmbiguous] = useState(false)
  const [message, setMessage] = useState('')
  const [messageEdited, setMessageEdited] = useState(false)
  const [selectedResponses, setSelectedResponses] = useState<{ celebration: 'confirmed' | 'declined' | null; ceremony: 'confirmed' | 'declined' | null }>({ celebration: null, ceremony: null })
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
    setNotice(''); setFound(null); setEventInfo(null); setSuccess(false); setBusy(true)
    try {
      const result = await lookupGuest(name, last4, keyword, controller.signal)
      if (controller.signal.aborted) return
      if (!result) { setNotice('Não encontramos seu convite. Confira o nome completo ou o nome alternativo cadastrado. Se precisar, fale com os noivos para conferir a grafia.'); return }
      if ('ambiguous' in result) { setAmbiguous(true); setNotice('Encontramos mais de uma pessoa com esse nome. Para proteger sua privacidade, informe os 4 últimos números do telefone cadastrado.'); return }
      setAmbiguous(false); setFound(result); setEventInfo(result.event_info); setSuccess(Boolean(result.event_info)); setMessage(''); setMessageEdited(false)
      setSelectedResponses({ celebration: result.guest.celebration_status === 'pending' ? null : result.guest.celebration_status, ceremony: result.guest.ceremony_status === 'pending' ? null : result.guest.ceremony_status })
    } catch (error) { if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : 'Não foi possível buscar agora. Tente novamente em instantes.') }
    finally { if (lookupAbort.current === controller) { lookupAbort.current = null; setBusy(false) } }
  }
  async function answer(event: FormEvent) {
    event.preventDefault()
    if (!found || busy || deadlinePassed) return
    const responses: { celebration?: Status; ceremony?: Status } = {}
    if (found.guest.invited_to_celebration) { if (!selectedResponses.celebration) return; responses.celebration = selectedResponses.celebration }
    if (found.guest.invited_to_ceremony) { if (!selectedResponses.ceremony) return; responses.ceremony = selectedResponses.ceremony }
    setBusy(true); setNotice('')
    try {
      const details = await answerGuest(found.token, found.guest.id, responses, messageEdited ? message.trim() : null, keyword)
      const celebrationStatus = responses.celebration ?? found.guest.celebration_status
      const ceremonyStatus = responses.ceremony ?? found.guest.ceremony_status
      const nextStatus: Status = (found.guest.invited_to_celebration && celebrationStatus === 'confirmed') || (found.guest.invited_to_ceremony && ceremonyStatus === 'confirmed') ? 'confirmed' : (found.guest.invited_to_celebration ? celebrationStatus === 'declined' : true) && (found.guest.invited_to_ceremony ? ceremonyStatus === 'declined' : true) ? 'declined' : 'pending'
      setFound({ ...found, guest: { ...found.guest, status: nextStatus, celebration_status: celebrationStatus, ceremony_status: ceremonyStatus } }); setEventInfo(details); setSuccess(true); setMessageEdited(false)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Não foi possível registrar sua resposta.') }
    finally { setBusy(false) }
  }
  const visibleSchedule = eventInfo?.schedule ?? []
  const visibleVenues = eventInfo?.venues ?? []
  const visibleAnnouncements = eventInfo?.announcements ?? []
  const confirmedCelebration = Boolean(eventInfo?.confirmed_events.includes('celebration'))
  const confirmedCeremony = Boolean(eventInfo?.confirmed_events.includes('ceremony'))
  const singleConfirmedEvent = confirmedCelebration !== confirmedCeremony
  const confirmedEventLabel = confirmedCeremony ? 'cerimônia' : 'celebração'

  return <div className="public-site">
    <header className="public-nav">
      <a className="nav-brand" href="#inicio"><BrandMark small /><span>{settings.couple_names}</span></a>
      <nav aria-label="Navegação principal"><a href="#confirmacao">Confirmação</a>{eventInfo && <><a href="#programacao">O dia</a><a href="#local">Local</a></>}</nav>
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
            <span>{eventInfo?.wedding_date ? `${brDate(eventInfo.wedding_date)}${eventInfo.wedding_time ? ` · ${eventInfo.wedding_time}` : ''}` : 'As informações do evento serão liberadas após a confirmação'}</span>
          </div>
          <a className="button button--primary hero-cta reveal delay-3" href="#confirmacao">Confirmar presença <ArrowDown size={16} /></a>
          <span className="hero-caption">Com muito carinho, esperamos você</span>{eventInfo?.wedding_date && <Countdown date={eventInfo.wedding_date} time={eventInfo.wedding_time} />}{visibleVenues[0] && <span className="hero-venue"><MapPin size={14} />{visibleVenues[0].name}</span>}
        </div>
        <div className="hero-bottom"><span>01</span><span className="hero-bottom-line" /><span>UM NOVO CAPÍTULO</span></div>
        <div className="hero-side-note">FEITO COM AMOR <span>✳</span> {eventInfo?.wedding_date?.slice(0, 4) || new Date().getFullYear()}</div>
      </section>

      <section className="rsvp-section section-pad" id="confirmacao">
        <div className="section-heading"><span className="eyebrow">UM LUGAR À MESA</span><h2>Sua presença é o nosso<br /><em>maior presente.</em></h2><p>Conte para nós se poderá celebrar esse dia ao nosso lado.</p></div>
        <div className="rsvp-card">
          <div className="rsvp-card-index">{found ? '02' : '01'} <span>·</span> {found ? 'SUA RESPOSTA' : 'ENCONTRE SEU CONVITE'}</div>
          {deadlinePassed && !found && <div className="deadline-note"><Clock3 size={17} /><span>O prazo de confirmação encerrou. Você ainda pode consultar a resposta registrada.</span></div>}
          {(success || eventInfo) && found ? <div className="success-state" aria-live="polite">
            <span className="success-seal"><Check size={26} /></span><span className="eyebrow">{eventInfo ? 'ACESSO LIBERADO' : 'RESPOSTA REGISTRADA'}</span>
            <h3 ref={resultHeading} tabIndex={-1}>{eventInfo ? `Olá novamente, ${found.guest.full_name.split(' ')[0]}!` : `Obrigado, ${found.guest.full_name.split(' ')[0]}!`}</h3>
            <p>{eventInfo ? `Sua presença já está confirmada${singleConfirmedEvent ? ` na ${confirmedEventLabel}` : ' nos eventos do seu convite'}. Você pode voltar aqui quando quiser: basta informar seu nome e a palavra-chave do convite para consultar os detalhes, sem confirmar novamente.` : found.guest.status === 'confirmed' ? 'Sua presença está confirmada nos eventos indicados abaixo. Vamos adorar celebrar com você!' : 'Recebemos seu carinho. Obrigado por nos avisar — você estará em nossos pensamentos.'}</p>
            <div className="response-receipt"><strong>{found.guest.full_name}</strong><span>{found.guest.invited_to_celebration && `Celebração: ${displayStatus[found.guest.celebration_status]}`}{found.guest.invited_to_celebration && found.guest.invited_to_ceremony ? ' · ' : ''}{found.guest.invited_to_ceremony && `Cerimônia: ${displayStatus[found.guest.ceremony_status]}`}</span></div>
            <div className="success-petals" aria-hidden="true">{Array.from({ length: 10 }, (_, i) => <i key={i} style={{ '--petal-index': i } as React.CSSProperties}>✦</i>)}</div>
            {!eventInfo && !deadlinePassed && <button className="text-button" onClick={() => { setSuccess(false); setNotice('') }}>Editar minha resposta</button>}
          </div> : found ? <div className="found-state">
            <span className="eyebrow">CONVITE ENCONTRADO</span><h3 ref={resultHeading} tabIndex={-1}>Olá, {found.guest.full_name.split(' ')[0]}!</h3>
            <p className="guest-identity">Convite de <strong>{found.guest.full_name}</strong></p>
            {(found.guest.celebration_status !== 'pending' || found.guest.ceremony_status !== 'pending') && <p className="existing-answer">{found.guest.invited_to_celebration && <>Celebração: <strong>{displayStatus[found.guest.celebration_status]}</strong>. </>}{found.guest.invited_to_ceremony && <>Cerimônia: <strong>{displayStatus[found.guest.ceremony_status]}</strong>. </>}{!deadlinePassed && <>Você pode alterar suas respostas até {brDate(settings.rsvp_deadline)}.</>}</p>}
            {!deadlinePassed ? <form className="response-form" onSubmit={answer} aria-busy={busy}>
              {found.guest.invited_to_celebration && <fieldset className="answer-options" disabled={busy}><legend>Você poderá participar da celebração?</legend><div className="answer-buttons"><label className={'answer-choice ' + (selectedResponses.celebration === 'confirmed' ? 'is-selected' : '')}><input type="radio" name="celebration-attendance" required checked={selectedResponses.celebration === 'confirmed'} onChange={() => setSelectedResponses(v => ({ ...v, celebration: 'confirmed' }))} /><Heart size={18} /><span>Sim, estarei presente</span></label><label className={'answer-choice ' + (selectedResponses.celebration === 'declined' ? 'is-selected' : '')}><input type="radio" name="celebration-attendance" required checked={selectedResponses.celebration === 'declined'} onChange={() => setSelectedResponses(v => ({ ...v, celebration: 'declined' }))} /><span>Não poderei comparecer</span></label></div></fieldset>}
              {found.guest.invited_to_ceremony && <fieldset className="answer-options" disabled={busy}><legend>Você poderá participar da cerimônia?</legend><div className="answer-buttons"><label className={'answer-choice ' + (selectedResponses.ceremony === 'confirmed' ? 'is-selected' : '')}><input type="radio" name="ceremony-attendance" required checked={selectedResponses.ceremony === 'confirmed'} onChange={() => setSelectedResponses(v => ({ ...v, ceremony: 'confirmed' }))} /><Heart size={18} /><span>Sim, estarei presente</span></label><label className={'answer-choice ' + (selectedResponses.ceremony === 'declined' ? 'is-selected' : '')}><input type="radio" name="ceremony-attendance" required checked={selectedResponses.ceremony === 'declined'} onChange={() => setSelectedResponses(v => ({ ...v, ceremony: 'declined' }))} /><span>Não poderei comparecer</span></label></div></fieldset>}
              <label className="field-label" htmlFor="guest-message">Um recado para os noivos <span>opcional</span></label>
              <textarea id="guest-message" disabled={busy} maxLength={500} value={message} onChange={e => { setMessage(e.target.value); setMessageEdited(true) }} placeholder="Uma mensagem carinhosa, um desejo, uma lembrança…" aria-describedby="message-privacy message-count" />
              <div id="message-count" className={'char-count ' + (message.length >= 450 ? 'near-limit' : '')}>{message.length} / 500</div>
              {(found.guest.celebration_status !== 'pending' || found.guest.ceremony_status !== 'pending') && <p className="message-preservation">Seu recado anterior será mantido. Escreva acima se quiser substituí-lo.</p>}
              <p className="privacy-note" id="message-privacy"><ShieldCheck size={16} /> Seu recado será visto apenas pelos noivos.</p>
              {notice && <p className="form-notice" role="alert">{notice}</p>}
              <button className="button button--primary response-submit" disabled={busy || (found.guest.invited_to_celebration && !selectedResponses.celebration) || (found.guest.invited_to_ceremony && !selectedResponses.ceremony)}>{busy ? 'Salvando…' : 'Enviar minha resposta'}{busy ? <span className="leaf-loader"><Leaf size={17} /></span> : <ArrowRight size={17} />}</button>
              <p className="response-help">Sua resposta será registrada ao enviar.</p>
            </form> : <div className="deadline-note"><Clock3 size={17} /><span>O prazo para confirmar presença já encerrou. Obrigado pelo carinho!</span></div>}
            <button className="text-button back-to-lookup" disabled={busy} onClick={() => { setFound(null); setEventInfo(null); setSuccess(false); setNotice(''); setAmbiguous(false); setLast4(''); setSelectedResponses({ celebration: null, ceremony: null }) }}><ArrowLeft size={14} /> Buscar outro nome</button>
          </div> : <form onSubmit={lookup} className="lookup-form" aria-busy={busy}>
            <label className="field-label" htmlFor="guest-name">Seu nome completo</label>
            <div className="input-wrap"><Users size={18} /><input autoComplete="name" autoCapitalize="words" autoCorrect="off" enterKeyHint="next" id="guest-name" aria-describedby="guest-name-help" disabled={busy} value={name} onChange={e => { setName(e.target.value); setAmbiguous(false); setLast4(''); setNotice('') }} placeholder="Nome como foi cadastrado pelos noivos" required minLength={3} maxLength={160} /></div>
            <p className="lookup-help" id="guest-name-help">Use o nome completo ou o nome alternativo cadastrado.</p>
            <label className="field-label" htmlFor="invite-keyword">Senha / palavra-chave do convite</label>
            <div className="input-wrap"><ShieldCheck size={18} /><input id="invite-keyword" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="search" aria-describedby="invite-keyword-help" disabled={busy} value={keyword} onChange={e => { setKeyword(e.target.value); setFound(null); setSuccess(false); setAmbiguous(false); setLast4(''); setNotice('') }} placeholder="Digite a palavra-chave recebida" required maxLength={100} /></div>
            <p className="lookup-help" id="invite-keyword-help">Use a senha ou palavra-chave que recebeu no convite. Se já confirmou presença, ela também permite consultar novamente as informações sem responder outra vez.</p>
            {ambiguous && <div className="disambiguation"><label className="field-label" htmlFor="last4">4 últimos números do telefone cadastrado</label><input id="last4" inputMode="numeric" autoComplete="off" autoFocus disabled={busy} required pattern="[0-9]{4}" minLength={4} maxLength={4} value={last4} onChange={e => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="••••" /></div>}
            {notice && <p className="form-notice" role="alert">{notice}</p>}
            <button className="button button--primary lookup-submit" disabled={busy}>{busy ? 'Buscando…' : 'Encontrar meu convite'}{busy ? <span className="leaf-loader"><Leaf size={17} /></span> : <ArrowRight size={17} />}</button>
            <p className="privacy-note lookup-privacy"><ShieldCheck size={16} /> Sua resposta e seu recado ficam só entre você e os noivos.</p>
          </form>}
        </div>
        <div className="rsvp-footnote"><span className="ornament">✳</span><p>Se tiver qualquer dúvida, fale com os noivos.<br />Será uma alegria ajudar.</p></div>
      </section>

      {eventInfo && <section className="day-section section-pad" id="programacao">
        <div className="section-kicker"><span className="eyebrow">{singleConfirmedEvent ? `PROGRAMAÇÃO DA ${confirmedEventLabel.toUpperCase()}` : 'UM DIA PARA GUARDAR'}</span><span className="section-number">02 / 04</span></div>
        <div className="section-heading section-heading--left"><h2>{singleConfirmedEvent ? <>Cada instante da<br /><em>{confirmedEventLabel}.</em></> : <>Cada instante,<br /><em>uma memória.</em></>}</h2><p>{singleConfirmedEvent ? `Os detalhes da ${confirmedEventLabel} estão reunidos abaixo.` : 'Estamos preparando tudo para celebrar ao seu lado.'}</p></div>
        <div className="timeline">
          {visibleSchedule.length ? visibleSchedule.map((item, i) => <article className="timeline-item" key={item.id ?? i}><span className="timeline-time">{item.time || '—'}</span><span className="timeline-dot"><span>✳</span></span><div><h3>{item.title}</h3><p>{item.description}</p></div><span className="timeline-icon">{item.icon === 'glass' ? '◌' : item.icon === 'music' ? '♫' : '♡'}</span></article>) : <div className="empty-public"><span>✳</span><p>Em breve, mais informações por aqui.</p></div>}
        </div>
      </section>}

      {eventInfo && <section className="venue-section section-pad" id="local">
        <div className="section-kicker"><span className="eyebrow">{singleConfirmedEvent ? `LOCAL DA ${confirmedEventLabel.toUpperCase()}` : 'ONDE VAMOS NOS ENCONTRAR'}</span><span className="section-number">03 / 04</span></div>
        <div className="venue-layout">
          <div className="section-heading section-heading--left"><h2>{singleConfirmedEvent ? <>O lugar da<br /><em>{confirmedEventLabel}.</em></> : <>Um lugar<br />especial para <em>nós.</em></>}</h2><p>{singleConfirmedEvent ? `Aqui estão o endereço e as orientações da ${confirmedEventLabel}.` : 'Escolhemos cada detalhe pensando em dividir esse momento com você.'}</p></div>
          <div className="venue-cards">{visibleVenues.length ? visibleVenues.map((venue, i) => <article className="venue-card" key={`${venue.name}-${i}`}>
            {venue.photo_url && <div className="venue-photo-public"><img src={venue.photo_url} alt={`Foto de ${venue.name}`} loading="lazy" /></div>}<div className="venue-map">{venue.address ? <iframe title={`Mapa de ${venue.name}`} loading="lazy" referrerPolicy="no-referrer" src={`https://maps.google.com/maps?q=${encodeURIComponent(venue.address)}&output=embed`} style={{ width: '100%', height: '100%', minHeight: 220, border: 0 }} /> : <span className="map-caption">Endereço em breve</span>}</div>
            <div className="venue-details"><span className="eyebrow">{venue.type || 'NOSSO LUGAR'}</span><h3>{venue.name}</h3><p>{venue.address}</p>{venue.notes && <p className="venue-notes">{venue.notes}</p>}
              <div className="venue-actions">{venue.address && <><a className="button button--primary" target="_blank" rel="noreferrer" href={/^https:\/\//i.test(venue.map_url) ? venue.map_url : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue.address)}`}>Abrir mapa <ArrowUpRight size={14} /></a><a className="text-button" target="_blank" rel="noreferrer" href={`https://waze.com/ul?q=${encodeURIComponent(venue.address)}`}>Waze <ArrowUpRight size={13} /></a></>}
                <button className="text-button" onClick={async () => { try { await navigator.clipboard.writeText(venue.address); setAddressNotice('Endereço copiado!'); setTimeout(() => setAddressNotice(''), 2200) } catch { setAddressNotice('Copie o endereço: ' + venue.address) } }}><Copy size={14} /> Copiar endereço</button>
              </div>
            </div>
          </article>) : <div className="empty-public"><span>✳</span><p>Em breve, mais informações por aqui.</p></div>}</div>
        </div>
      </section>}

      {eventInfo && <section className="notes-section section-pad" id="recados-publicos">
        <div className="section-kicker"><span className="eyebrow">UM RECADO COM CARINHO</span><span className="section-number">04 / 04</span></div>
        <div className="notes-heading"><BrandMark small /><h2>Pequenos avisos,<br /><em>grandes cuidados.</em></h2></div>
        <div className="announcement-grid">{visibleAnnouncements.length ? visibleAnnouncements.map((item, i) => <article className={`announcement-card ${item.pinned ? 'is-pinned' : ''}`} key={item.id ?? i}><span className="announcement-flower">✳</span>{item.pinned && <span className="pinned-label">PARA VOCÊ</span>}<h3>{item.title}</h3><p>{item.body}</p></article>) : <div className="empty-public"><span>✳</span><p>Em breve, mais informações por aqui.</p></div>}</div>
      </section>}
      <section className="final-call"><OliveBranch className="final-branch" /><span className="eyebrow">ESTAMOS CONTANDO OS DIAS</span><h2>Vai ser ainda mais bonito<br />com <em>você por perto.</em></h2><button className="button button--light" onClick={() => document.querySelector('#confirmacao')?.scrollIntoView({ behavior: 'smooth' })}>Confirmar presença <ArrowRight size={15} /></button></section>
    </main>
    <footer className="public-footer"><BrandMark small /><p>Com amor, <span>{settings.couple_names}</span></p><span className="footer-copyright">{settings.wedding_date?.slice(0, 4) || new Date().getFullYear()} · FEITO COM CARINHO</span></footer>
    {!found && <a href="#confirmacao" className="mobile-rsvp">Confirmar presença <ArrowRight size={16} /></a>}
    {addressNotice && <div className="toast toast--public" role="status">{addressNotice}<button onClick={() => setAddressNotice('')}><X size={15} /></button></div>}
  </div>
}
