import { Component, lazy, Suspense, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { DEFAULT_SETTINGS, hydrateSettings } from './data'
import type { Status, WeddingSettings } from './data'
import PublicPage from './PublicPage'
import { BrandMark, isPanel, navigate } from './sharedUi'
import { publicPost } from './publicApi'

const AdminApp = lazy(() => import('./AdminApp'))
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Não foi possível conectar. Confira sua internet e tente novamente.'
const Loading = () => <div className="loading-screen" role="status"><BrandMark /><span>Preparando o seu espaço…</span></div>

class AdminLoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) return <div className="loading-screen"><BrandMark /><p role="alert">Não foi possível abrir o painel. Confira sua conexão e atualize a página.</p><button className="button button--primary" onClick={() => location.reload()}>Atualizar página</button><button className="text-button" onClick={() => navigate(false)}>Voltar ao convite</button></div>
    return this.props.children
  }
}

export default function App() {
  const [isAdminRoute, setIsAdminRoute] = useState(isPanel)
  const [published, setPublished] = useState<WeddingSettings>(DEFAULT_SETTINGS)
  const [publicLoaded, setPublicLoaded] = useState(false)
  const [publicError, setPublicError] = useState('')

  useEffect(() => {
    const pop = () => setIsAdminRoute(isPanel())
    window.addEventListener('popstate', pop)
    return () => window.removeEventListener('popstate', pop)
  }, [])

  useEffect(() => {
    if (isAdminRoute) return
    let mounted = true
    const controller = new AbortController()
    setPublicLoaded(false); setPublicError('')
    publicPost<Partial<WeddingSettings>>('rest/v1/rpc/get_public_wedding', {}, { signal: controller.signal }).then(settings => {
      if (!mounted) return
      setPublished(hydrateSettings(settings)); setPublicLoaded(true)
    }).catch(error => { if (mounted) { setPublicError(errorText(error)); setPublicLoaded(true) } })
    return () => { mounted = false; controller.abort() }
  }, [isAdminRoute])

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


  if (isAdminRoute) return <AdminLoadBoundary><Suspense fallback={<Loading />}><AdminApp /></Suspense></AdminLoadBoundary>
  if (!publicLoaded) return <Loading />
  if (publicError) return <div className="loading-screen"><BrandMark /><p role="alert">{publicError}</p><button className="button button--primary" onClick={() => location.reload()}>Tentar novamente</button><button className="text-button" onClick={() => navigate(true)}>Acesso dos noivos</button></div>
  return <PublicPage settings={published} onEnterAdmin={() => navigate(true)} lookupGuest={lookupGuest} answerGuest={answerGuest} />
}
