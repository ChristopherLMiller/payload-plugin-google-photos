'use client'

import { Button, Drawer, toast, useConfig, useModal } from '@payloadcms/ui'
import { useCallback, useEffect, useMemo, useState } from 'react'

import type { BlockedField, ImportItemResult, PromptField, SessionMediaPreview } from '../types.js'

import styles from './ImportFromGooglePhotos.module.css'

type StatusResponse = {
  connected: boolean
  googleEmail?: null | string
}

type SessionResponse = {
  error?: string
  id: string
  mediaItems?: SessionMediaPreview[]
  mediaItemsSet?: boolean
  pickerUri?: string
  pollingConfig?: {
    pollInterval?: string
    timeoutIn?: string
  }
}

type ImportFieldsResponse = {
  blockedFields: BlockedField[]
  error?: string
  promptFields: PromptField[]
}

type ImportResponse = {
  blockedFields?: BlockedField[]
  error?: string
  promptFields?: PromptField[]
  results?: ImportItemResult[]
}

export type ImportFromGooglePhotosProps = {
  collectionSlug: string
}

function parseDurationMs(value?: string, fallback = 2000): number {
  if (!value) {
    return fallback
  }
  const match = value.match(/([\d.]+)s/)
  if (!match) {
    return fallback
  }
  return Math.max(500, Math.round(parseFloat(match[1]) * 1000))
}

function fieldInputValue(value: unknown, type: PromptField['type']): boolean | string {
  if (type === 'checkbox') {
    return Boolean(value)
  }
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value)
  }
  return ''
}

export const ImportFromGooglePhotos = ({ collectionSlug }: ImportFromGooglePhotosProps) => {
  const { config } = useConfig()
  const { closeModal, isModalOpen, openModal } = useModal()
  const drawerSlug = `google-photos-import-${collectionSlug}`
  const apiBase = `${config.serverURL || ''}${config.routes.api}`
  const adminRoute = config.routes.admin || '/admin'

  const [status, setStatus] = useState<null | StatusResponse>(null)
  const [importFields, setImportFields] = useState<ImportFieldsResponse | null>(null)
  const [extraData, setExtraData] = useState<Record<string, unknown>>({})
  const [session, setSession] = useState<null | SessionResponse>(null)
  const [busy, setBusy] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<null | string>(null)
  const [results, setResults] = useState<ImportItemResult[] | null>(null)

  const open = isModalOpen(drawerSlug)

  const currentReturnTo = useMemo(() => {
    if (typeof window === 'undefined') {
      return `${adminRoute}/collections/${collectionSlug}`
    }
    const url = new URL(window.location.href)
    url.searchParams.delete('googlePhotos')
    url.searchParams.delete('googlePhotosError')
    return `${url.pathname}${url.search}`
  }, [adminRoute, collectionSlug])

  const apiFetch = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const response = await fetch(`${apiBase}${path}`, {
        credentials: 'include',
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...(init?.headers || {}),
        },
      })
      const data = (await response.json().catch(() => ({}))) as { error?: string } & T
      if (!response.ok) {
        throw new Error(data.error || `Request failed (${response.status})`)
      }
      return data
    },
    [apiBase],
  )

  const loadStatusAndFields = useCallback(async () => {
    setError(null)
    try {
      const [nextStatus, nextFields] = await Promise.all([
        apiFetch<StatusResponse>('/google-photos/status'),
        apiFetch<ImportFieldsResponse>(
          `/google-photos/collections/${encodeURIComponent(collectionSlug)}/import-fields`,
        ),
      ])
      setStatus(nextStatus)
      setImportFields(nextFields)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Google Photos status')
    }
  }, [apiFetch, collectionSlug])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const params = new URLSearchParams(window.location.search)
    const flag = params.get('googlePhotos')
    if (flag === 'connected' || flag === 'error') {
      openModal(drawerSlug)
      if (flag === 'error') {
        setError(params.get('googlePhotosError') || 'Google Photos connection failed')
      }
      params.delete('googlePhotos')
      params.delete('googlePhotosError')
      const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}`
      window.history.replaceState({}, '', next)
    }
  }, [drawerSlug, openModal])

  useEffect(() => {
    if (open) {
      void loadStatusAndFields()
    }
  }, [loadStatusAndFields, open])

  useEffect(() => {
    if (!open || !session?.id || session.mediaItemsSet) {
      return
    }

    let cancelled = false
    let timeout: ReturnType<typeof setTimeout>

    const poll = async () => {
      try {
        const next = await apiFetch<SessionResponse>(
          `/google-photos/sessions/${encodeURIComponent(session.id)}`,
        )
        if (cancelled) {
          return
        }
        setSession(next)
        if (!next.mediaItemsSet) {
          const wait = parseDurationMs(next.pollingConfig?.pollInterval)
          const timeoutIn = parseDurationMs(next.pollingConfig?.timeoutIn, 0)
          if (timeoutIn === 0 && next.pollingConfig?.timeoutIn) {
            setError('Picker session timed out. Launch the picker again.')
            return
          }
          timeout = setTimeout(() => {
            void poll()
          }, wait)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to poll picker session')
        }
      }
    }

    timeout = setTimeout(() => {
      void poll()
    }, parseDurationMs(session.pollingConfig?.pollInterval))

    return () => {
      cancelled = true
      clearTimeout(timeout)
    }
  }, [apiFetch, open, session?.id, session?.mediaItemsSet, session?.pollingConfig?.pollInterval])

  useEffect(() => {
    if (!importing) {
      return
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [importing])

  const canImport =
    Boolean(session?.mediaItemsSet) &&
    (importFields?.promptFields || []).every((field) => {
      const value = extraData[field.name]
      if (field.type === 'checkbox') {
        return value === true
      }
      return typeof value === 'string' ? value.trim().length > 0 : Boolean(value)
    }) &&
    (importFields?.blockedFields.length || 0) === 0

  const pickedCount = session?.mediaItems?.length || 0
  const locked = busy || importing

  const connect = () => {
    const returnTo = encodeURIComponent(currentReturnTo)
    window.location.href = `${apiBase}/google-photos/oauth/start?returnTo=${returnTo}`
  }

  const disconnect = async () => {
    setBusy(true)
    setError(null)
    try {
      await apiFetch('/google-photos/oauth/disconnect', { method: 'POST' })
      setStatus({ connected: false })
      setSession(null)
      setResults(null)
      toast.success('Disconnected Google Photos')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect')
    } finally {
      setBusy(false)
    }
  }

  const launchPicker = async () => {
    setBusy(true)
    setError(null)
    setResults(null)
    try {
      const next = await apiFetch<SessionResponse>('/google-photos/sessions', { method: 'POST' })
      setSession(next)
      if (next.pickerUri) {
        const popup = window.open(`${next.pickerUri}/autoclose`, '_blank', 'noopener,noreferrer')
        if (!popup) {
          setError('Pop-up blocked. Use the picker link below.')
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start a picker session')
    } finally {
      setBusy(false)
    }
  }

  const runImport = async () => {
    if (!session?.id) {
      return
    }
    const count = pickedCount || 'selected'
    setImporting(true)
    setBusy(true)
    setError(null)
    toast.info(
      `Importing ${count} item${pickedCount === 1 ? '' : 's'} into ${collectionSlug}. Keep this drawer open until it finishes.`,
    )
    try {
      const payload = await apiFetch<ImportResponse>(
        `/google-photos/sessions/${encodeURIComponent(session.id)}/import`,
        {
          body: JSON.stringify({
            collection: collectionSlug,
            extraData,
          }),
          method: 'POST',
        },
      )
      setResults(payload.results || [])
      const imported = (payload.results || []).filter((item) => item.status === 'imported').length
      const skipped = (payload.results || []).filter((item) => item.status === 'skipped').length
      const failed = (payload.results || []).filter((item) => item.status === 'failed').length
      toast.success(`Imported ${imported}, skipped ${skipped}, failed ${failed}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setBusy(false)
      setImporting(false)
    }
  }

  return (
    <>
      <Button buttonStyle="secondary" onClick={() => openModal(drawerSlug)} size="small" type="button">
        Import from Google Photos
      </Button>
      <Drawer slug={drawerSlug} title="Import from Google Photos">
        <div className={styles.panel}>
          <div className={styles.header}>
            <p className={styles.message}>
              Pick photos in Google Photos. This plugin copies the original files into{' '}
              <strong>{collectionSlug}</strong> as normal Payload uploads.
            </p>
            {status?.connected ? (
              <div className={styles.statusRow}>
                <span>Connected as {status.googleEmail || 'Google user'}</span>
                <Button buttonStyle="pill" disabled={locked} onClick={() => void disconnect()} size="small">
                  Disconnect
                </Button>
              </div>
            ) : (
              <p className={styles.message}>Connect your Google account to start a picker session.</p>
            )}
          </div>

          {error ? <p className={styles.error}>{error}</p> : null}

          {importFields?.blockedFields?.length ? (
            <p className={styles.error}>
              These required fields cannot be filled in the import drawer:{' '}
              {importFields.blockedFields.map((field) => `${field.label} (${field.type})`).join(', ')}.
              Add a collection defaultValue or a mapMediaData function before importing.
            </p>
          ) : null}

          <div className={styles.actions}>
            {!status?.connected ? (
              <Button disabled={locked} onClick={connect} type="button">
                Connect Google Photos
              </Button>
            ) : (
              <Button disabled={locked || Boolean(importFields?.blockedFields?.length)} onClick={() => void launchPicker()}>
                Launch picker
              </Button>
            )}
            {session?.pickerUri ? (
              <Button
                buttonStyle="secondary"
                el="anchor"
                newTab
                url={`${session.pickerUri}/autoclose`}
              >
                Open picker tab
              </Button>
            ) : null}
          </div>

          {session && !session.mediaItemsSet ? (
            <p className={`${styles.progress} ${styles.progressBusy}`}>
              <span className={styles.spinner} />
              Waiting for you to finish picking in Google Photos. Leave this drawer open.
            </p>
          ) : null}

          {importing ? (
            <p aria-live="polite" className={`${styles.progress} ${styles.progressBusy}`}>
              <span className={styles.spinner} />
              Copying {pickedCount || 'selected'} original
              {pickedCount === 1 ? '' : 's'} into {collectionSlug}. Keep this drawer open — this can
              take a while for large photos or videos.
            </p>
          ) : null}

          {session?.mediaItems?.length ? (
            <div className={styles.grid}>
              {session.mediaItems.map((item) => (
                <div className={styles.card} key={item.id}>
                  {item.thumbnailUrl ? (
                    <img alt={item.filename || 'Picked photo'} className={styles.thumb} src={item.thumbnailUrl} />
                  ) : (
                    <div className={styles.placeholder}>{item.mimeType || 'media'}</div>
                  )}
                  <span className={styles.filename}>{item.filename || item.id}</span>
                </div>
              ))}
            </div>
          ) : null}

          {importFields?.promptFields?.length ? (
            <form className={styles.form} onSubmit={(event) => event.preventDefault()}>
              <p className={styles.message}>
                These values are applied once to every photo in this import batch.
              </p>
              {importFields.promptFields.map((field) => (
                <label className={styles.field} htmlFor={`google-photos-field-${field.name}`} key={field.name}>
                  {field.label}
                  {field.type === 'textarea' ? (
                    <textarea
                      aria-label={field.label}
                      id={`google-photos-field-${field.name}`}
                      onChange={(event) =>
                        setExtraData((current) => ({ ...current, [field.name]: event.target.value }))
                      }
                      required={field.required}
                      value={String(fieldInputValue(extraData[field.name], field.type))}
                    />
                  ) : field.type === 'checkbox' ? (
                    <input
                      aria-label={field.label}
                      checked={Boolean(extraData[field.name])}
                      id={`google-photos-field-${field.name}`}
                      onChange={(event) =>
                        setExtraData((current) => ({ ...current, [field.name]: event.target.checked }))
                      }
                      type="checkbox"
                    />
                  ) : field.type === 'select' ? (
                    <select
                      aria-label={field.label}
                      id={`google-photos-field-${field.name}`}
                      onChange={(event) =>
                        setExtraData((current) => ({ ...current, [field.name]: event.target.value }))
                      }
                      required={field.required}
                      value={String(fieldInputValue(extraData[field.name], field.type))}
                    >
                      <option value="">Select…</option>
                      {(field.options || []).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      aria-label={field.label}
                      id={`google-photos-field-${field.name}`}
                      onChange={(event) =>
                        setExtraData((current) => ({
                          ...current,
                          [field.name]:
                            field.type === 'number' ? Number(event.target.value) : event.target.value,
                        }))
                      }
                      required={field.required}
                      type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                      value={String(fieldInputValue(extraData[field.name], field.type))}
                    />
                  )}
                </label>
              ))}
            </form>
          ) : null}

          <div className={styles.actions}>
            <Button disabled={locked || !canImport || importing} onClick={() => void runImport()} type="button">
              {importing ? 'Importing…' : 'Import'}
            </Button>
            <Button
              buttonStyle="secondary"
              disabled={importing}
              onClick={() => closeModal(drawerSlug)}
              type="button"
            >
              {importing ? 'Importing…' : 'Close'}
            </Button>
          </div>
          {canImport && !importing && !results ? (
            <p className={styles.message}>
              Import copies original files into Payload. Keep this drawer open until the result list
              appears.
            </p>
          ) : null}

          {results ? (
            <ol className={styles.results}>
              {results.map((item) => (
                <li key={item.googlePhotosId}>
                  {item.filename || item.googlePhotosId}: {item.status}
                  {item.error ? ` — ${item.error}` : ''}
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      </Drawer>
    </>
  )
}
