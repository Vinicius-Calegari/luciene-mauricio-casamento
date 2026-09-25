import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, Bell, CalendarDays, Check, CheckCircle2,
  ChevronDown, ChevronRight, CircleHelp, Clock3, Copy, Download, FileDown, Heart, Leaf,
  LogOut, MapPin, Menu, MessageCircle, MoreHorizontal, Plus, Search, Settings2, ShieldCheck,
  Sparkles, Trash2, Users, X,
} from 'lucide-react'
import {
  DEFAULT_SETTINGS, brDate, displayStatus, makeId, normalizeName, emptyData, hydrateSettings, normalizePhone, formatPhone, supabase, timeAgo,
} from './data'
import type { Announcement, AuditEntry, DemoData, Guest, GuestMessage, Profile, ScheduleItem, Side, Status, Venue, WeddingSettings } from './data'
import { publicPost } from './publicApi'

const errorText = (error: unknown) => error instanceof Error ? error.message : error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Não foi possível concluir. Confira sua conexão e tente novamente.'
const auditLabel = (key: string) => ({ full_name: 'Nome completo', alt_name: 'Nome alternativo', status: 'Resposta', side: 'Lista', deleted_at: 'Exclusão', deleted_by: 'Quem excluiu', last_reminder_at: 'Última cobrança', reminder_count: 'Número de cobranças', confirmed_at: 'Data da resposta', message_read: 'Recado lido', message_favorite: 'Favorito', draft: 'Rascunho', published: 'Publicação' } as Record<string, string>)[key] ?? key
const auditValue = (value: unknown): string => value === null || value === undefined || value === '' ? 'Não informado' : typeof value === 'object' ? 'Conteúdo atualizado' : typeof value === 'boolean' ? value ? 'Sim' : 'Não' : displayStatus[value as Status] ?? String(value)
const publicUrl = () => new URL(import.meta.env.BASE_URL, location.origin).href
const navigate = (admin: boolean) => { history.pushState({}, '', `${import.meta.env.BASE_URL}${admin ? '?painel=1' : ''}`); window.dispatchEvent(new PopStateEvent('popstate')); window.scrollTo(0, 0) }
const isPanel = () => location.pathname.includes('/admin') || new URLSearchParams(location.search).get('painel') === '1'
const GUEST_COLUMNS = 'id,full_name,alt_name,side,phone,status,confirmed_at,notes,message,message_read,message_favorite,last_reminder_at,reminder_count,deleted_at,deleted_by,created_at'
async function readAllRows<T>(readPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const rows: T[] = []
  const pageSize = 500
  for (let from = 0; ; from += pageSize) {
    const result = await readPage(from, from + pageSize - 1)
    if (result.error) throw result.error
    const page = result.data ?? []
    rows.push(...page)
    if (page.length < pageSize) return rows
  }
}

function Countdown({ date, time = '23:59' }: { date: string; time?: string }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const interval = window.setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(interval) }, [])
  if (!date) return null
  const seconds = Math.max(0, Math.floor((new Date(`${date}T${time || '23:59'}:00-03:00`).getTime() - now) / 1000))
  if (!Number.isFinite(seconds)) return null
  return <div className="live-countdown" aria-label="Contagem regressiva"><span><strong>{Math.floor(seconds / 86400)}</strong><small>dias</small></span><span><strong>{String(Math.floor(seconds / 3600) % 24).padStart(2, '0')}</strong><small>horas</small></span><span><strong>{String(Math.floor(seconds / 60) % 60).padStart(2, '0')}</strong><small>minutos</small></span><span><strong>{String(seconds % 60).padStart(2, '0')}</strong><small>segundos</small></span></div>
}

const navItems = [
  { id: 'overview', label: 'Visão geral', icon: 'overview' },
  { id: 'guests', label: 'Convidados', icon: 'guests' },
  { id: 'pending', label: 'Pendentes', icon: 'pending' },
  { id: 'messages', label: 'Recados', icon: 'messages' },
  { id: 'info', label: 'Informações', icon: 'info' },
  { id: 'trash', label: 'Lixeira', icon: 'trash' },
  { id: 'history', label: 'Histórico', icon: 'history' },
  { id: 'settings', label: 'Configurações', icon: 'settings' },
]

function BrandMark({ small = false }: { small?: boolean }) {
  return <div className={`brand-mark ${small ? 'brand-mark--small' : ''}`} aria-label="Monograma Luciene e Mauricio">
    <span>L</span><i>&</i><span>M</span><Leaf size={small ? 14 : 18} strokeWidth={1.35} />
  </div>
}

function OliveBranch({ className = '' }: { className?: string }) {
  return <svg className={`olive-branch ${className}`} viewBox="0 0 260 390" fill="none" aria-hidden="true">
    <path d="M20 360C94 289 129 205 145 31" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M72 302C31 302 15 278 18 259C50 258 72 271 72 302ZM93 259C137 251 152 224 143 207C111 213 92 231 93 259ZM112 208C70 200 55 175 66 158C98 166 115 184 112 208ZM130 152C169 140 182 111 169 96C139 107 125 128 130 152ZM139 101C105 88 97 62 112 48C139 60 150 81 139 101ZM52 321C39 279 15 270 2 281C13 309 31 324 52 321ZM158 57C184 41 185 19 169 9C149 28 145 45 158 57Z" fill="currentColor" opacity=".42" />
    <path d="M53 339C95 287 120 226 130 177" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity=".5" />
  </svg>
}

function PublicPage({ settings, onEnterAdmin, lookupGuest, answerGuest }: {
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
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [success, setSuccess] = useState(false)
  const [addressNotice, setAddressNotice] = useState('')
  const [now, setNow] = useState(Date.now())
  const lookupAbort = useRef<AbortController | null>(null)
  useEffect(() => () => { lookupAbort.current?.abort() }, [])
  useEffect(() => { const interval = window.setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(interval) }, [])
  const deadlinePassed = !settings.rsvp_deadline || new Date(`${settings.rsvp_deadline}T23:59:59-03:00`).getTime() < now

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
      if (!result) { setNotice('Não encontramos esse nome. Digite o nome completo ou o nome alternativo exatamente como foi cadastrado pelos noivos. Se continuar sem encontrar, fale com eles para conferir o cadastro.'); return }
      if ('ambiguous' in result) { setAmbiguous(true); setNotice('Encontramos mais de uma pessoa com esse nome. Para proteger sua privacidade, informe os 4 últimos números do telefone cadastrado.'); return }
      setAmbiguous(false); setFound(result); setMessage(''); setMessageEdited(false)
    } catch (error) { if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : 'Não foi possível buscar agora. Tente novamente em instantes.') }
    finally { if (lookupAbort.current === controller) { lookupAbort.current = null; setBusy(false) } }
  }
  function cancelLookup() {
    lookupAbort.current?.abort(); lookupAbort.current = null
    setBusy(false); setNotice('Busca cancelada. Você pode tentar novamente.')
  }
  async function answer(status: Status) {
    if (!found || busy || deadlinePassed) return
    setBusy(true); setNotice('')
    try {
      await answerGuest(found.token, found.guest.id, status, messageEdited ? message.trim() : null, keyword)
      setFound({ ...found, guest: { ...found.guest, status } }); setSuccess(true)
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
          <div className="rsvp-card-index">01 <span>·</span> RSVP</div>{deadlinePassed && !found && <div className="deadline-note"><Clock3 size={17} /><span>O prazo de confirmação encerrou. Você ainda pode consultar a resposta registrada.</span></div>}
          {success && found ? <div className="success-state"><span className="success-seal"><Check size={26} /></span><span className="eyebrow">RESPOSTA REGISTRADA</span><h3>Obrigado, {found.guest.full_name.split(' ')[0]}!</h3><p>{found.guest.status === 'confirmed' ? 'Sua presença está confirmada! Vamos adorar celebrar juntos.' : 'Recebemos seu carinho. Obrigado por nos avisar — você estará em nossos pensamentos.'}</p><div className="success-petals" aria-hidden="true">{Array.from({ length: 10 }, (_, i) => <i key={i} style={{ '--petal-index': i } as React.CSSProperties}>✦</i>)}</div><button className="text-button" onClick={() => { setSuccess(false); setNotice('') }}>Editar minha resposta</button></div> : found ? <div className="found-state">
            <span className="eyebrow">QUE ALEGRIA TER VOCÊ AQUI</span><h3>Olá, {found.guest.full_name.split(' ')[0]}!</h3>
            {(found.guest.status === 'confirmed' || found.guest.status === 'declined') && <p className="existing-answer">Sua resposta está registrada: <strong>{displayStatus[found.guest.status]}</strong>. {!deadlinePassed && <>Você pode alterá-la até {brDate(settings.rsvp_deadline)}.</>}</p>}
            {!deadlinePassed ? <>
              <p>Você confirma sua presença?</p>
              <div className="answer-buttons"><button className="button button--primary" disabled={busy} onClick={() => answer('confirmed')}><Heart size={16} /> Confirmo presença</button><button className="button button--outline" disabled={busy} onClick={() => answer('declined')}>Não poderei comparecer</button></div>
              <label className="field-label" htmlFor="guest-message">Deixe um recado para os noivos <span>opcional</span></label><textarea id="guest-message" disabled={busy} maxLength={500} value={message} onChange={e => { setMessage(e.target.value); setMessageEdited(true) }} placeholder="Uma mensagem carinhosa, um desejo, uma lembrança…" /><div className={`char-count ${message.length >= 450 ? 'near-limit' : ''}`}>{message.length} / 500</div>
              {found.guest.status !== 'pending' && <p className="privacy-note">Se você já deixou um recado, ele será mantido. Escreva aqui somente se quiser substituí-lo.</p>}
              <div className="privacy-note"><ShieldCheck size={16} /> Seu recado é privado e será visto apenas pelos noivos.</div>
            </> : <div className="deadline-note"><Clock3 size={17} /><span>O prazo para confirmar presença já encerrou. Obrigado pelo carinho!</span></div>}
            <p className="form-notice" role="alert">{notice}</p><button className="text-button" disabled={busy} onClick={() => { setFound(null); setSuccess(false); setNotice(''); setAmbiguous(false); setLast4('') }}><ArrowLeft size={14} /> Buscar outro nome</button>
          </div> : <form onSubmit={lookup} className="lookup-form">
            <label className="field-label" htmlFor="invite-keyword">Palavra-chave do convite</label>
            <div className="input-wrap"><ShieldCheck size={18} /><input id="invite-keyword" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-describedby="invite-keyword-help" disabled={busy} value={keyword} onChange={e => { setKeyword(e.target.value); setFound(null); setSuccess(false); setAmbiguous(false); setLast4(''); setNotice('') }} placeholder="Digite a palavra-chave recebida" required maxLength={100} /></div>
            <p className="lookup-help" id="invite-keyword-help">Ela está no seu convite e permite buscar sua confirmação.</p>
            <label className="field-label" htmlFor="guest-name">Seu nome completo</label>
            <div className="input-wrap"><Users size={18} /><input autoComplete="off" id="guest-name" aria-describedby="guest-name-help" disabled={busy} value={name} onChange={e => { setName(e.target.value); setAmbiguous(false); setLast4(''); setNotice('') }} placeholder="Como foi cadastrado pelos noivos" required minLength={3} maxLength={160} /><button type="submit" aria-label="Buscar convite" disabled={busy}>{busy ? <span className="leaf-loader"><Leaf size={19} /></span> : <ArrowRight size={19} />}</button></div>
            <p className="lookup-help" id="guest-name-help">Use o nome completo ou o nome alternativo cadastrado pelos noivos. A busca não mostra a lista de convidados.</p>
            {ambiguous && <div className="disambiguation"><label className="field-label" htmlFor="last4">4 últimos números do telefone cadastrado</label><input id="last4" inputMode="numeric" disabled={busy} required minLength={4} maxLength={4} value={last4} onChange={e => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="••••" /></div>}
            {notice && <p className="form-notice" role="alert">{notice}</p>}
            <p className="privacy-note"><ShieldCheck size={16} /> Seus dados são usados somente para organizar o casamento.</p>
            <button className="button button--primary lookup-submit" disabled={busy}>{busy ? 'Buscando…' : 'Encontrar meu convite'} <ArrowRight size={16} /></button>
            {busy && <div className="lookup-progress" role="status"><p>A busca pode levar alguns segundos.</p><button type="button" className="text-button" onClick={cancelLookup}>Cancelar busca</button></div>}
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
    <a href="#confirmacao" className="mobile-rsvp">Confirmar presença <ArrowRight size={16} /></a>
    {addressNotice && <div className="toast toast--public" role="status">{addressNotice}<button onClick={() => setAddressNotice('')}><X size={15} /></button></div>}
  </div>
}

function Icon({ name }: { name: string }) {
  const props = { size: 17, strokeWidth: 1.7 }
  if (name === 'overview') return <Sparkles {...props} />
  if (name === 'guests') return <Users {...props} />
  if (name === 'pending') return <Clock3 {...props} />
  if (name === 'messages') return <MessageCircle {...props} />
  if (name === 'info') return <CalendarDays {...props} />
  if (name === 'trash') return <Trash2 {...props} />
  if (name === 'history') return <Clock3 {...props} />
  return <Settings2 {...props} />
}

function MetricCard({ icon, label, value, hint, accent }: { icon: ReactNode; label: string; value: number; hint: string; accent: string }) {
  const [count, setCount] = useState(0)
  useEffect(() => { let frame = 0; const start = performance.now(); const duration = 650; const tick = (now: number) => { const p = Math.min(1, (now - start) / duration); setCount(Math.round(value * (1 - (1 - p) ** 3))); if (p < 1) frame = requestAnimationFrame(tick) }; frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame) }, [value])
  return <article className={`metric-card ${accent}`}><div className="metric-top"><span className="metric-icon">{icon}</span><MoreHorizontal size={19} /></div><span className="metric-label">{label}</span><strong>{count.toLocaleString('pt-BR')}</strong><span className="metric-hint">{hint}</span></article>
}

function newGuest(side: Side): Guest { return { id: makeId(), full_name: '', alt_name: '', side, phone: '', status: 'pending', confirmed_at: null, notes: '', message: '', message_read: false, message_favorite: false, last_reminder_at: null, reminder_count: 0, deleted_at: null, deleted_by: null, created_at: new Date().toISOString() } }
function validateSettings(settings: WeddingSettings, publish: boolean) {
  if (!settings.couple_names.trim()) throw new Error('Informe o nome do casal.')
  if (!settings.rsvp_deadline) throw new Error('Informe o prazo para confirmar presença.')
  if (settings.wedding_date && settings.rsvp_deadline > settings.wedding_date) throw new Error('O prazo de confirmação deve ser anterior ou igual à data do casamento.')
  if (settings.venues.some(item => item.map_url && !/^https:\/\//i.test(item.map_url))) throw new Error('Os links de mapas devem começar com https://.')
  if (publish && (settings.schedule.some(item => item.visible && (!item.title.trim() || !/^\d{2}:\d{2}$/.test(item.time))) || settings.venues.some(item => item.visible && (!item.name.trim() || !item.address.trim())) || settings.announcements.some(item => item.visible && (!item.title.trim() || !item.body.trim())))) throw new Error('Complete os títulos, horários, endereços e textos dos itens visíveis antes de publicar.')
}
function parseImport(text: string) {
  const input = text.replace(/^\ufeff/, '').trim()
  if (!input) return []
  const separator = input.split('\n')[0].includes(';') ? ';' : input.split('\n')[0].includes(',') ? ',' : '\t'
  const rows: string[][] = []; let row: string[] = []; let field = ''; let quoted = false
  for (let i = 0; i < input.length; i++) { const char = input[i]; if (char === '"') { if (quoted && input[i + 1] === '"') { field += '"'; i++ } else quoted = !quoted } else if (!quoted && char === separator) { row.push(field); field = '' } else if (!quoted && char === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = '' } else field += char }
  if (quoted) throw new Error('O CSV contém aspas não fechadas. Revise o arquivo.')
  row.push(field.replace(/\r$/, '')); rows.push(row)
  const header = rows[0].map(normalizeName)
  const hasHeader = header.some(value => ['nome', 'nome completo', 'full_name'].includes(value))
  const nameIndex = hasHeader ? header.findIndex(value => ['nome', 'nome completo', 'full_name'].includes(value)) : 0
  const phoneIndex = hasHeader ? header.findIndex(value => ['telefone', 'whatsapp', 'phone'].includes(value)) : 1
  const altIndex = hasHeader ? header.findIndex(value => ['nome alternativo', 'apelido', 'alt_name'].includes(value)) : 2
  return rows.slice(hasHeader ? 1 : 0).filter(values => values.some(value => value.trim())).map((values, index) => { const name = values[nameIndex]?.trim() ?? ''; if (name.length < 3 || name.length > 160) throw new Error(`Confira o nome na linha ${index + (hasHeader ? 2 : 1)}.`); return { name, phone: values[phoneIndex] ?? '', alt: values[altIndex] ?? '' } })
}
function DraftPreview({ settings, mobile, onMobile, onClose }: { settings: WeddingSettings; mobile: boolean; onMobile: () => void; onClose: () => void }) {
  const [frameBody, setFrameBody] = useState<HTMLElement | null>(null)
  return <div className="modal-backdrop preview-backdrop" role="dialog" aria-modal="true" aria-label="Prévia do rascunho"><div className="draft-preview"><div className="modal-head"><div><span className="eyebrow">RASCUNHO · NÃO PUBLICADO</span><h2>Prévia do convite</h2></div><button className="button button--ghost" onClick={onMobile}>{mobile ? 'Ver computador' : 'Ver celular'}</button><button className="icon-button" aria-label="Fechar prévia" onClick={onClose}><X size={19} /></button></div><iframe title="Prévia do convite" className="preview-frame" style={{ width: mobile ? 390 : '100%', maxWidth: '100%', height: '72vh', margin: '0 auto', display: 'block', border: 0 }} onLoad={event => { const doc = event.currentTarget.contentDocument; if (!doc) return; doc.documentElement.lang = 'pt-BR'; document.querySelectorAll('link[rel="stylesheet"],style').forEach(style => doc.head.appendChild(style.cloneNode(true))); setFrameBody(doc.body) }} srcDoc="<!doctype html><html lang='pt-BR'><head><meta name='viewport' content='width=device-width, initial-scale=1'></head><body></body></html>" />{frameBody && createPortal(<PublicPage settings={settings} onEnterAdmin={onClose} lookupGuest={async () => { throw new Error('Esta é uma prévia. As confirmações ficam disponíveis no convite publicado.') }} answerGuest={async () => { throw new Error('Esta é uma prévia.') }} />, frameBody)}</div></div>
}

function GuestModal({ guest, side, onClose, onSave }: { guest?: Guest; side: Side; onClose: () => void; onSave: (guest: Guest) => Promise<void> }) {
  const [form, setForm] = useState<Guest>(guest ?? newGuest(side))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent) { event.preventDefault(); if (busy) return; setBusy(true); setError(''); try { if (form.full_name.trim().length < 3) throw new Error('Informe o nome completo, com pelo menos 3 caracteres.'); await onSave({ ...form, full_name: form.full_name.trim(), alt_name: form.alt_name.trim(), phone: normalizePhone(form.phone) }) } catch (error) { setError(errorText(error)) } finally { setBusy(false) } }
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose() }}><form className="guest-modal" onSubmit={submit} role="dialog" aria-modal="true" aria-label={guest ? 'Editar convidado' : 'Novo convidado'}>
    <div className="modal-head"><div><span className="eyebrow">CONVIDADOS DA {side === 'luciene' ? 'LUCIENE' : 'MAURICIO'}</span><h2>{guest ? 'Editar convidado' : 'Novo convidado'}</h2></div><button type="button" className="icon-button" onClick={onClose}><X size={19} /></button></div>
    <label>Nome completo<input autoFocus required minLength={3} maxLength={160} value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} placeholder="Nome como aparece no convite" /></label>
    <div className="form-row"><label>Nome alternativo<input maxLength={120} value={form.alt_name} onChange={e => setForm({ ...form, alt_name: e.target.value })} placeholder="Como a pessoa é chamada" /></label><label>WhatsApp<input inputMode="tel" value={formatPhone(form.phone)} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="(11) 99999-9999" /></label></div>
    <label>Status<select value={form.status} onChange={e => setForm({ ...form, status: e.target.value as Status, confirmed_at: e.target.value === 'pending' ? null : form.confirmed_at ?? new Date().toISOString() })}><option value="pending">Pendente</option><option value="confirmed">Confirmou presença</option><option value="declined">Não poderá comparecer</option></select></label>
    <label>Observações privadas<textarea value={form.notes} maxLength={400} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Anotações visíveis apenas no painel" /></label>
    {error && <p className="form-notice" role="alert">{error}</p>}
    <div className="modal-actions"><button type="button" className="button button--ghost" disabled={busy} onClick={onClose}>Cancelar</button><button disabled={busy} className="button button--primary">{busy ? 'Salvando…' : guest ? 'Salvar alterações' : 'Adicionar convidado'} <ArrowRight size={15} /></button></div>
  </form></div>
}

function AdminShell({ profile, signOut, data, published, persistGuest, importGuests, saveSettings, deleteGuest, permanentDelete, markReminder, setMessageFlags, toast }: {
  profile: Profile; signOut: () => void; data: DemoData; published: WeddingSettings; importGuests: (guests: Guest[]) => Promise<void>; setMessageFlags: (message: GuestMessage, read: boolean, favorite: boolean) => Promise<void>
  persistGuest: (guest: Guest) => Promise<void>; saveSettings: (draft: WeddingSettings, publish: boolean) => Promise<void>; deleteGuest: (guest: Guest) => Promise<void>; permanentDelete: (guest: Guest) => Promise<void>; markReminder: (guest: Guest) => Promise<void>; toast: (message: string, undo?: () => void) => void
}) {
  const [section, setSection] = useState('overview')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [modal, setModal] = useState<Guest | 'new' | null>(null)
  const [mobileMenu, setMobileMenu] = useState(false)
  const [draft, setDraft] = useState<WeddingSettings>(data.settings)
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState('name')
  const [reminderFilter, setReminderFilter] = useState('all')
  const [messageSide, setMessageSide] = useState('all')
  const [historyAction, setHistoryAction] = useState('all')
  const [historyFrom, setHistoryFrom] = useState('')
  const [historyTo, setHistoryTo] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [previewMobile, setPreviewMobile] = useState(true)
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')
  const [includeSide, setIncludeSide] = useState(false)
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [infoTab, setInfoTab] = useState<'schedule' | 'venues' | 'announcements'>('schedule')
  const sideName = profile.side === 'luciene' ? 'Luciene' : 'Mauricio'
  const ownGuests = data.guests.filter(g => g.side === profile.side)
  const activeGuests = ownGuests.filter(g => !g.deleted_at)
  const visibleGuests = useMemo(() => {
    let list = section === 'trash' ? ownGuests.filter(g => g.deleted_at) : activeGuests
    if (section === 'pending') list = list.filter(g => g.status === 'pending')
    if (filter !== 'all' && section !== 'trash') list = list.filter(g => g.status === filter)
    if (query.trim()) list = list.filter(g => normalizeName(g.full_name).includes(normalizeName(query)) || normalizeName(g.alt_name).includes(normalizeName(query)))
    if (section === 'pending' && reminderFilter === 'never') list = list.filter(g => !g.last_reminder_at)
    if (section === 'pending' && reminderFilter === 'week') list = list.filter(g => g.last_reminder_at && new Date(g.last_reminder_at).getTime() < Date.now() - 7 * 86400000)
    return [...list].sort((a, b) => sort === 'newest' ? b.created_at.localeCompare(a.created_at) : sort === 'status' ? a.status.localeCompare(b.status) || a.full_name.localeCompare(b.full_name, 'pt-BR') : a.full_name.localeCompare(b.full_name, 'pt-BR') * (sort === 'reverse' ? -1 : 1))
  }, [data.guests, section, filter, query, profile.side, sort, reminderFilter])
  const totals = { all: activeGuests.length, confirmed: activeGuests.filter(g => g.status === 'confirmed').length, pending: activeGuests.filter(g => g.status === 'pending').length, declined: activeGuests.filter(g => g.status === 'declined').length }
  const pct = totals.all ? Math.round(totals.confirmed / totals.all * 100) : 0

  const pageCount = Math.max(1, Math.ceil(visibleGuests.length / 20))
  const pageGuests = visibleGuests.slice((Math.min(page, pageCount) - 1) * 20, Math.min(page, pageCount) * 20)
  const filteredMessages = data.messages.filter(g => (filter !== 'favorites' || g.message_favorite) && (messageSide === 'all' || g.side === messageSide) && (!query || normalizeName(g.full_name).includes(normalizeName(query))))
  const filteredHistory = data.audit.filter(item => (filter === 'all' || item.actor.toLowerCase() === filter.toLowerCase()) && (historyAction === 'all' || item.action === historyAction) && (!query || normalizeName(item.guest).includes(normalizeName(query))) && (!historyFrom || item.created_at >= `${historyFrom}T00:00:00-03:00`) && (!historyTo || new Date(item.created_at) <= new Date(`${historyTo}T23:59:59-03:00`)))
  useEffect(() => { if (!dirty) setDraft(data.settings) }, [data.settings, dirty])
  useEffect(() => { setPage(1) }, [query, filter, section, reminderFilter, sort])
  useEffect(() => { const handleKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setModal(null) }; window.addEventListener('keydown', handleKey); return () => window.removeEventListener('keydown', handleKey) }, [])

  async function run(action: () => Promise<void>) { if (busy) return; setBusy(true); try { await action() } catch (error) { toast(errorText(error)) } finally { setBusy(false) } }
  async function saveGuest(guest: Guest) { const exists = data.guests.some(g => g.id === guest.id); await persistGuest(guest); setModal(null); toast(exists ? 'Convidado atualizado.' : 'Convidado adicionado.') }
  async function softDelete(guest: Guest) { if (!window.confirm(`Mover ${guest.full_name} para a lixeira?`)) return; await run(async () => { const deleted = { ...guest, deleted_at: new Date().toISOString(), deleted_by: profile.id }; await deleteGuest(deleted); toast('Convidado movido para a lixeira.', () => void run(async () => { await persistGuest({ ...guest, deleted_at: null, deleted_by: null }); toast('Convidado restaurado.') })) }) }
  async function restore(guest: Guest) { await run(async () => { await persistGuest({ ...guest, deleted_at: null, deleted_by: null }); toast('Convidado restaurado.') }) }
  async function removeForever(guest: Guest) { if (!window.confirm(`Excluir ${guest.full_name} definitivamente? Esta ação não pode ser desfeita.`)) return; await run(async () => { await permanentDelete(guest); toast('Convidado excluído definitivamente.') }) }
  function reminderBody(guest: Guest) { const values: Record<string, string> = { nome: guest.full_name.split(' ')[0], link: publicUrl(), prazo: brDate(draft.rsvp_deadline), noivos: draft.couple_names }; return draft.rsvp_message_template.replace(/\{(nome|link|prazo|noivos)\}/g, (_, key: string) => values[key]) }
  function openReminder(guest: Guest) { if (!guest.phone || busy) return; try { const phone = normalizePhone(guest.phone); window.open(`https://wa.me/${phone}?text=${encodeURIComponent(reminderBody(guest))}`, '_blank', 'noopener,noreferrer'); void run(async () => { await markReminder(guest); toast('Conversa aberta. A cobrança foi registrada; envie a mensagem no WhatsApp.') }) } catch (error) { toast(errorText(error)) } }
  async function copyReminder(guest: Guest) { await run(async () => { await navigator.clipboard.writeText(reminderBody(guest)); toast('Mensagem copiada.') }) }
  async function saveDraft(publish: boolean) { await run(async () => { validateSettings(draft, publish); await saveSettings(draft, publish); setDirty(false); toast(publish ? 'Informações publicadas no convite.' : 'Rascunho salvo.') }) }
  async function importRows() { await run(async () => { const rows = parseImport(importText); if (!rows.length) throw new Error('Cole nomes ou selecione um CSV para importar.'); if (rows.length > 500) throw new Error('Importe até 500 convidados por vez.'); const existing = new Set(activeGuests.map(g => normalizeName(g.full_name))); const seen = new Set<string>(); const guests = rows.filter(row => { const name = normalizeName(row.name); if (existing.has(name) || seen.has(name)) return false; seen.add(name); return true }).map(row => ({ ...newGuest(profile.side), full_name: row.name.trim(), alt_name: row.alt.trim(), phone: normalizePhone(row.phone) })); if (!guests.length) throw new Error('Todos os nomes já estão cadastrados na sua lista.'); await importGuests(guests); setShowImport(false); setImportText(''); toast(`${guests.length} convidados importados. ${rows.length - guests.length} duplicados ignorados.`) }) }
  async function changePassword(event: FormEvent) { event.preventDefault(); await run(async () => { if (password.length < 12) throw new Error('Use uma senha com pelo menos 12 caracteres.'); if (password !== passwordConfirm) throw new Error('As senhas precisam ser iguais.'); if (!supabase) throw new Error('Conexão indisponível.'); const { error } = await supabase.auth.updateUser({ password }); if (error) throw error; setPassword(''); setPasswordConfirm(''); toast('Sua senha foi atualizada.') }) }
  function reorder(kind: 'schedule' | 'venues' | 'announcements', from: number, to: number) { const items = [...draft[kind]]; if (to < 0 || to >= items.length) return; const [moved] = items.splice(from, 1); items.splice(to, 0, moved); setDraft({ ...draft, [kind]: items }); setDirty(true) }
  function exportCsv() { const rows = [['Nome', 'Lado', 'Status', 'WhatsApp', 'Data de confirmação'], ...activeGuests.map(g => [g.full_name, g.side === 'luciene' ? 'Luciene' : 'Mauricio', displayStatus[g.status], g.phone, g.confirmed_at ? new Date(g.confirmed_at).toLocaleDateString('pt-BR') : ''])]; const csv = rows.map(row => row.map(cell => `"${String(cell).replace(/^[=+@-]/, "\'").replace(/"/g, '""')}"`).join(';')).join('\r\n'); downloadBlob(`luciene-mauricio-convidados.csv`, '\ufeff' + csv, 'text/csv;charset=utf-8') }
  async function exportPdf(status: Status = 'confirmed') { await run(async () => {
    const { jsPDF } = await import('jspdf')
    const list = activeGuests.filter(g => g.status === status).sort((a, b) => a.full_name.localeCompare(b.full_name, 'pt-BR'))
    const doc = new jsPDF()
    const paper = () => { doc.setFillColor(250, 246, 236); doc.rect(0, 0, 210, 297, 'F'); doc.setTextColor(59, 63, 51) }
    paper(); doc.setTextColor(74, 86, 40); doc.setFont('times', 'italic'); doc.setFontSize(30); doc.text('L & M', 105, 26, { align: 'center' }); doc.setFont('times', 'normal'); doc.setFontSize(21); doc.text(draft.couple_names, 105, 39, { align: 'center' }); doc.setFontSize(10); doc.setTextColor(110, 116, 89); doc.text(`${status === 'confirmed' ? 'Lista de presenças confirmadas' : 'Lista de confirmações pendentes'} · ${draft.wedding_date ? brDate(draft.wedding_date) : 'Data a definir'}`, 105, 47, { align: 'center' }); doc.setDrawColor(198, 168, 91); doc.line(25, 54, 185, 54); doc.setTextColor(59, 63, 51); doc.setFont('times', 'normal'); doc.setFontSize(12)
    let y = 66
    list.forEach((guest, i) => {
      const lines: string[] = doc.splitTextToSize(`${String(i + 1).padStart(2, '0')}   ${guest.full_name}${includeSide ? ` · ${guest.side === 'luciene' ? 'Luciene' : 'Mauricio'}` : ''}`, 150)
      if (y + lines.length * 6 > 270) { doc.addPage(); paper(); y = 24 }
      doc.text(lines, 30, y); y += lines.length * 6 + 3
    })
    if (y > 259) { doc.addPage(); paper(); y = 24 }
    y += 8; doc.setDrawColor(198, 168, 91); doc.line(25, y, 185, y); y += 10; doc.setFont('times', 'italic'); doc.text(`Total: ${list.length} ${list.length === 1 ? 'convidado' : 'convidados'}`, 105, y, { align: 'center' }); doc.save(`lista-${status === 'confirmed' ? 'confirmados' : 'pendentes'}-luciene-mauricio.pdf`)
  }) }
  function changeDraft<K extends keyof WeddingSettings>(key: K, value: WeddingSettings[K]) { setDraft({ ...draft, [key]: value }); setDirty(true) }
  function updateSchedule(i: number, patch: Partial<ScheduleItem>) { changeDraft('schedule', draft.schedule.map((item, index) => index === i ? { ...item, ...patch } : item)) }
  function updateVenue(i: number, patch: Partial<Venue>) { changeDraft('venues', draft.venues.map((item, index) => index === i ? { ...item, ...patch } : item)) }
  function updateAnnouncement(i: number, patch: Partial<Announcement>) { changeDraft('announcements', draft.announcements.map((item, index) => index === i ? { ...item, ...patch } : item)) }

  const heading = section === 'overview' ? 'Visão geral' : section === 'guests' ? 'Convidados' : section === 'pending' ? 'Aguardando resposta' : section === 'messages' ? 'Recados para vocês' : section === 'info' ? 'Informações do casamento' : section === 'trash' ? 'Lixeira' : section === 'history' ? 'Histórico de alterações' : 'Configurações';
  return <div className="admin-app">
    <aside className={`admin-sidebar ${mobileMenu ? 'is-open' : ''}`}>
      <a href={publicUrl()} className="admin-brand"><BrandMark small /><span><strong>Luciene <i>&</i> Mauricio</strong><small>PAINEL DOS NOIVOS</small></span></a>
      <div className="admin-side-label">MENU PRINCIPAL</div>
      <nav>{navItems.map(item => <button key={item.id} className={`side-nav-item ${section === item.id ? 'is-active' : ''}`} onClick={() => { setSection(item.id); setQuery(''); setFilter('all'); setMobileMenu(false) }}><Icon name={item.icon} /><span>{item.label}</span>{item.id === 'pending' && totals.pending > 0 && <i className="nav-count">{totals.pending}</i>}</button>)}</nav>
      <div className="sidebar-spacer" />
      <div className="side-tip"><span className="tip-spark">✧</span><p>O amor está nos detalhes.<br /><strong>Continue preparando tudo com carinho.</strong></p><span>✳ · ✳ · ✳</span></div>
      <button className="admin-user" onClick={signOut}><span className="avatar">{sideName[0]}</span><span><strong>{sideName}</strong><small>{profile.side === 'luciene' ? 'Noiva' : 'Noivo'}</small></span><LogOut size={16} /></button>
    </aside>
    <div className="admin-main">
      <header className="admin-topbar"><button className="mobile-menu-button" onClick={() => setMobileMenu(!mobileMenu)}><Menu size={20} /></button><div className="breadcrumb">Painel <ChevronRight size={13} /> <strong>{heading}</strong></div><div className="topbar-actions"><a href={publicUrl()} target="_blank" rel="noreferrer" className="public-preview">Ver página pública <ArrowUpRight size={14} /></a><button className="icon-button notification-button" aria-label="Ver recados não lidos" onClick={() => { setSection('messages'); setFilter('all') }}><Bell size={17} />{data.messages.some(message => !message.message_read) && <i />}</button></div></header>
      <main className="admin-content" key={section}>
        {section === 'overview' && <>
          <div className="page-title-row"><div><span className="eyebrow">BOM TE VER POR AQUI, {sideName.toUpperCase()}</span><h1>Seu casamento está florescendo.</h1><p>Um resumo delicado de tudo o que já está tomando forma.</p></div><button className="button button--primary" onClick={() => setModal('new')}><Plus size={16} /> Adicionar convidado</button></div>
          <div className="metrics-grid"><MetricCard icon={<Users size={18} />} label="Convidados" value={totals.all} hint="na sua lista" accent="metric-sage" /><MetricCard icon={<Heart size={18} />} label="Confirmaram" value={totals.confirmed} hint={`${pct}% da sua lista`} accent="metric-green" /><MetricCard icon={<Clock3 size={18} />} label="Aguardando" value={totals.pending} hint="respostas pendentes" accent="metric-gold" /><MetricCard icon={<MessageCircle size={18} />} label="Não poderão ir" value={totals.declined} hint="respostas recebidas" accent="metric-rose" /></div>
          <div className="dashboard-grid">
            <article className="panel progress-panel"><div className="panel-head"><div><span className="eyebrow">ACOMPANHAMENTO</span><h2>Confirmações</h2></div><span className="panel-icon"><Sparkles size={17} /></span></div><div className="progress-summary"><strong>{pct}<small>%</small></strong><span>da sua lista confirmou presença</span></div><div className="progress-track"><span style={{ width: `${pct}%` }} /></div><div className="progress-legend"><span><i className="legend-dot is-confirmed" />Confirmaram <b>{totals.confirmed}</b></span><span><i className="legend-dot is-pending" />Pendentes <b>{totals.pending}</b></span><span><i className="legend-dot is-declined" />Recusaram <b>{totals.declined}</b></span></div><div className="donut-row"><div className="donut-chart" style={{ '--confirmed': `${totals.all ? totals.confirmed / totals.all * 100 : 0}%`, '--pending': `${totals.all ? totals.pending / totals.all * 100 : 0}%` } as React.CSSProperties}><span>{totals.all}</span></div><p>pessoas especiais<br />na sua lista</p></div></article>
            <article className="panel countdown-panel"><div className="panel-head"><div><span className="eyebrow">O GRANDE DIA</span><h2>Estamos chegando.</h2></div><CalendarDays size={18} /></div><p className="countdown-copy">{draft.wedding_date ? `Uma data para guardar: ${brDate(draft.wedding_date)}` : 'A data do casamento pode ser adicionada nas informações.'}</p><div className="countdown-date"><span className="countdown-flower">✳</span><div><strong>{draft.rsvp_deadline ? brDate(draft.rsvp_deadline) : 'Prazo a definir'}</strong><small>prazo para confirmar presença</small></div></div><button className="text-button" onClick={() => setSection('settings')}>Editar prazo <ArrowRight size={14} /></button><Countdown date={draft.rsvp_deadline} /><div className="countdown-ornament">L <span>&</span> M</div></article>
          </div>
          <article className="panel recent-panel"><div className="panel-head"><div><span className="eyebrow">MOMENTOS RECENTES</span><h2>Últimas confirmações</h2></div><button className="text-button" onClick={() => setSection('guests')}>Ver convidados <ArrowRight size={14} /></button></div><div className="recent-list">{activeGuests.filter(g => g.status === 'confirmed').sort((a, b) => (b.confirmed_at ?? '').localeCompare(a.confirmed_at ?? '')).slice(0, 4).map(g => <div className="recent-row" key={g.id}><span className="recent-avatar">{g.full_name[0]}</span><span className="recent-name"><strong>{g.full_name}</strong><small>Convidado da {g.side === 'luciene' ? 'Luciene' : 'Mauricio'}</small></span><span className="status-badge status-confirmed"><Check size={12} /> Confirmou</span><span className="recent-time">{g.confirmed_at ? timeAgo(g.confirmed_at) : 'Agora'}</span></div>)}{!totals.confirmed && <div className="empty-row">Suas confirmações vão aparecer aqui.</div>}</div></article>
        </>}
        {(section === 'guests' || section === 'pending' || section === 'trash') && <>
          <div className="page-title-row"><div><span className="eyebrow">LISTA PRIVADA · {sideName.toUpperCase()}</span><h1>{heading}</h1><p>{section === 'trash' ? 'Convidados excluídos podem ser restaurados por até 30 dias.' : 'Cuide dos nomes e das respostas com todo carinho.'}</p></div><div className="title-actions">{section !== 'trash' && <><button className="button button--ghost" onClick={() => setShowImport(true)}>Importar nomes</button><button className="button button--ghost" onClick={exportCsv}><Download size={15} /> Exportar CSV</button><button className="button button--ghost" onClick={() => exportPdf('confirmed')}><FileDown size={15} /> PDF confirmados</button><button className="button button--primary" onClick={() => setModal('new')}><Plus size={16} /> Novo convidado</button></>}</div></div>
          <section className="panel guests-panel"><div className="guest-toolbar"><label className="sort-control">Ordenar<select value={sort} onChange={e => setSort(e.target.value)}><option value="name">Nome A–Z</option><option value="reverse">Nome Z–A</option><option value="newest">Mais recentes</option><option value="status">Status</option></select></label>{section !== 'trash' && <label className="pdf-side-option"><input type="checkbox" checked={includeSide} onChange={e => setIncludeSide(e.target.checked)} /> Incluir lado no PDF</label>}{section === 'pending' && <label>Cobranças<select value={reminderFilter} onChange={e => setReminderFilter(e.target.value)}><option value="all">Todas</option><option value="never">Nunca cobrados</option><option value="week">Há mais de 7 dias</option></select></label>}<div className="search-field"><Search size={17} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar pelo nome…" /></div>{section !== 'trash' && <div className="filter-chips">{[['all', 'Todos'], ['confirmed', 'Confirmados'], ['pending', 'Pendentes'], ['declined', 'Recusaram']].map(([key, label]) => <button key={key} onClick={() => setFilter(key)} className={filter === key ? 'is-selected' : ''}>{label}{key === 'all' ? ` (${totals.all})` : ` (${activeGuests.filter(g => g.status === key).length})`}</button>)}</div>}{section === 'pending' && <button className="button button--ghost" onClick={() => exportPdf('pending')}><FileDown size={14} /> Exportar pendentes</button>}</div>
            <div className="guest-table-wrap"><table className="guest-table"><thead><tr><th>CONVIDADO</th><th>WHATSAPP</th><th>STATUS</th><th>{section === 'trash' ? 'EXCLUÍDO' : 'ÚLTIMA COBRANÇA'}</th><th aria-label="Ações" /></tr></thead><tbody>{pageGuests.map(g => <tr key={g.id}><td><div className="guest-name-cell"><span className="guest-avatar">{g.full_name[0]}</span><span><strong>{g.full_name}</strong><small>{g.alt_name || `Convidado da ${sideName}`}</small></span></div></td><td>{g.phone ? <span className="phone-cell">{formatPhone(g.phone)}</span> : <span className="muted">Não cadastrado</span>}</td><td><span className={`status-badge status-${g.status}`}>{g.status === 'confirmed' && <Check size={12} />}{displayStatus[g.status]}</span></td><td>{section === 'trash' ? <span className="muted">{g.deleted_at ? timeAgo(g.deleted_at) : ''} · {sideName}</span> : g.last_reminder_at ? <span className="muted">Cobrado {timeAgo(g.last_reminder_at)} · {g.reminder_count}×</span> : <span className="muted">Nunca cobrado</span>}</td><td><div className="row-actions">{section === 'trash' ? <><button className="mini-action" onClick={() => void restore(g)}>Restaurar</button><button className="icon-button" aria-label="Excluir definitivamente" onClick={() => void removeForever(g)}><Trash2 size={15} /></button></> : <>{section === 'pending' && <><button className="whatsapp-action" disabled={!g.phone || busy} title={g.phone ? 'Cobrar no WhatsApp' : 'Cadastre o WhatsApp para cobrar'} onClick={() => openReminder(g)}><MessageCircle size={14} /> Cobrar</button><button className="icon-button" title="Copiar mensagem" disabled={busy} onClick={() => void copyReminder(g)}><Copy size={15} /></button></>}<button className="icon-button" aria-label="Editar convidado" onClick={() => setModal(g)}><MoreHorizontal size={17} /></button><button className="icon-button" aria-label="Mover para lixeira" onClick={() => void softDelete(g)}><Trash2 size={15} /></button></>}</div></td></tr>)}{!visibleGuests.length && <tr><td colSpan={5}><div className="table-empty"><span>✳</span><strong>{section === 'trash' ? 'A lixeira está vazia' : section === 'pending' ? 'Tudo em dia por aqui' : 'Nenhum convidado encontrado'}</strong><small>{section === 'pending' ? 'Quando houver respostas pendentes, elas aparecem aqui.' : 'Adicione um convidado para começar sua lista.'}</small>{section === 'guests' && <button className="text-button" onClick={() => setModal('new')}><Plus size={14} /> Adicionar convidado</button>}</div></td></tr>}</tbody></table></div>
            <div className="table-footer"><span>{visibleGuests.length} convidados · página {Math.min(page, pageCount)} de {pageCount}</span><div className="pagination-controls"><button className="mini-action" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button><button className="mini-action" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>Próxima</button></div><span>Lista da {sideName} · privada</span></div>
          </section>
          {section === 'guests' && !activeGuests.length && ownGuests.some(g => g.deleted_at) && <div className="whatsapp-tip"><Trash2 size={18} /><span><strong>Há convidados na lixeira.</strong><small>Somente convidados ativos podem ser encontrados na confirmação de presença. Abra a Lixeira e escolha Restaurar para devolver um nome à lista.</small></span><button className="text-button" onClick={() => { setQuery(''); setFilter('all'); setSection('trash') }}>Abrir Lixeira <ArrowRight size={14} /></button></div>}
          {section === 'pending' && <div className="whatsapp-tip"><MessageCircle size={18} /><span><strong>Uma mensagem carinhosa faz toda a diferença.</strong><small>O envio pelo WhatsApp é manual; cada clique abre a conversa com a mensagem preenchida.</small></span><button className="text-button" onClick={() => setSection('settings')}>Editar mensagem <ArrowRight size={14} /></button></div>}
        </>}
        {section === 'messages' && <>
          <div className="page-title-row"><div><span className="eyebrow">PALAVRAS GUARDADAS COM CARINHO</span><h1>Recados para vocês.</h1><p>Mensagens privadas de pessoas queridas, visíveis apenas aos noivos.</p></div><span className="message-count-pill"><MessageCircle size={15} /> {data.messages.length} recados</span></div>
          <div className="message-tools"><div className="search-field"><Search size={17} /><input placeholder="Buscar recado pelo nome…" value={query} onChange={e => setQuery(e.target.value)} /></div><select aria-label="Lado do convidado" value={messageSide} onChange={e => setMessageSide(e.target.value)}><option value="all">Luciene e Mauricio</option><option value="luciene">Luciene</option><option value="mauricio">Mauricio</option></select><button className={`button ${filter === 'favorites' ? 'button--primary' : 'button--ghost'}`} onClick={() => setFilter(filter === 'favorites' ? 'all' : 'favorites')}><Heart size={15} /> Favoritos</button></div>
          <div className="message-grid">{filteredMessages.map(g => <article className={`message-card ${g.message_favorite ? 'is-favorite' : ''}`} key={g.guest_id}><button disabled={busy} className={`favorite-button ${g.message_favorite ? 'is-on' : ''}`} aria-label={g.message_favorite ? 'Remover dos favoritos' : 'Favoritar recado'} onClick={() => void run(() => setMessageFlags(g, g.message_read, !g.message_favorite))}><Heart size={17} fill={g.message_favorite ? 'currentColor' : 'none'} /></button><span className="eyebrow">{g.side === 'luciene' ? 'CONVIDADO DA LUCIENE' : 'CONVIDADO DO MAURICIO'}</span><p className="message-quote">“{g.message}”</p><div className="message-author"><span className="guest-avatar">{g.full_name[0]}</span><span><strong>{g.full_name}</strong><small>{g.confirmed_at ? timeAgo(g.confirmed_at) : 'Recado recebido'} · {displayStatus[g.status]}</small></span></div><button disabled={busy} className="message-read" onClick={() => void run(() => setMessageFlags(g, !g.message_read, g.message_favorite))}><span className={g.message_read ? 'read-dot is-read' : 'read-dot'} />{g.message_read ? 'Lido' : 'Marcar como lido'}</button></article>)}{!filteredMessages.length && <div className="panel empty-messages"><span>✳</span><h2>Os recados chegam aqui.</h2><p>Quando alguém deixar uma mensagem, vocês poderão ler e guardar esse carinho.</p></div>}</div>
          <button className="button button--ghost" disabled={!data.messages.some(message => message.message_favorite)} onClick={() => exportMessagesPdf(data.messages.filter(g => g.message_favorite))}><FileDown size={15} /> Exportar favoritos em PDF</button>
        </>}
        {section === 'info' && <>
          <div className="page-title-row"><div><span className="eyebrow">UM CONVITE SEMPRE VIVO</span><h1>Informações do casamento.</h1><p>Edite com calma e publique quando estiverem prontos para compartilhar.</p></div><span className="draft-indicator"><i /> Rascunho privado</span></div>
          <div className="publish-banner"><span className="publish-icon"><Sparkles size={18} /></span><span><strong>As mudanças aparecem só depois de publicar.</strong><small>O rascunho fica salvo no painel. Pré-visualize a página pública antes de compartilhar.</small></span><button className="text-button" onClick={() => setShowPreview(true)}>Pré-visualizar rascunho <ArrowUpRight size={14} /></button></div>
          <div className="info-tabs">{[['schedule', 'Programação'], ['venues', 'Local'], ['announcements', 'Avisos']].map(([key, label]) => <button className={infoTab === key ? 'is-active' : ''} key={key} onClick={() => setInfoTab(key as typeof infoTab)}>{label}</button>)}</div>
          <article className="panel info-editor">
            {infoTab === 'schedule' && <><div className="editor-head"><div><span className="eyebrow">A LINHA DO TEMPO</span><h2>Programação</h2><p>Organize os momentos especiais do dia.</p></div><label className="switch-label"><input type="checkbox" checked={draft.show_schedule} onChange={e => changeDraft('show_schedule', e.target.checked)} /><span className="switch" />Exibir na página pública</label></div><div className="editable-items">{draft.schedule.map((item, i) => <div className="editable-item" key={item.id ?? i} draggable onDragStart={() => setDragIndex(i)} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (dragIndex !== null) reorder('schedule', dragIndex, i); setDragIndex(null) }}><div className="reorder-controls"><span className="drag-handle" title="Arraste para reordenar">⠿</span><button className="icon-button" aria-label="Mover acima" disabled={i === 0} onClick={() => reorder('schedule', i, i - 1)}>↑</button><button className="icon-button" aria-label="Mover abaixo" disabled={i === draft.schedule.length - 1} onClick={() => reorder('schedule', i, i + 1)}>↓</button></div><input aria-label="Horário" className="time-input" type="time" value={item.time} onChange={e => updateSchedule(i, { time: e.target.value })} placeholder="16:00" /><div className="editable-main"><input aria-label="Título" value={item.title} onChange={e => updateSchedule(i, { title: e.target.value })} placeholder="Nome do momento" /><input aria-label="Descrição" value={item.description} onChange={e => updateSchedule(i, { description: e.target.value })} placeholder="Uma descrição carinhosa" /></div><select value={item.icon} onChange={e => updateSchedule(i, { icon: e.target.value })} aria-label="Ícone"><option value="rings">Alianças</option><option value="glass">Taças</option><option value="music">Música</option><option value="dinner">Jantar</option></select><label className="mini-switch"><input type="checkbox" checked={item.visible} onChange={e => updateSchedule(i, { visible: e.target.checked })} /><span /></label><button className="icon-button" aria-label="Excluir item" onClick={() => changeDraft('schedule', draft.schedule.filter((_, index) => index !== i))}><Trash2 size={15} /></button></div>)}{!draft.schedule.length && <div className="editor-empty">Nenhum momento adicionado ainda.</div>}<button className="add-row" onClick={() => changeDraft('schedule', [...draft.schedule, { id: makeId(), time: '', title: '', description: '', icon: 'rings', visible: true }])}><Plus size={15} /> Adicionar momento</button></div></>}
            {infoTab === 'venues' && <><div className="editor-head"><div><span className="eyebrow">UM LUGAR PARA CELEBRAR</span><h2>Local</h2><p>Compartilhe endereços e dicas para chegar.</p></div><label className="switch-label"><input type="checkbox" checked={draft.show_venues} onChange={e => changeDraft('show_venues', e.target.checked)} /><span className="switch" />Exibir na página pública</label></div><div className="editable-items">{draft.venues.map((item, i) => <div className="venue-editor-card" key={item.id ?? i}><div className="venue-editor-head"><span className="eyebrow">LOCAL {String(i + 1).padStart(2, '0')}</span><button className="icon-button" aria-label="Mover acima" disabled={i === 0} onClick={() => reorder('venues', i, i - 1)}>↑</button><button className="icon-button" aria-label="Mover abaixo" disabled={i === draft.venues.length - 1} onClick={() => reorder('venues', i, i + 1)}>↓</button><button className="icon-button" onClick={() => changeDraft('venues', draft.venues.filter((_, index) => index !== i))}><Trash2 size={15} /></button></div><div className="form-row"><label>Nome do local<input value={item.name} onChange={e => updateVenue(i, { name: e.target.value })} placeholder="Nome do espaço" /></label><label>Tipo<select value={item.type} onChange={e => updateVenue(i, { type: e.target.value })}><option>Cerimônia</option><option>Recepção</option><option>Celebração</option><option>Outro</option></select></label></div><label>Endereço<input value={item.address} onChange={e => updateVenue(i, { address: e.target.value })} placeholder="Rua, número, bairro e cidade" /></label><div className="form-row"><label>Link do mapa<input value={item.map_url} onChange={e => updateVenue(i, { map_url: e.target.value })} placeholder="https://maps.google.com/…" /></label><label>Observações<input value={item.notes} onChange={e => updateVenue(i, { notes: e.target.value })} placeholder="Estacionamento, acessibilidade…" /></label></div><label className="switch-label inline-switch"><input type="checkbox" checked={item.visible} onChange={e => updateVenue(i, { visible: e.target.checked })} /><span className="switch" />Visível</label></div>)}<button className="add-row" onClick={() => changeDraft('venues', [...draft.venues, { id: makeId(), name: '', address: '', map_url: '', notes: '', type: 'Cerimônia', visible: true }])}><Plus size={15} /> Adicionar local</button></div></>}
            {infoTab === 'announcements' && <><div className="editor-head"><div><span className="eyebrow">UM CARINHO A MAIS</span><h2>Avisos</h2><p>Deixe informações importantes para os convidados.</p></div><label className="switch-label"><input type="checkbox" checked={draft.show_announcements} onChange={e => changeDraft('show_announcements', e.target.checked)} /><span className="switch" />Exibir na página pública</label></div><div className="editable-items">{draft.announcements.map((item, i) => <div className="venue-editor-card" key={item.id ?? i}><div className="venue-editor-head"><span className="eyebrow">AVISO {String(i + 1).padStart(2, '0')}</span><button className="icon-button" aria-label="Mover acima" disabled={i === 0} onClick={() => reorder('announcements', i, i - 1)}>↑</button><button className="icon-button" aria-label="Mover abaixo" disabled={i === draft.announcements.length - 1} onClick={() => reorder('announcements', i, i + 1)}>↓</button><button className="icon-button" onClick={() => changeDraft('announcements', draft.announcements.filter((_, index) => index !== i))}><Trash2 size={15} /></button></div><label>Título<input value={item.title} onChange={e => updateAnnouncement(i, { title: e.target.value })} placeholder="Título do aviso" /></label><label>Texto<textarea maxLength={800} value={item.body} onChange={e => updateAnnouncement(i, { body: e.target.value })} placeholder="Escreva um aviso carinhoso" /></label><div className="form-row"><label>Ocultar depois de<input type="date" value={item.expires_at} onChange={e => updateAnnouncement(i, { expires_at: e.target.value })} /></label><label className="switch-label"><input type="checkbox" checked={item.pinned} onChange={e => updateAnnouncement(i, { pinned: e.target.checked })} /><span className="switch" />Fixar aviso</label></div><label className="switch-label inline-switch"><input type="checkbox" checked={item.visible} onChange={e => updateAnnouncement(i, { visible: e.target.checked })} /><span className="switch" />Visível</label></div>)}<button className="add-row" onClick={() => changeDraft('announcements', [...draft.announcements, { id: makeId(), title: '', body: '', pinned: false, visible: true, expires_at: '' }])}><Plus size={15} /> Adicionar aviso</button></div></>}
            <div className="version-history"><label>Restaurar versão anterior<select defaultValue="" onChange={e => { const version = data.versions[Number(e.target.value)]; if (version) { setDraft(version.settings); setDirty(true); toast('Versão carregada no rascunho. Publique para aplicar.'); e.target.value = '' } }}><option value="" disabled>{data.versions.length ? 'Escolha uma publicação' : 'Nenhuma versão anterior'}</option>{data.versions.map((version, i) => <option key={`${version.created_at}-${i}`} value={i}>{new Date(version.created_at).toLocaleString('pt-BR')}</option>)}</select></label></div><div className="editor-footer"><span><ShieldCheck size={15} /> Textos exibidos como texto puro, sem HTML.</span><div><button className="button button--ghost" onClick={() => { setDraft(published); setDirty(true); toast('Rascunho restaurado da última publicação. Salve ou publique para aplicar.') }}>Restaurar versão publicada</button><button className="button button--ghost" disabled={busy} onClick={() => void saveDraft(false)}>Salvar rascunho</button><button className="button button--primary" disabled={busy} onClick={() => void saveDraft(true)}><Sparkles size={15} /> Publicar informações</button></div></div>
          </article>
        </>}
        {section === 'settings' && <>
          <div className="page-title-row"><div><span className="eyebrow">AJUSTES DO CASAL</span><h1>Configurações.</h1><p>Prazo de confirmação, dados do convite e mensagem de WhatsApp.</p></div></div>
          <article className="panel settings-panel"><div className="editor-head"><div><span className="eyebrow">DADOS DO CONVITE</span><h2>As informações essenciais</h2></div><span className="settings-lock"><ShieldCheck size={15} /> Publicar atualiza o convite</span></div><div className="settings-form"><div className="form-row"><label>Nome do casal<input value={draft.couple_names} onChange={e => changeDraft('couple_names', e.target.value)} /></label><label>Data do casamento<input type="date" value={draft.wedding_date} onChange={e => changeDraft('wedding_date', e.target.value)} /></label></div><div className="form-row"><label>Horário<input type="time" value={draft.wedding_time} onChange={e => changeDraft('wedding_time', e.target.value)} /></label><label>Prazo para confirmar<input type="date" value={draft.rsvp_deadline} onChange={e => changeDraft('rsvp_deadline', e.target.value)} /></label></div><div className="form-row"><label>Versículo da página pública<input value={draft.bible_verse_text} onChange={e => changeDraft('bible_verse_text', e.target.value)} /></label><label>Referência<input value={draft.bible_verse_ref} onChange={e => changeDraft('bible_verse_ref', e.target.value)} /></label></div><label>Modelo de mensagem para WhatsApp<textarea rows={5} value={draft.rsvp_message_template} onChange={e => changeDraft('rsvp_message_template', e.target.value)} /><small className="field-help">Variáveis disponíveis: {'{nome}'}, {'{link}'}, {'{prazo}'}, {'{noivos}'}. A mensagem não menciona quem convidou a pessoa.</small></label></div><div className="editor-footer"><span><ShieldCheck size={15} /> Configurações sincronizadas entre os noivos.</span><button className="button button--primary" disabled={busy} onClick={() => void saveDraft(true)}><Check size={15} /> Salvar configurações</button></div></article>
          <article className="panel settings-panel"><div className="editor-head"><div><span className="eyebrow">SUA CONTA</span><h2>Alterar senha</h2><p>Somente a senha de {sideName} será alterada.</p></div></div><form className="settings-form" onSubmit={changePassword}><div className="form-row"><label>Nova senha<input type="password" minLength={12} required autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Pelo menos 12 caracteres" /></label><label>Confirme a nova senha<input type="password" minLength={12} required autoComplete="new-password" value={passwordConfirm} onChange={e => setPasswordConfirm(e.target.value)} /></label></div><button disabled={busy} className="button button--primary">Alterar minha senha</button></form></article><article className="privacy-card"><div><ShieldCheck size={18} /><span><strong>Privacidade dos convidados</strong><small>Telefones, lista de nomes e recados nunca aparecem na página pública. A busca de convites acontece por uma função segura.</small></span></div><span className={supabase ? 'backend-badge is-live' : 'backend-badge'}><i />{supabase ? 'Conexão segura' : 'Conexão indisponível'}</span></article>
        </>}
        {section === 'history' && <>
          <div className="page-title-row"><div><span className="eyebrow">CUIDADO EM CADA ETAPA</span><h1>Um histórico com carinho.</h1><p>As mudanças importantes ficam registradas para vocês acompanharem juntos.</p></div><span className="history-filter"><select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">Todas as atividades</option><option value="Luciene">Luciene</option><option value="Mauricio">Mauricio</option><option value="Convidado via página pública">Página pública</option></select><ChevronDown size={14} /></span></div>
          <div className="history-tools"><label>Ação<select value={historyAction} onChange={e => setHistoryAction(e.target.value)}><option value="all">Todas as ações</option>{[...new Set(data.audit.map(item => item.action))].map(action => <option key={action}>{action}</option>)}</select></label><label>Convidado<input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar nome" /></label><label>De<input type="date" value={historyFrom} onChange={e => setHistoryFrom(e.target.value)} /></label><label>Até<input type="date" value={historyTo} onChange={e => setHistoryTo(e.target.value)} /></label></div><article className="panel history-panel"><div className="history-date"><span>ATIVIDADE RECENTE</span><span className="history-line" /></div>{filteredHistory.map((item) => <div className="history-item" key={item.id}><span className={`history-marker ${item.actor.includes('pública') ? 'is-public' : ''}`}>{item.actor.includes('pública') ? <Heart size={13} /> : <Leaf size={13} />}</span><div><p><strong>{item.actor}</strong> {item.action} {item.guest && <><span className="history-guest">“{item.guest}”</span></>}</p><small>{item.details}</small>{item.before && item.after && <details className="audit-details"><summary>Ver alterações</summary><dl>{Object.keys(item.after).filter(key => !['message', 'phone', 'notes', 'updated_at'].includes(key) && JSON.stringify(item.before?.[key]) !== JSON.stringify(item.after?.[key])).map(key => <div key={key}><dt>{auditLabel(key)}</dt><dd>{auditValue(item.before?.[key])} → {auditValue(item.after?.[key])}</dd></div>)}</dl></details>}</div><time>{timeAgo(item.created_at)}</time></div>)}{!filteredHistory.length && <div className="table-empty"><span>✳</span><strong>Seu histórico começa aqui.</strong></div>}<div className="history-immutable"><ShieldCheck size={15} /> Registro de auditoria · somente leitura</div></article>
        </>}
      </main>
    </div>
    {showPreview && <DraftPreview settings={draft} mobile={previewMobile} onMobile={() => setPreviewMobile(!previewMobile)} onClose={() => setShowPreview(false)} />}
    {showImport && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Importar convidados"><div className="guest-modal"><div className="modal-head"><div><span className="eyebrow">SUA LISTA · {sideName.toUpperCase()}</span><h2>Importar convidados</h2></div><button className="icon-button" aria-label="Fechar" onClick={() => setShowImport(false)}><X size={19} /></button></div><p>Cole um nome por linha ou importe um CSV com as colunas Nome, WhatsApp e Nome alternativo. Nomes já cadastrados serão ignorados.</p><label>Arquivo CSV<input type="file" accept=".csv,text/csv" onChange={e => { const file = e.target.files?.[0]; if (file) void file.text().then(setImportText).catch(error => toast(errorText(error))) }} /></label><label>Nomes ou conteúdo do CSV<textarea rows={10} maxLength={100000} value={importText} onChange={e => setImportText(e.target.value)} placeholder="Um nome completo por linha" /></label><div className="modal-actions"><button className="button button--ghost" onClick={() => setShowImport(false)}>Cancelar</button><button className="button button--primary" disabled={busy || !importText.trim()} onClick={() => void importRows()}>{busy ? 'Importando…' : 'Importar convidados'}</button></div></div></div>}
    {modal && <GuestModal guest={modal === 'new' ? undefined : modal} side={profile.side} onClose={() => setModal(null)} onSave={saveGuest} />}
  </div>
}

function LoginScreen({ onSignIn, onActivate, error }: { onActivate: (email: string, password: string, code: string) => Promise<void>; onSignIn: (email: string, password: string) => Promise<void>; error: string }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [activation, setActivation] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); try { if (activation) await onActivate(email, password, code); else await onSignIn(email, password) } finally { setBusy(false) } }
  return <div className="login-screen"><div className="login-art"><OliveBranch className="login-branch login-branch--one" /><OliveBranch className="login-branch login-branch--two" /><BrandMark /><span className="eyebrow">UM NOVO CAPÍTULO COMEÇA AQUI</span><h1>Luciene <i>&</i><br />Mauricio</h1><p>Um cantinho reservado para preparar<br />cada detalhe com amor.</p><span className="login-art-caption">✳ · COM CARINHO, SEMPRE · ✳</span></div><div className="login-form-wrap"><div className="login-form-inner"><a href={publicUrl()} className="back-public"><ArrowLeft size={15} /> Voltar ao convite</a><span className="eyebrow">ÁREA PRIVADA</span><h2>{activation ? 'Prepare o seu acesso.' : 'Bem-vindos de volta.'}</h2><p>{activation ? 'Use seu código privado para criar a conta de Luciene ou Mauricio.' : 'Entrem para cuidar dos detalhes do grande dia.'}</p>{supabase ? <form onSubmit={submit} className="login-form">{activation && <label>Código privado de ativação<input required autoComplete="off" value={code} onChange={e => setCode(e.target.value)} placeholder="Código entregue aos noivos" /></label>}<label>E-mail<input type="email" required autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} placeholder="seu@email.com" /></label><label>Senha<input type="password" required minLength={activation ? 12 : undefined} autoComplete={activation ? "new-password" : "current-password"} value={password} onChange={e => setPassword(e.target.value)} placeholder="Sua senha" /></label>{error && <div className="form-notice">{error}</div>}<button className="button button--primary" disabled={busy}>{busy ? 'Aguarde…' : activation ? 'Ativar meu acesso' : 'Entrar no painel'} <ArrowRight size={15} /></button><button className="text-button" type="button" disabled={busy} onClick={() => setActivation(!activation)}>{activation ? 'Já tenho acesso — entrar' : 'Primeiro acesso? Ativar minha conta'}</button></form> : <p className="form-notice" role="alert">O acesso está temporariamente indisponível. Tente novamente mais tarde.</p>}<div className="login-privacy"><ShieldCheck size={15} /> Área protegida · somente para os noivos</div></div></div></div>
}

function App() {
  const [data, setData] = useState<DemoData>(emptyData)
  const [published, setPublished] = useState<WeddingSettings>(DEFAULT_SETTINGS)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [publicLoaded, setPublicLoaded] = useState(false)
  const [loginError, setLoginError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [publicError, setPublicError] = useState('')
  const [isAdminRoute, setIsAdminRoute] = useState(isPanel)
  const [toastState, setToastState] = useState<{ message: string; undo?: () => void } | null>(null)
  const toast = useCallback((message: string, undo?: () => void) => { setToastState({ message, undo }); window.setTimeout(() => setToastState(current => current?.message === message ? null : current), 8000) }, [])
  const remoteRequest = useRef(0)

  const loadRemote = useCallback(async () => {
    if (!supabase) throw new Error('A conexão do site ainda não está configurada.')
    const request = ++remoteRequest.current
    const [guests, settingsResult, audit, messages] = await Promise.all([
      readAllRows<Guest>((from, to) => supabase!.from('guests').select(GUEST_COLUMNS).order('created_at', { ascending: false }).order('id').range(from, to)),
      supabase.from('wedding_settings').select('draft,published,versions').eq('singleton', true).single(),
      readAllRows((from, to) => supabase!.from('audit_log').select('id,created_at,actor_type,action,guest_name,details,before_row,after_row').order('created_at', { ascending: false }).order('id').range(from, to)),
      readAllRows<GuestMessage>((from, to) => supabase!.rpc('get_messages').order('confirmed_at', { ascending: false, nullsFirst: false }).order('guest_id').range(from, to)),
    ])
    if (settingsResult.error) throw settingsResult.error
    if (request !== remoteRequest.current) return
    const nextSettings = hydrateSettings(settingsResult.data?.draft)
    const nextAudit: AuditEntry[] = audit.map(item => ({ id: item.id, created_at: item.created_at, actor: item.actor_type === 'guest' ? 'Convidado via página pública' : item.actor_type === 'luciene' ? 'Luciene' : item.actor_type === 'mauricio' ? 'Mauricio' : item.actor_type, action: item.action, guest: item.guest_name ?? '', details: typeof item.details === 'string' ? item.details : '', before: item.before_row, after: item.after_row }))
    setData({ guests, settings: nextSettings, audit: nextAudit, messages, versions: (settingsResult.data?.versions ?? []).map((version: { published: WeddingSettings; created_at: string }) => ({ settings: hydrateSettings(version.published), created_at: version.created_at })) })
    setPublished(hydrateSettings(settingsResult.data?.published))
    setLoadError('')
    setPublicError('')
  }, [])

  useEffect(() => {
    const pop = () => setIsAdminRoute(isPanel())
    window.addEventListener('popstate', pop)
    return () => window.removeEventListener('popstate', pop)
  }, [])

  useEffect(() => {
    if (isAdminRoute) return
    let mounted = true
    const publicController = new AbortController()
    setPublicLoaded(false); setPublicError('')
    publicPost<Partial<WeddingSettings>>('rest/v1/rpc/get_public_wedding', {}, { signal: publicController.signal }).then(settings => {
      if (!mounted) return
      setPublished(hydrateSettings(settings))
      setPublicLoaded(true)
    }).catch(error => { if (mounted) { setPublicError(errorText(error)); setPublicLoaded(true) } })
    return () => { mounted = false; publicController.abort() }
  }, [isAdminRoute])

  useEffect(() => {
    if (!isAdminRoute) { setAuthChecked(false); setProfile(null); setData(emptyData()); return }
    if (!supabase) { setLoginError('A conexão do painel está indisponível. Tente novamente mais tarde.'); setAuthChecked(true); return }
    let mounted = true
    setAuthChecked(false)
    supabase.auth.getSession().then(async ({ data: sessionData, error }) => {
      try {
        if (!mounted) return
        if (error) throw error
        if (sessionData.session?.user) {
          const { data: row, error: profileError } = await supabase!.from('profiles').select('id,name,side').eq('id', sessionData.session.user.id).single()
          if (!mounted) return
          if (profileError || !row) throw new Error('Sua conta não tem acesso ao painel dos noivos.')
          await loadRemote()
          if (mounted) setProfile(row as Profile)
        }
      } catch (error) { if (mounted) setLoginError(errorText(error)) }
      finally { if (mounted) setAuthChecked(true) }
    }).catch(error => { if (mounted) { setLoginError(errorText(error)); setAuthChecked(true) } })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => { if (!session && mounted) { remoteRequest.current++; setProfile(null); setData(emptyData()) } })
    return () => { mounted = false; remoteRequest.current++; listener.subscription.unsubscribe() }
  }, [isAdminRoute, loadRemote])

  useEffect(() => {
    if (!profile || !isAdminRoute) return
    const refresh = () => { if (document.visibilityState === 'visible') void loadRemote().catch(error => setLoadError(errorText(error))) }
    const interval = window.setInterval(refresh, 30000)
    window.addEventListener('focus', refresh)
    return () => { clearInterval(interval); window.removeEventListener('focus', refresh) }
  }, [profile, isAdminRoute, loadRemote])

  async function signIn(email: string, password: string) {
    setLoginError('')
    try {
      if (!supabase) throw new Error('O login está temporariamente indisponível.')
      const result = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (result.error) throw new Error('E-mail ou senha não conferem.')
      const { data: profileData, error } = await supabase.from('profiles').select('id,name,side').eq('id', result.data.user.id).single()
      if (error || !profileData) { await supabase.auth.signOut(); throw new Error('Este usuário não está configurado como um dos noivos.') }
      await loadRemote(); setProfile(profileData as Profile); navigate(true)
    } catch (error) { setLoginError(errorText(error)) }
  }
  async function logout() { try { if (supabase) { const { error } = await supabase.auth.signOut(); if (error) throw error }; setProfile(null); setData(emptyData()); navigate(true) } catch (error) { toast(errorText(error)) } }
  async function mutate(operation: PromiseLike<{ error: unknown }>) { const result = await operation; if (result.error) throw result.error; try { await loadRemote() } catch { setLoadError('A alteração foi salva, mas não foi possível atualizar o painel. Tente atualizar os dados.') } }
  const client = () => { if (!supabase) throw new Error('A conexão está indisponível.'); return supabase }
  const editableGuest = (guest: Guest) => ({ id: guest.id, full_name: guest.full_name.trim(), alt_name: guest.alt_name.trim(), phone: normalizePhone(guest.phone), side: profile?.side, status: guest.status, confirmed_at: guest.confirmed_at, notes: guest.notes, deleted_at: guest.deleted_at, deleted_by: guest.deleted_by })
  const persistGuest = async (guest: Guest) => { await mutate(client().from('guests').upsert(editableGuest(guest)).select('id').single()) }
  const importGuests = async (guests: Guest[]) => { await mutate(client().from('guests').insert(guests.map(editableGuest)).select('id')) }
  const deleteGuest = async (guest: Guest) => { await mutate(client().from('guests').update({ deleted_at: guest.deleted_at, deleted_by: profile?.id }).eq('id', guest.id).select().single()) }
  const permanentDelete = async (guest: Guest) => { await mutate(client().from('guests').delete().eq('id', guest.id).select().single()) }
  const markReminder = async (guest: Guest) => { await mutate(client().from('guests').update({ last_reminder_at: new Date().toISOString(), reminder_count: guest.reminder_count + 1 }).eq('id', guest.id).select().single()) }
  const saveSettings = async (draft: WeddingSettings, publish: boolean) => { await mutate(client().from('wedding_settings').update(publish ? { draft, published: draft } : { draft }).eq('singleton', true).select().single()) }
  const setMessageFlags = async (message: GuestMessage, read: boolean, favorite: boolean) => { await mutate(client().rpc('set_message_flags', { p_guest_id: message.guest_id, p_read: read, p_favorite: favorite })) }

  async function invokePublic(body: Record<string, unknown>, signal?: AbortSignal) {
    return publicPost<{ ok?: boolean; ambiguous?: boolean; guest?: { id: string; full_name: string; status: Status }; token?: string }>('functions/v1/public-rsvp', body, {
      signal,
      timeoutMs: body.action === 'activate' ? 30000 : 15000,
      timeoutMessage: body.action === 'answer'
        ? 'O servidor demorou para responder. Busque seu nome novamente para conferir se a resposta foi registrada.'
        : body.action === 'activate'
          ? 'O servidor demorou para responder. Tente entrar com o e-mail e a senha escolhidos para conferir se a conta foi ativada.'
          : 'A busca demorou mais que o esperado. Confira sua conexão e tente novamente.',
    })
  }
  const lookupGuest = async (name: string, last4: string, keyword: string, signal: AbortSignal) => {
    const result = await invokePublic({ action: 'lookup', name: name.trim(), last4, keyword: keyword.trim() }, signal)
    if (result?.ambiguous) return { ambiguous: true as const }
    return result?.guest && result?.token ? { guest: result.guest, token: result.token } : null
  }
  const answerGuest = async (token: string, _guestId: string, status: Status, message: string | null, keyword: string) => { const result = await invokePublic({ action: 'answer', token, status, message, keyword: keyword.trim() }); if (!result?.ok) throw new Error('A resposta não foi registrada. Tente novamente.') }

  if ((!authChecked && isAdminRoute) || (!isAdminRoute && !publicLoaded)) return <div className="loading-screen"><BrandMark /><span>Preparando o seu espaço…</span></div>
  if (isAdminRoute && !profile) return <LoginScreen onSignIn={signIn} onActivate={async (email, password, code) => { setLoginError(''); try { await invokePublic({ action: 'activate', email: email.trim(), password, code: code.trim() }); await signIn(email, password) } catch (error) { setLoginError(errorText(error)) } }} error={loginError || loadError} />
  if (!isAdminRoute && publicError) return <div className="loading-screen"><BrandMark /><p role="alert">{publicError}</p><button className="button button--primary" onClick={() => location.reload()}>Tentar novamente</button><button className="text-button" onClick={() => navigate(true)}>Acesso dos noivos</button></div>
  return <>
    {isAdminRoute && profile ? <><AdminShell profile={profile} signOut={() => void logout()} data={data} published={published} persistGuest={persistGuest} importGuests={importGuests} saveSettings={saveSettings} deleteGuest={deleteGuest} permanentDelete={permanentDelete} markReminder={markReminder} setMessageFlags={setMessageFlags} toast={toast} />{loadError && <div className="toast" role="alert">{loadError}<button onClick={() => void loadRemote().catch(error => toast(errorText(error)))}>Tentar novamente</button></div>}</> : <PublicPage settings={published} onEnterAdmin={() => navigate(true)} lookupGuest={lookupGuest} answerGuest={answerGuest} />}
    {toastState && <div className="toast" role="status"><span className="toast-icon"><Check size={14} /></span>{toastState.message}{toastState.undo && <button onClick={() => { const undo = toastState.undo; setToastState(null); undo?.() }}>Desfazer</button>}<button className="toast-close" aria-label="Fechar" onClick={() => setToastState(null)}><X size={15} /></button></div>}
  </>
}

function downloadBlob(filename: string, data: string, type: string) { const blob = new Blob([data], { type }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url) }
async function exportMessagesPdf(guests: Pick<Guest, 'full_name' | 'message'>[]) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF(); doc.setTextColor(74, 86, 40); doc.setFont('times', 'italic'); doc.setFontSize(24); doc.text('L & M · Recados especiais', 18, 23); doc.setDrawColor(198, 168, 91); doc.line(18, 30, 192, 30)
  let y = 43
  guests.forEach(g => {
    if (y > 245) { doc.addPage(); y = 22 }
    doc.setFont('times', 'bold'); doc.setFontSize(12)
    const nameLines: string[] = doc.splitTextToSize(g.full_name, 168)
    doc.text(nameLines, 18, y); y += nameLines.length * 6 + 3
    doc.setFont('times', 'italic'); doc.setFontSize(11)
    const lines: string[] = doc.splitTextToSize(`“${g.message}”`, 168)
    lines.forEach(line => { if (y > 274) { doc.addPage(); y = 22 }; doc.text(line, 18, y); y += 6 })
    y += 8
  })
  doc.save('recados-favoritos-luciene-mauricio.pdf')
}

export default App
