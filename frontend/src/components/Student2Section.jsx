import { useState, useEffect } from 'react'
import api from '../api'

function Student2Section() {
  const [mode, setMode] = useState('sql')
  
  // Helper data
  const [riders, setRiders] = useState([])
  const [orders, setOrders] = useState([])
  
  // Assign Delivery state
  const [assignForm, setAssignForm] = useState({
    riderEmail: '',
    orderId: '',
    deliveryStatus: 'assigned'
  })
  const [assignResult, setAssignResult] = useState(null)
  
  // Report state
  const [reportForm, setReportForm] = useState({
    riderEmail: '',
    from: '',
    to: '',
    deliveryStatus: ''
  })
  const [reportResult, setReportResult] = useState(null)
  
  const [loading, setLoading] = useState(false)

  // Load riders and orders
  useEffect(() => {
    loadRiders()
    loadOrders()
  }, [])

  const loadRiders = async () => {
    try {
      const response = await api.get('/riders')
      if (response.data.riders) {
        setRiders(response.data.riders)
      }
    } catch (error) {
      console.error('Error loading riders:', error)
    }
  }

  const loadOrders = async () => {
    try {
      const response = await api.get('/orders?status=created&limit=50')
      if (response.data.orders) {
        setOrders(response.data.orders)
      }
    } catch (error) {
      console.error('Error loading orders:', error)
    }
  }

  const handleAssignDelivery = async (e) => {
    e.preventDefault()
    setLoading(true)
    setAssignResult(null)
    
    try {
      const endpoint = `/student2/${mode}/assign_delivery`
      const payload = {
        riderEmail: assignForm.riderEmail,
        orderId: parseInt(assignForm.orderId),
        deliveryStatus: assignForm.deliveryStatus
      }
      
      const response = await api.post(endpoint, payload)
      setAssignResult({ success: true, data: response.data })
      
      // Reload orders after assignment
      loadOrders()
    } catch (error) {
      setAssignResult({ 
        success: false, 
        error: error.response?.data || { error: error.message } 
      })
    } finally {
      setLoading(false)
    }
  }

  const handleReport = async (e) => {
    e.preventDefault()
    setLoading(true)
    setReportResult(null)
    
    try {
      const endpoint = `/student2/${mode}/report`
      const params = new URLSearchParams()
      params.append('riderEmail', reportForm.riderEmail)
      if (reportForm.from) params.append('from', reportForm.from)
      if (reportForm.to) params.append('to', reportForm.to)
      if (reportForm.deliveryStatus) params.append('deliveryStatus', reportForm.deliveryStatus)
      
      const response = await api.get(`${endpoint}?${params}`)
      setReportResult({ success: true, data: response.data })
    } catch (error) {
      setReportResult({ 
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
        <h2 className="card-title">Student 2 - Assign Rider & Delivery Status</h2>
        
        <ul className="nav nav-tabs mb-4">
          <li className="nav-item">
            <button 
              className={`nav-link ${mode === 'sql' ? 'active' : ''}`}
              onClick={() => setMode('sql')}
            >
              SQL Mode
            </button>
          </li>
          <li className="nav-item">
            <button 
              className={`nav-link ${mode === 'mongo' ? 'active' : ''}`}
              onClick={() => setMode('mongo')}
            >
              Mongo Mode
            </button>
          </li>
        </ul>

        {/* Assign Delivery Form */}
        <form onSubmit={handleAssignDelivery}>
          <h3 className="h5 mb-3">Assign Delivery</h3>
          
          <div className="mb-3">
            <label className="form-label">Rider Email</label>
            <select
              className="form-select"
              value={assignForm.riderEmail}
              onChange={(e) => setAssignForm({ ...assignForm, riderEmail: e.target.value })}
              required
            >
              <option value="">Select a rider...</option>
              {riders.map(rider => (
                <option key={rider.email} value={rider.email}>
                  {rider.name} ({rider.email})
                </option>
              ))}
            </select>
            <div className="form-text">Or type manually:</div>
            <input
              type="email"
              className="form-control mt-1"
              value={assignForm.riderEmail}
              onChange={(e) => setAssignForm({ ...assignForm, riderEmail: e.target.value })}
              placeholder="rider1@example.com (rider1-10)"
              required
            />
          </div>
          
          <div className="mb-3">
            <label className="form-label">Order ID</label>
            <select
              className="form-select"
              value={assignForm.orderId}
              onChange={(e) => setAssignForm({ ...assignForm, orderId: e.target.value })}
              required
            >
              <option value="">Select an order...</option>
              {orders.map(order => (
                <option key={order.orderId} value={order.orderId}>
                  Order #{order.orderId} - {order.status || 'created'}
                </option>
              ))}
            </select>
            <div className="form-text">Or type manually:</div>
            <input
              type="number"
              className="form-control mt-1"
              value={assignForm.orderId}
              onChange={(e) => setAssignForm({ ...assignForm, orderId: e.target.value })}
              placeholder="Order ID"
              required
            />
          </div>
          
          <div className="mb-3">
            <label className="form-label">Delivery Status</label>
            <select
              className="form-select"
              value={assignForm.deliveryStatus}
              onChange={(e) => setAssignForm({ ...assignForm, deliveryStatus: e.target.value })}
              required
            >
              <option value="assigned">Assigned</option>
              <option value="picked_up">Picked Up</option>
              <option value="delivered">Delivered</option>
            </select>
          </div>

          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Assigning...' : 'Assign Delivery'}
          </button>
        </form>

        {assignResult && (
          <div className={`alert mt-3 ${assignResult.success ? 'alert-success' : 'alert-danger'}`}>
            {assignResult.success ? (
              <>
                <div>Delivery assigned successfully!</div>
                <pre className="mt-2 mb-0">{JSON.stringify(assignResult.data, null, 2)}</pre>
              </>
            ) : (
              <>
                <div>✗ Error: {assignResult.error.error}</div>
                {assignResult.error.stack && <pre className="mt-2 mb-0">{assignResult.error.stack}</pre>}
              </>
            )}
          </div>
        )}

        {/* Report Form */}
        <form onSubmit={handleReport} className="mt-4 pt-4 border-top">
          <h3 className="h5 mb-3">Student 2 Report</h3>
          
          <div className="mb-3">
            <label className="form-label">Rider Email (required)</label>
            <select
              className="form-select"
              value={reportForm.riderEmail}
              onChange={(e) => setReportForm({ ...reportForm, riderEmail: e.target.value })}
            >
              <option value="">Select a rider...</option>
              {riders.map(rider => (
                <option key={rider.email} value={rider.email}>
                  {rider.name} ({rider.email})
                </option>
              ))}
            </select>
            <div className="form-text">Or type manually:</div>
            <input
              type="email"
              className="form-control mt-1"
              value={reportForm.riderEmail}
              onChange={(e) => setReportForm({ ...reportForm, riderEmail: e.target.value })}
              placeholder="rider1@example.com (rider1-10)"
              required
            />
          </div>
          
          <div className="mb-3">
            <label className="form-label">From (optional)</label>
            <input
              type="datetime-local"
              className="form-control"
              value={reportForm.from}
              onChange={(e) => setReportForm({ ...reportForm, from: e.target.value })}
            />
          </div>
          
          <div className="mb-3">
            <label className="form-label">To (optional)</label>
            <input
              type="datetime-local"
              className="form-control"
              value={reportForm.to}
              onChange={(e) => setReportForm({ ...reportForm, to: e.target.value })}
            />
          </div>
          
          <div className="mb-3">
            <label className="form-label">Delivery Status (optional)</label>
            <select
              className="form-select"
              value={reportForm.deliveryStatus}
              onChange={(e) => setReportForm({ ...reportForm, deliveryStatus: e.target.value })}
            >
              <option value="">All statuses</option>
              <option value="assigned">Assigned</option>
              <option value="picked_up">Picked Up</option>
              <option value="delivered">Delivered</option>
            </select>
          </div>

          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Generating Report...' : 'Get Report'}
          </button>
        </form>

        {reportResult && (
          <div className={`alert mt-3 ${reportResult.success ? 'alert-success' : 'alert-danger'}`}>
            {reportResult.success ? (
              <>
                <div>Report generated</div>
                {reportResult.data.rows && reportResult.data.rows.length > 0 ? (
                  <div className="table-responsive mt-3">
                    <table className="table table-striped table-bordered table-hover">
                      <thead className="table-dark">
                        <tr>
                          {Object.keys(reportResult.data.rows[0]).map(key => (
                            <th key={key}>{key}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {reportResult.data.rows.map((row, idx) => (
                          <tr key={idx}>
                            {Object.values(row).map((val, i) => (
                              <td key={i}>{JSON.stringify(val)}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="mt-2">No data found</div>
                )}
              </>
            ) : (
              <>
                <div>✗ Error: {reportResult.error.error}</div>
                {reportResult.error.stack && <pre className="mt-2 mb-0">{reportResult.error.stack}</pre>}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default Student2Section
