/// <reference types="vite/client" />

type PublicRequestOptions = {
  signal?: AbortSignal
  timeoutMs?: number
  timeoutMessage?: string
}

function abortError() {
  const error = new Error('A solicitação foi cancelada.')
  error.name = 'AbortError'
  return error
}

function connectionError() {
  return new Error(typeof navigator !== 'undefined' && navigator.onLine === false
    ? 'Você está sem conexão. Confira sua internet e tente novamente.'
    : 'Não foi possível conectar. Confira sua internet e tente novamente.')
}

export async function publicPost<T>(
  path: string,
  body: Record<string, unknown>,
  options: PublicRequestOptions = {},
): Promise<T> {
  const baseUrl = import.meta.env.VITE_SUPABASE_URL
  const apiKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!baseUrl || !apiKey) throw new Error('A conexão do site está indisponível. Tente novamente mais tarde.')
  if (options.signal?.aborted) throw abortError()

  const controller = new AbortController()
  let stoppedError: Error | undefined
  let rejectStopped!: (error: Error) => void
  const stopped = new Promise<never>((_resolve, reject) => { rejectStopped = reject })
  const stop = (error: Error) => {
    if (stoppedError) return
    stoppedError = error
    rejectStopped(error)
    controller.abort()
  }
  const onAbort = () => stop(abortError())
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs! > 0 ? options.timeoutMs! : 15000
  const timer = window.setTimeout(() => stop(new Error(options.timeoutMessage
    || 'A conexão demorou mais que o esperado. Confira sua internet e tente novamente.')), timeoutMs)
  options.signal?.addEventListener('abort', onAbort, { once: true })
  if (options.signal?.aborted) onAbort()

  const request = async () => {
    if (stoppedError) throw stoppedError
    let response: Response
    try {
      const isRsvp = path.replace(/^\/+/, '').split('?')[0] === 'functions/v1/public-rsvp'
      response = await fetch(`${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`, {
        method: 'POST',
        // A safelisted POST skips the extra cross-origin OPTIONS round trip.
        // The server still validates the app key, invitation phrase and guest token.
        headers: isRsvp ? { 'Content-Type': 'text/plain;charset=UTF-8' } : { apikey: apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(isRsvp ? { ...body, appKey: apiKey } : body),
        signal: controller.signal,
        credentials: 'omit',
        cache: 'no-store',
      })
    } catch {
      throw stoppedError || connectionError()
    }

    let result: unknown
    try {
      result = await response.json()
    } catch {
      if (stoppedError) throw stoppedError
      throw new Error(response.ok
        ? 'Não foi possível ler a resposta do site. Tente novamente.'
        : 'O serviço está temporariamente indisponível. Tente novamente em instantes.')
    }
    if (stoppedError) throw stoppedError
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new Error('O site recebeu uma resposta inválida. Tente novamente.')
    }
    const serverMessage = 'error' in result && typeof result.error === 'string' ? result.error.trim() : ''
    if (!response.ok || serverMessage) {
      throw new Error(serverMessage || (response.status === 429
        ? 'Foram feitas muitas tentativas. Aguarde alguns minutos e tente novamente.'
        : 'Não foi possível concluir agora. Tente novamente em instantes.'))
    }
    return result as T
  }

  try {
    // The deadline also covers a response body that never finishes downloading.
    return await Promise.race([request(), stopped])
  } finally {
    window.clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
  }
}
