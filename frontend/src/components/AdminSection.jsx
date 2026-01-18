import { useEffect, useState } from 'react'
import api from '../api'

const ADMIN_SESSION_KEY = 'imse_ms2_admin_authed'
// Frontend-only gate for the demo (NOT real security).
const ADMIN_ACCESS_CODE = 'imse-ms2'

function AdminSection({ onClose, onAfterMigrate, onAfterImportReset }) {
  const [accessCode, setAccessCode] = useState('')
  const [authError, setAuthError] = useState(null)
  const [isAuthed, setIsAuthed] = useState(false)

  const [healthStatus, setHealthStatus] = useState(null)
  const [importResult, setImportResult] = useState(null)
  const [migrateResult, setMigrateResult] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(function() {
    setIsAuthed(sessionStorage.getItem(ADMIN_SESSION_KEY) === '1')
  }, [])

  const handleLogin = (e) => {
    e.preventDefault()
    setAuthError(null)

    if ( accessCode.trim() !== ADMIN_ACCESS_CODE ) {
      setAuthError('Invalid access code.')
      return
    }

    sessionStorage.setItem(ADMIN_SESSION_KEY, '1')
    setIsAuthed(true)
    setAccessCode('')
  }

  const handleLogout = () => {
    sessionStorage.removeItem(ADMIN_SESSION_KEY)
    setIsAuthed(false)
    setAuthError(null)
    setHealthStatus(null)
    setImportResult(null)
    setMigrateResult(null)
  }

  const handleHealthCheck = async () => {
    setLoading(true)
    try {
      const response = await api.get('/health')
      setHealthStatus({ success: true, data: response.data })
    } catch (error) {
      setHealthStatus({ 
        success: false, 
        error: error.response?.data || { error: error.message } 
      })
    } finally {
      setLoading(false)
    }
  }

  const handleImportReset = async () => {
    setLoading(true)
    setImportResult(null)
    try {
      const response = await api.post('/import_reset')
      setImportResult({ success: true, data: response.data })
      if ( typeof onAfterImportReset === 'function' ) {
        await onAfterImportReset()
      }
    } catch (error) {
      setImportResult({ 
        success: false, 
        error: error.response?.data || { error: error.message } 
      })
    } finally {
      setLoading(false)
    }
  }

  const handleMigrate = async () => {
    setLoading(true)
    setMigrateResult(null)
    try {
      const response = await api.post('/migrate_to_mongo')
      setMigrateResult({ success: true, data: response.data })
      if ( typeof onAfterMigrate === 'function' ) {
        await onAfterMigrate()
      }
    } catch (error) {
      setMigrateResult({ 
        success: false, 
        error: error.response?.data || { error: error.message } 
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="modal-dialog modal-lg modal-dialog-scrollable" onClick={(e) => e.stopPropagation()}>
        <div className="modal-content">
          <div className="modal-header">
            <h2 className="modal-title">System Setup & Management</h2>
            <div className="d-flex gap-2">
              {isAuthed && (
                <button className="btn btn-outline-secondary btn-sm" onClick={handleLogout} type="button">
                  Lock
                </button>
              )}
              <button type="button" className="btn-close" onClick={onClose}></button>
            </div>
          </div>
          <div className="modal-body">
        {!isAuthed ? (
          <>
            <div className="alert alert-info mt-3" role="alert">
              Setup actions are protected. Enter the demo access code to continue.
            </div>

            <form onSubmit={handleLogin} className="mt-3" style={{ maxWidth: 420 }}>
              <label className="form-label">Access Code</label>
              <input
                className="form-control"
                type="password"
                value={accessCode}
                onChange={function(e) {
                  setAccessCode(e.target.value)
                }}
                placeholder="Enter access code"
                autoComplete="off"
                required
              />
              {authError && <div className="text-danger mt-2">{authError}</div>}
              <button className="btn btn-primary mt-3" type="submit">
                Unlock
              </button>
            </form>
          </>
        ) : (
          <>
        
            <div className="alert alert-warning mt-3" role="alert">
              <strong>First Time Setup:</strong> Click "Import & Reset Data" below to initialize the database before using the Order or Delivery features.
            </div>
        
            <div className="mb-4">
              <h3 className="h5">System Health Check</h3>
              <p className="text-muted small">Verify database connections and indexes.</p>
              <button className="btn btn-primary" onClick={handleHealthCheck} disabled={loading}>
                {loading ? 'Checking...' : 'Check Health'}
              </button>
              {healthStatus && (
                <div className={`alert mt-3 ${healthStatus.success ? 'alert-success' : 'alert-danger'}`}>
                  {healthStatus.success ? (
                    <>
                      <div>
                        System is healthy. Active mode: <strong>{healthStatus.data.activeMode || 'unknown'}</strong>
                      </div>
                      <pre className="mt-2 mb-0 small">{JSON.stringify(healthStatus.data, null, 2)}</pre>
                    </>
                  ) : (
                    <>
                      <div>Error: {healthStatus.error.error}</div>
                      {healthStatus.error.stack && (
                        <pre className="mt-2 mb-0 small">{healthStatus.error.stack}</pre>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="mb-4">
              <h3 className="h5">Data Import & Reset</h3>
              <p className="text-muted small">Generate fresh randomized data in MariaDB (replaces existing data).</p>
              <button className="btn btn-secondary" onClick={handleImportReset} disabled={loading}>
                {loading ? 'Importing...' : 'Import & Reset Data'}
              </button>
              {importResult && (
                <div className={`alert mt-3 ${importResult.success ? 'alert-success' : 'alert-danger'}`}>
                  {importResult.success ? (
                    <>
                      <div>Data imported successfully!</div>
                      <pre className="mt-2 mb-0 small">{JSON.stringify(importResult.data, null, 2)}</pre>
                    </>
                  ) : (
                    <>
                      <div>Error: {importResult.error.error}</div>
                      {importResult.error.stack && (
                        <pre className="mt-2 mb-0 small">{importResult.error.stack}</pre>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="mb-4">
              <h3 className="h5">Migration Tool</h3>
              <p className="text-muted small">Copy current SQL data to MongoDB (clears MongoDB first).</p>
              <button className="btn btn-success" onClick={handleMigrate} disabled={loading}>
                {loading ? 'Migrating...' : 'Migrate SQL → MongoDB'}
              </button>
              {migrateResult && (
                <div className={`alert mt-3 ${migrateResult.success ? 'alert-success' : 'alert-danger'}`}>
                  {migrateResult.success ? (
                    <>
                      <div>Migration completed successfully!</div>
                      <pre className="mt-2 mb-0 small">{JSON.stringify(migrateResult.data, null, 2)}</pre>
                    </>
                  ) : (
                    <>
                      <div>Error: {migrateResult.error.error}</div>
                      {migrateResult.error.stack && (
                        <pre className="mt-2 mb-0 small">{migrateResult.error.stack}</pre>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </>
        )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default AdminSection
