import { Leaf } from 'lucide-react'

export const publicUrl = () => new URL(import.meta.env.BASE_URL, location.origin).href
export const navigate = (admin: boolean) => { history.pushState({}, '', `${import.meta.env.BASE_URL}${admin ? '?painel=1' : ''}`); window.dispatchEvent(new PopStateEvent('popstate')); window.scrollTo(0, 0) }
export const isPanel = () => location.pathname.includes('/admin') || new URLSearchParams(location.search).get('painel') === '1'

export function BrandMark({ small = false }: { small?: boolean }) {
  return <div className={`brand-mark ${small ? 'brand-mark--small' : ''}`} aria-label="Monograma Luciene e Mauricio">
    <span>L</span><i>&</i><span>M</span><Leaf size={small ? 14 : 18} strokeWidth={1.35} />
  </div>
}

export function OliveBranch({ className = '' }: { className?: string }) {
  return <svg className={`olive-branch ${className}`} viewBox="0 0 260 390" fill="none" aria-hidden="true">
    <path d="M20 360C94 289 129 205 145 31" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M72 302C31 302 15 278 18 259C50 258 72 271 72 302ZM93 259C137 251 152 224 143 207C111 213 92 231 93 259ZM112 208C70 200 55 175 66 158C98 166 115 184 112 208ZM130 152C169 140 182 111 169 96C139 107 125 128 130 152ZM139 101C105 88 97 62 112 48C139 60 150 81 139 101ZM52 321C39 279 15 270 2 281C13 309 31 324 52 321ZM158 57C184 41 185 19 169 9C149 28 145 45 158 57Z" fill="currentColor" opacity=".42" />
    <path d="M53 339C95 287 120 226 130 177" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity=".5" />
  </svg>
}

