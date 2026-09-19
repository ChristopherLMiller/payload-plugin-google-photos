'use client'

import { Banner, Button, Drawer, Pill, ShimmerEffect, Thumbnail, toast, useConfig, useModal } from '@payloadcms/ui'
import { useRouter } from 'next/navigation.js'
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

function labelText(label: unknown, fallback: string): string {
  return typeof label === 'string' && label.trim() ? label : fallback
}

function fieldTypeClass(type: PromptField['type']): string {
  if (type === 'textarea') {
    return 'field-type textarea'
  }
  if (type === 'checkbox') {
    return 'field-type checkbox'
  }
  if (type === 'number') {
    return 'field-type number'
  }
  return 'field-type text'
}

function PromptFieldControl({
  extraData,
  field,
  onChange,
}: {
  extraData: Record<string, unknown>
  field: PromptField
  onChange: (name: string, value: unknown) => void
}) {
  const id = `google-photos-field-${field.name}`
  const value = extraData[field.name]

  return (
    <div className={fieldTypeClass(field.type)}>
      {field.type === 'checkbox' ? (
        <label className={styles.checkboxRow} htmlFor={id}>
          <input
            aria-label={field.label}
            checked={Boolean(value)}
            id={id}
            onChange={(event) => onChange(field.name, event.target.checked)}
            type="checkbox"
          />
          <span className="field-label">
            {field.label}
            {field.required ? <span className="required">*</span> : null}
          </span>
        </label>
      ) : (
        <>
          <label className="field-label" htmlFor={id}>
            {field.label}
            {field.required ? <span className="required">*</span> : null}
          </label>
          <div className="field-type__wrap">
            {field.type === 'textarea' ? (
              <textarea
                aria-label={field.label}
                id={id}
                onChange={(event) => onChange(field.name, event.target.value)}
                required={field.required}
                value={String(fieldInputValue(value, field.type))}
              />
            ) : field.type === 'select' ? (
              <select
                aria-label={field.label}
                className={styles.nativeControl}
                id={id}
                onChange={(event) => onChange(field.name, event.target.value)}
                required={field.required}
                value={String(fieldInputValue(value, field.type))}
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
                id={id}
                onChange={(event) =>
                  onChange(
                    field.name,
                    field.type === 'number' ? Number(event.target.value) : event.target.value,
                  )
                }
                required={field.required}
                type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                value={String(fieldInputValue(value, field.type))}
              />
            )}
          </div>
        </>
      )}
    </div>
  )
}

export const ImportFromGooglePhotos = ({ collectionSlug }: ImportFromGooglePhotosProps) => {
  const { config, getEntityConfig } = useConfig()
  const { closeModal, isModalOpen, openModal } = useModal()
  const router = useRouter()
  const drawerSlug = `google-photos-import-${collectionSlug}`
  const apiBase = `${config.serverURL || ''}${config.routes.api}`
  const adminRoute = config.routes.admin || '/admin'
  const collectionConfig = getEntityConfig({ collectionSlug })
  const pluralLabel = labelText(collectionConfig?.labels?.plural, collectionSlug)
  const singularLabel = labelText(collectionConfig?.labels?.singular, collectionSlug)

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
            setError('Picker session timed out. Select from Google Photos again.')
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
  const waitingForPicker = Boolean(session && !session.mediaItemsSet)
  const hasPicked = Boolean(session?.mediaItems?.length)
  const loading = open && status === null && !error

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
          setError('Pop-up blocked. Use Open picker to continue in a new tab.')
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start a picker session')
    } finally {
      setBusy(false)
    }
  }

  const updateField = useCallback((name: string, value: unknown) => {
    setExtraData((current) => ({ ...current, [name]: value }))
  }, [])

  const closeDrawer = () => {
    if (importing) {
      return
    }
    closeModal(drawerSlug)
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
      `Saving ${count} ${pickedCount === 1 ? singularLabel : pluralLabel}. Keep this drawer open until it finishes.`,
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
      toast.success(`Created ${imported}, skipped ${skipped}, failed ${failed}`)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setBusy(false)
      setImporting(false)
    }
  }

  const pickerUrl = session?.pickerUri ? `${session.pickerUri}/autoclose` : null
  const saveLabel = importing
    ? 'Saving…'
    : pickedCount > 0
      ? `Save ${pickedCount} ${pickedCount === 1 ? singularLabel : pluralLabel}`
      : 'Save'

  return (
    <>
      <Button
        aria-label={`Import from Google Photos into ${pluralLabel}`}
        buttonStyle="pill"
        margin={false}
        onClick={() => openModal(drawerSlug)}
        size="small"
        type="button"
      >
        Import from Google Photos
      </Button>
      <Drawer slug={drawerSlug} title={`Creating new ${singularLabel}`}>
        <div className={styles.panel}>
          <div className={styles.body}>
            <div className={styles.meta}>
              <p className="field-description">
                Select files in Google Photos. Payload copies the originals into {pluralLabel} as
                normal uploads.
              </p>
              {status?.connected ? (
                <div className={styles.statusRow}>
                  <Pill pillStyle="light" size="small">
                    {status.googleEmail || 'Google Photos connected'}
                  </Pill>
                  <Button
                    buttonStyle="pill"
                    disabled={locked}
                    margin={false}
                    onClick={() => void disconnect()}
                    size="small"
                    type="button"
                  >
                    Disconnect
                  </Button>
                </div>
              ) : null}
            </div>

            {error ? <Banner type="error">{error}</Banner> : null}

            {importFields?.blockedFields?.length ? (
              <Banner type="error">
                These required fields cannot be filled here:{' '}
                {importFields.blockedFields.map((field) => `${field.label} (${field.type})`).join(', ')}
                . Add a collection defaultValue or a mapMediaData function before importing.
              </Banner>
            ) : null}

            {importing ? (
              <Banner type="success">
                <span className={styles.progressBusy}>
                  <span className={styles.spinner} />
                  Copying {pickedCount || 'selected'} original
                  {pickedCount === 1 ? '' : 's'} into {pluralLabel}. Keep this drawer open — this can
                  take a while for large photos or videos.
                </span>
              </Banner>
            ) : null}

            {loading ? <ShimmerEffect height="8rem" /> : null}

            {!loading && !hasPicked ? (
              <div className={`file-field ${styles.fileField}`}>
                <div className="file-field__upload">
                  <div className="dropzone">
                    <div className="file-field__dropzoneContent">
                      <div className="file-field__dropzoneButtons">
                        {!status?.connected ? (
                          <Button
                            buttonStyle="pill"
                            disabled={locked}
                            margin={false}
                            onClick={connect}
                            size="small"
                            type="button"
                          >
                            Connect Google Photos
                          </Button>
                        ) : (
                          <Button
                            buttonStyle="pill"
                            disabled={locked || Boolean(importFields?.blockedFields?.length)}
                            margin={false}
                            onClick={() => void launchPicker()}
                            size="small"
                            type="button"
                          >
                            {waitingForPicker ? 'Waiting for Google Photos…' : 'Select from Google Photos'}
                          </Button>
                        )}
                        {pickerUrl ? (
                          <>
                            <span className="file-field__orText">or</span>
                            <Button
                              buttonStyle="pill"
                              el="anchor"
                              margin={false}
                              newTab
                              size="small"
                              url={pickerUrl}
                            >
                              Open picker
                            </Button>
                          </>
                        ) : null}
                      </div>
                      <p className="file-field__dragAndDropText">
                        {waitingForPicker
                          ? 'finish picking in the Google Photos tab'
                          : status?.connected
                            ? 'opens in a new tab'
                            : 'connect your Google account to start'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {waitingForPicker ? (
              <p className={`${styles.inlineStatus} ${styles.progressBusy}`}>
                <span className={styles.spinner} />
                Waiting for you to finish picking in Google Photos. Leave this drawer open.
              </p>
            ) : null}

            {hasPicked ? (
              <div className={styles.files}>
                <div className={styles.filesHeader}>
                  <p className={styles.filesCount}>
                    <strong>
                      {pickedCount} {pickedCount === 1 ? 'file to upload' : 'files to upload'}
                    </strong>
                  </p>
                  <div className={styles.filesHeaderActions}>
                    <Button
                      buttonStyle="pill"
                      disabled={locked}
                      margin={false}
                      onClick={() => void launchPicker()}
                      size="small"
                      type="button"
                    >
                      Select from Google Photos
                    </Button>
                    {pickerUrl ? (
                      <Button
                        buttonStyle="pill"
                        el="anchor"
                        margin={false}
                        newTab
                        size="small"
                        url={pickerUrl}
                      >
                        Open picker
                      </Button>
                    ) : null}
                  </div>
                </div>
                {session?.mediaItems?.map((item) => (
                  <div className={`file-field ${styles.file}`} key={item.id}>
                    <div className="file-field__upload">
                      <div className="file-field__thumbnail-wrap">
                        <Thumbnail
                          fileSrc={item.thumbnailUrl || undefined}
                          size="small"
                        />
                      </div>
                      <div className="file-field__file-adjustments">
                        <input
                          aria-label={item.filename || item.id}
                          className="file-field__filename"
                          readOnly
                          title={item.filename || item.id}
                          type="text"
                          value={item.filename || item.id}
                        />
                        {item.mimeType ? (
                          <p className="field-description">{item.mimeType}</p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {hasPicked && importFields?.promptFields?.length ? (
              <form
                className={`render-fields ${styles.fields}`}
                onSubmit={(event) => event.preventDefault()}
              >
                <p className="field-description field-description--margin-bottom">
                  These values are applied once to every file in this batch, the same way collection
                  defaults work when creating {pluralLabel}.
                </p>
                {importFields.promptFields.map((field) => (
                  <PromptFieldControl
                    extraData={extraData}
                    field={field}
                    key={field.name}
                    onChange={updateField}
                  />
                ))}
              </form>
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

          <div className={styles.controls}>
            <Button
              buttonStyle="secondary"
              disabled={importing}
              margin={false}
              onClick={closeDrawer}
              type="button"
            >
              Cancel
            </Button>
            {results ? (
              <Button margin={false} onClick={closeDrawer} type="button">
                Done
              </Button>
            ) : (
              <Button
                disabled={locked || !canImport}
                margin={false}
                onClick={() => void runImport()}
                type="button"
              >
                {saveLabel}
              </Button>
            )}
          </div>
        </div>
      </Drawer>
    </>
  )
}
