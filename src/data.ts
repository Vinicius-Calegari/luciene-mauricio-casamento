/// <reference types="vite/client" />

export type Side = 'luciene' | 'mauricio'
export type Status = 'pending' | 'confirmed' | 'declined'
export type Guest = {
  id: string
  full_name: string
  alt_name: string
  side: Side
  phone: string
  status: Status
  confirmed_at: string | null
  notes: string
  message: string
  message_read: boolean
  message_favorite: boolean
  last_reminder_at: string | null
  reminder_count: number
  deleted_at: string | null
  deleted_by: string | null
  created_at: string
}
export type ScheduleItem = { id?: string; time: string; title: string; description: string; icon: string; visible: boolean }
export type Venue = { id?: string; name: string; address: string; map_url: string; notes: string; type: string; visible: boolean }
export type Announcement = { id?: string; title: string; body: string; pinned: boolean; visible: boolean; expires_at: string; published_at?: string }
export type WeddingSettings = {
  couple_names: string
  wedding_date: string
  wedding_time: string
  rsvp_deadline: string
  bible_verse_text: string
  bible_verse_ref: string
  rsvp_message_template: string
  show_schedule: boolean
  show_venues: boolean
  show_announcements: boolean
  schedule: ScheduleItem[]
  venues: Venue[]
  announcements: Announcement[]
}
export type AuditEntry = { id: string; created_at: string; actor: string; action: string; guest: string; details: string; before?: Record<string, unknown>; after?: Record<string, unknown> }
export type Profile = { id: string; name: string; side: Side }
export type GuestMessage = Pick<Guest, 'full_name' | 'side' | 'status' | 'message' | 'message_read' | 'message_favorite' | 'confirmed_at'> & { guest_id: string }
export type PublishedVersion = { created_at: string; settings: WeddingSettings }

export const DEFAULT_SETTINGS: WeddingSettings = {
  couple_names: 'Luciene & Mauricio',
  wedding_date: '',
  wedding_time: '',
  rsvp_deadline: '2026-11-30',
  bible_verse_text: 'O meu amado é meu, e eu sou dele.',
  bible_verse_ref: 'Cantares 2:16, ARC',
  rsvp_message_template: 'Oi, {nome}! Tudo bem? Estamos muito felizes em ter você no nosso casamento 💚 Ainda não recebemos a sua confirmação. Você pode confirmar por aqui até {prazo}: {link}. Com carinho, {noivos}',
  show_schedule: true,
  show_venues: true,
  show_announcements: true,
  schedule: [],
  venues: [],
  announcements: [],
}

export type DemoData = { guests: Guest[]; settings: WeddingSettings; audit: AuditEntry[]; messages: GuestMessage[]; versions: PublishedVersion[] }
export const emptyData = (): DemoData => ({ guests: [], settings: DEFAULT_SETTINGS, audit: [], messages: [], versions: [] })
export function hydrateSettings(value: Partial<WeddingSettings> | null): WeddingSettings {
  const settings = { ...DEFAULT_SETTINGS, ...(value ?? {}) }
  return { ...settings, schedule: (settings.schedule ?? []).map(item => ({ ...item, id: item.id || makeId() })), venues: (settings.venues ?? []).map(item => ({ ...item, id: item.id || makeId() })), announcements: (settings.announcements ?? []).map(item => ({ ...item, id: item.id || makeId() })) }
}
export function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, '')
  if (!digits) return ''
  const normalized = digits.length === 10 || digits.length === 11 ? `55${digits}` : digits
  if (!/^55[1-9]{2}(?:[2-9]\d{7}|9\d{8})$/.test(normalized)) throw new Error('Informe um telefone brasileiro válido com DDD, ou deixe o campo em branco.')
  return normalized
}
export function formatPhone(value: string): string {
  let digits = value.replace(/\D/g, '')
  if (digits.length > 11 && digits.startsWith('55')) digits = digits.slice(2)
  digits = digits.slice(0, 11)
  if (digits.length <= 2) return digits
  const number = digits.slice(2)
  const split = number.length > 8 ? 5 : 4
  return `(${digits.slice(0, 2)}) ${number.slice(0, split)}${number.length > split ? `-${number.slice(split)}` : ''}`
}

export const normalizeName = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR')
export const makeId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
export const brDate = (value?: string | null) => value ? new Date(value.length === 10 ? `${value}T12:00:00-03:00` : value).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' }) : 'Ainda não informado'
export const timeAgo = (value: string) => {
  const days = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86400000))
  if (days === 0) return 'hoje'
  if (days === 1) return 'há 1 dia'
  return `há ${days} dias`
}
export const displayStatus: Record<Status, string> = { confirmed: 'Confirmou', pending: 'Pendente', declined: 'Não poderá ir' }
