import { useState, useEffect } from 'react'
import AdminSection from './components/AdminSection'
import Student1Section from './components/Student1Section'
import Student2Section from './components/Student2Section'
import api from './api'

function App() {
  const [activeRole, setActiveRole] = useState('customer')
  const [mode, setMode] = useState('sql') // derived from /api/health (switches after migration)
  const [systemStatus, setSystemStatus] = useState(null)
  const [actingCustomerEmail, setActingCustomerEmail] = useState('')
  const [actingRiderEmail, setActingRiderEmail] = useState('')
  const [customers, setCustomers] = useState([])
  const [riders, setRiders] = useState([])
  const [showAdminModal, setShowAdminModal] = useState(false)

  useEffect(function() {
    refreshSystemStatus()
    loadCustomers()
    loadRiders()
  }, [])



  const refreshSystemStatus = async () => {
    try {
      const response = await api.get('/health')
      setSystemStatus(response.data)
      
      if ( response.data?.activeMode === 'mongo' || response.data?.activeMode === 'sql' ) {
        setMode(response.data.activeMode)
      }
    } 
    catch (error) {
      // If health fails, keep the UI functional in SQL mode but show no status.
      console.error('Error loading system status:', error)
      setSystemStatus(null)
      setMode('sql')
    }
  }



  const loadCustomers = async () => {
    try {
      const response = await api.get('/customers')
      if ( response.data.customers ) {
        setCustomers(response.data.customers)
        
        if ( response.data.customers.length > 0 ) {
          setActingCustomerEmail(response.data.customers[0].email)
        }
      }
    } 
    catch (error) {
      console.error('Error loading customers:', error)
    }
  }



  const loadRiders = async () => {
    try {
      const response = await api.get('/riders')
      if ( response.data.riders ) {
        setRiders(response.data.riders)
        
        if ( response.data.riders.length > 0 ) {
          setActingRiderEmail(response.data.riders[0].email)
        }
      }
    } 
    catch (error) {
      console.error('Error loading riders:', error)
    }
  }



  return (
    <div className="container my-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h1 className="mb-0">Food Delivery System</h1>
        <button
          className="btn btn-outline-secondary"
          onClick={function() {
            setShowAdminModal(true)
          }}
          type="button"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="bi bi-gear-fill me-2" viewBox="0 0 16 16" style={{ verticalAlign: 'text-bottom' }}>
            <path d="M9.405 1.05c-.413-1.4-2.397-1.4-2.81 0l-.1.34a1.464 1.464 0 0 1-2.105.872l-.31-.17c-1.283-.698-2.686.705-1.987 1.987l.169.311c.446.82.023 1.841-.872 2.105l-.34.1c-1.4.413-1.4 2.397 0 2.81l.34.1a1.464 1.464 0 0 1 .872 2.105l-.17.31c-.698 1.283.705 2.686 1.987 1.987l.311-.169a1.464 1.464 0 0 1 2.105.872l.1.34c.413 1.4 2.397 1.4 2.81 0l.1-.34a1.464 1.464 0 0 1 2.105-.872l.31.17c1.283.698 2.686-.705 1.987-1.987l-.169-.311a1.464 1.464 0 0 1 .872-2.105l.34-.1c1.4-.413 1.4-2.397 0-2.81l-.34-.1a1.464 1.464 0 0 1-.872-2.105l.17-.31c.698-1.283-.705-2.686-1.987-1.987l-.311.169a1.464 1.464 0 0 1-2.105-.872l-.1-.34zM8 10.93a2.929 2.929 0 1 1 0-5.86 2.929 2.929 0 0 1 0 5.858z"/>
          </svg>
          Admin Setup
        </button>
      </div>

      <div className="card mb-4">
        <div className="card-body">
          <div className="row g-3">
            <div className="col-md-4">
              <label className="form-label fw-bold">We am a:</label>
              <div className="btn-group w-100" role="group">
                <button
                  type="button"
                  className={`btn ${activeRole === 'customer' ? 'btn-success' : 'btn-outline-success'}`}
                  onClick={function() {
                    setActiveRole('customer')
                  }}
                >
                  Customer
                </button>
                <button
                  type="button"
                  className={`btn ${activeRole === 'rider' ? 'btn-info' : 'btn-outline-info'}`}
                  onClick={function() {
                    setActiveRole('rider')
                  }}
                >
                  Rider
                </button>
              </div>
            </div>
            <div className="col-md-4">
              <label className="form-label fw-bold">Data Source</label>
              <div className="d-flex flex-column gap-1">
                <div>
                  <span className={`badge ${mode === 'mongo' ? 'bg-primary' : 'bg-secondary'}`}>
                    {mode === 'mongo' ? 'MongoDB (after migration)' : 'MariaDB (before migration)'}
                  </span>
                </div>
                <small className="text-muted">
                  Mode switches after running <strong>Migrate SQL → MongoDB</strong> in Admin Setup.
                </small>
                
                {systemStatus?.mongo?.migration?.lastMigrationAt && (
                  <small className="text-muted">
                    Last migration: {new Date(systemStatus.mongo.migration.lastMigrationAt).toLocaleString()}
                  </small>
                )}
              </div>
            </div>
            {activeRole === 'customer' && (
              <div className="col-md-4">
                <label className="form-label fw-bold">Acting as Customer</label>
                <select
                  className="form-select"
                  value={actingCustomerEmail}
                  onChange={function(e) {
                    setActingCustomerEmail(e.target.value)
                  }}
                >
                  <option value="">Select customer...</option>
                  {customers.map(function(customer) {
                    return (
                      <option key={customer.email} value={customer.email}>
                        {customer.name} ({customer.email})
                      </option>
                    )
                  })}
                </select>
              </div>
            )}
            
            {activeRole === 'rider' && (
              <div className="col-md-4">
                <label className="form-label fw-bold">Acting as Rider</label>
                <select
                  className="form-select"
                  value={actingRiderEmail}
                  onChange={function(e) {
                    setActingRiderEmail(e.target.value)
                  }}
                >
                  <option value="">Select rider...</option>
                  {riders.map(function(rider) {
                    return (
                      <option key={rider.email} value={rider.email}>
                        {rider.name} ({rider.email})
                      </option>
                    )
                  })}
                </select>
              </div>
            )}
          </div>
        </div>
      </div>


      {activeRole === 'customer' && (
        <Student1Section 
          mode={mode}
          actingCustomerEmail={actingCustomerEmail}
        />
      )}
      {activeRole === 'rider' && (
        <Student2Section 
          mode={mode}
          actingRiderEmail={actingRiderEmail}
        />
      )}


      {showAdminModal && (
        <AdminSection
          onClose={function() {
            setShowAdminModal(false)
            refreshSystemStatus()
          }}
          onAfterMigrate={refreshSystemStatus}
          onAfterImportReset={refreshSystemStatus}
        />
      )}
    </div>
  )
}

export default App
