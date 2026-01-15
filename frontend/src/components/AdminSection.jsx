import { useEffect, useState } from 'react'
import api from '../api'

const ADMIN_SESSION_KEY = 'imse_ms2_admin_authed'
// Frontend-only gate for the demo (NOT real security).
const ADMIN_ACCESS_CODE = 'imse-ms2'

function AdminSection() {
  const [accessCode, setAccessCode] = useState('')
  const [authError, setAuthError] = useState(null)
  const [isAuthed, setIsAuthed] = useState(false)

  const [healthStatus, setHealthStatus] = useState(null)
  const [importResult, setImportResult] = useState(null)
  const [migrateResult, setMigrateResult] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setIsAuthed(sessionStorage.getItem(ADMIN_SESSION_KEY) === '1')
  }, [])

  const handleLogin = (e) => {
    e.preventDefault()
    setAuthError(null)

    if (accessCode.trim() !== ADMIN_ACCESS_CODE) {
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
    <div className="card mb-4">
      <div className="card-body">
        <div className="d-flex justify-content-between align-items-start gap-3">
          <h2 className="card-title mb-0">Admin / Setup</h2>
          {isAuthed && (
            <button className="btn btn-outline-secondary btn-sm" onClick={handleLogout} type="button">
              Logout
            </button>
          )}
        </div>

        {!isAuthed ? (
          <>
            <div className="alert alert-info mt-3" role="alert">
              Admin actions are gated for the demo. Enter the access code to continue.
            </div>

            <form onSubmit={handleLogin} className="mt-3" style={{ maxWidth: 420 }}>
              <label className="form-label">Admin access code</label>
              <input
                className="form-control"
                type="password"
                value={accessCode}
                onChange={(e) => setAccessCode(e.target.value)}
                placeholder="Enter access code"
                autoComplete="off"
                required
              />
              {authError && <div className="text-danger mt-2">{authError}</div>}
              <button className="btn btn-primary mt-3" type="submit">
                Login
              </button>
            </form>
          </>
        ) : (
          <>
        
            <div className="alert alert-warning mt-3" role="alert">
              <strong>First Time Setup:</strong> Click "Import & Reset Data" below to initialize the database before using Student 1 or Student 2 features.
            </div>
        
            <div className="mb-4">
              <h3 className="h5">Health Check</h3>
              <button className="btn btn-primary" onClick={handleHealthCheck} disabled={loading}>
                {loading ? 'Checking...' : 'Check Health'}
              </button>
              {healthStatus && (
                <div className={`alert mt-3 ${healthStatus.success ? 'alert-success' : 'alert-danger'}`}>
                  {healthStatus.success ? (
                    <div>{healthStatus.data.message || 'OK'}</div>
                  ) : (
                    <>
                      <div>Error: {healthStatus.error.error}</div>
                      {healthStatus.error.stack && (
                        <pre className="mt-2 mb-0">{healthStatus.error.stack}</pre>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="mb-4">
              <h3 className="h5">Import / Reset (MariaDB)</h3>
              <button className="btn btn-secondary" onClick={handleImportReset} disabled={loading}>
                {loading ? 'Importing...' : 'Import & Reset Data'}
              </button>
              {importResult && (
                <div className={`alert mt-3 ${importResult.success ? 'alert-success' : 'alert-danger'}`}>
                  {importResult.success ? (
                    <>
                      <div>Import successful!</div>
                      <pre className="mt-2 mb-0">{JSON.stringify(importResult.data, null, 2)}</pre>
                    </>
                  ) : (
                    <>
                      <div>Error: {importResult.error.error}</div>
                      {importResult.error.stack && (
                        <pre className="mt-2 mb-0">{importResult.error.stack}</pre>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="mb-4">
              <h3 className="h5">Migrate SQL -> Mongo</h3>
              <button className="btn btn-success" onClick={handleMigrate} disabled={loading}>
                {loading ? 'Migrating...' : 'Migrate to MongoDB'}
              </button>
              {migrateResult && (
                <div className={`alert mt-3 ${migrateResult.success ? 'alert-success' : 'alert-danger'}`}>
                  {migrateResult.success ? (
                    <>
                      <div>Migration successful!</div>
                      <pre className="mt-2 mb-0">{JSON.stringify(migrateResult.data, null, 2)}</pre>
                    </>
                  ) : (
                    <>
                      <div>Error: {migrateResult.error.error}</div>
                      {migrateResult.error.stack && (
                        <pre className="mt-2 mb-0">{migrateResult.error.stack}</pre>
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
  )
}

export default AdminSection
