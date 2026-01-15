import { useState, useEffect } from 'react'
import api from '../api'

function Student2Section({ mode, actingRiderEmail }) {
  const [view, setView] = useState('available')
  
  // Three separate order lists
  const [availableOrders, setAvailableOrders] = useState([])
  const [activeDeliveries, setActiveDeliveries] = useState([])
  const [completedDeliveries, setCompletedDeliveries] = useState([])
  
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [deliveryStatus, setDeliveryStatus] = useState('assigned')
  
  // Results
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

  // Load data when mode or actingRiderEmail changes
  useEffect(() => {
    if (view === 'available') {
      loadAvailableOrders()
    } else if (view === 'active') {
      loadActiveDeliveries()
    } else if (view === 'completed') {
      loadCompletedDeliveries()
    }
  }, [mode, view, actingRiderEmail])

  // Set actingRiderEmail in report form when it changes
  useEffect(() => {
    if (actingRiderEmail) {
      setReportForm(prev => ({ ...prev, riderEmail: actingRiderEmail }))
    }
  }, [actingRiderEmail])

  const loadAvailableOrders = async () => {
    try {
      // Use mode-specific endpoint to fetch orders from correct database
      const endpoint = mode === 'sql' ? '/orders?unassigned=true&status=preparing&limit=50' : `/student2/${mode}/orders?status=preparing&limit=50`
      const response = await api.get(endpoint)
      if (response.data.orders) {
        // Filter unassigned orders for Mongo mode
        const orders = mode === 'mongo' 
          ? response.data.orders.filter(o => !o.riderEmail)
          : response.data.orders
        setAvailableOrders(orders)
      }
    } catch (error) {
      console.error('Error loading available orders:', error)
    }
  }

  const loadActiveDeliveries = async () => {
    if (!actingRiderEmail) {
      setActiveDeliveries([])
      return
    }
    try {
      // Use mode-specific endpoint to fetch orders from correct database
      const endpoint = mode === 'sql' 
        ? `/orders?riderEmail=${encodeURIComponent(actingRiderEmail)}&excludeDelivered=true&limit=50`
        : `/student2/${mode}/orders?riderEmail=${encodeURIComponent(actingRiderEmail)}&excludeDelivered=true&limit=50`
      const response = await api.get(endpoint)
      if (response.data.orders) {
        setActiveDeliveries(response.data.orders)
      }
    } catch (error) {
      console.error('Error loading active deliveries:', error)
    }
  }

  const loadCompletedDeliveries = async () => {
    if (!actingRiderEmail) {
      setCompletedDeliveries([])
      return
    }
    try {
      // Use mode-specific endpoint to fetch orders from correct database
      const endpoint = mode === 'sql'
        ? `/orders?riderEmail=${encodeURIComponent(actingRiderEmail)}&deliveryStatus=delivered&limit=50`
        : `/student2/${mode}/orders?riderEmail=${encodeURIComponent(actingRiderEmail)}&deliveryStatus=delivered&limit=50`
      const response = await api.get(endpoint)
      if (response.data.orders) {
        setCompletedDeliveries(response.data.orders)
      }
    } catch (error) {
      console.error('Error loading completed deliveries:', error)
    }
  }

  const handleAssignDelivery = async () => {
    if (!actingRiderEmail) {
      alert('Please select an acting rider from the global selector above.')
      return
    }
    if (!selectedOrder) {
      alert('Please select an order to assign.')
      return
    }

    setLoading(true)
    setAssignResult(null)
    
    try {
      const endpoint = `/student2/${mode}/assign_delivery`
      const payload = {
        riderEmail: actingRiderEmail,
        orderId: selectedOrder.orderId,
        deliveryStatus: deliveryStatus
      }
      
      const response = await api.post(endpoint, payload)
      setAssignResult({ success: true, data: response.data })
      
      // Remove from current list
      if (view === 'available') {
        setAvailableOrders(prev => prev.filter(o => o.orderId !== selectedOrder.orderId))
      } else if (view === 'active') {
        setActiveDeliveries(prev => prev.filter(o => o.orderId !== selectedOrder.orderId))
      }
      
      setSelectedOrder(null)
      
      // Switch to appropriate view based on delivery status
      if (deliveryStatus === 'delivered') {
        // Reload completed and switch to completed view
        await loadCompletedDeliveries()
        setView('completed')
      } else {
        // Reload active and switch to active view
        await loadActiveDeliveries()
        setView('active')
      }
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

  const renderOrdersList = (orders, emptyMessage) => (
    <div className="col-md-7">
      <button 
        className="btn btn-sm btn-outline-secondary mb-3"
        onClick={() => {
          if (view === 'available') loadAvailableOrders()
          else if (view === 'active') loadActiveDeliveries()
          else if (view === 'completed') loadCompletedDeliveries()
        }}
        disabled={loading}
      >
        Refresh
      </button>

      {orders.length === 0 ? (
        <div className="alert alert-info">{emptyMessage}</div>
      ) : (
        <div className="list-group">
          {orders.map(order => (
            <button
              key={order.orderId}
              type="button"
              className={`list-group-item list-group-item-action ${selectedOrder?.orderId === order.orderId ? 'active' : ''}`}
              onClick={() => {
                setSelectedOrder(order)
                // Sync deliveryStatus with the selected order's current status (Bug 1 fix)
                if (view === 'active' && order.deliveryStatus) {
                  setDeliveryStatus(order.deliveryStatus)
                }
              }}
            >
              <div className="d-flex w-100 justify-content-between">
                <h6 className="mb-1">Order #{order.orderId}</h6>
                <small>{new Date(order.createdAt).toLocaleString()}</small>
              </div>
              <p className="mb-1">
                <strong>{order.restaurantName}</strong>
              </p>
              <small>
                {order.deliveryStatus && <span className="badge bg-secondary me-2">{order.deliveryStatus}</span>}
                Total: <strong>€{Number(order.totalAmount).toFixed(2)}</strong>
              </small>
            </button>
          ))}
        </div>
      )}
    </div>
  )

  const renderAvailableView = () => (
    <>
      <div className="alert alert-light border mb-3">
        <small className="text-muted">
          <strong>Available Orders:</strong> These orders are ready to be picked up. Accept one to start delivery.
        </small>
      </div>

      <div className="row">
        {renderOrdersList(availableOrders, 'No orders available for pickup. Check back later or place a test order.')}

        <div className="col-md-5">
          <div className="card sticky-top" style={{ top: '1rem' }}>
            <div className="card-header bg-success text-white">
              <h5 className="mb-0">Accept Order</h5>
            </div>
            <div className="card-body">
              {!selectedOrder ? (
                <p className="text-muted text-center">Select an order from the list to accept it</p>
              ) : (
                <>
                  <h6 className="mb-3">Order #{selectedOrder.orderId}</h6>
                  <dl className="row mb-3">
                    <dt className="col-sm-5">Restaurant:</dt>
                    <dd className="col-sm-7">{selectedOrder.restaurantName}</dd>
                    
                    <dt className="col-sm-5">Total:</dt>
                    <dd className="col-sm-7">€{Number(selectedOrder.totalAmount).toFixed(2)}</dd>
                    
                    <dt className="col-sm-5">Created:</dt>
                    <dd className="col-sm-7">{new Date(selectedOrder.createdAt).toLocaleString()}</dd>
                  </dl>

                  <div className="mb-3">
                    <label className="form-label">Set Initial Status</label>
                    <select
                      className="form-select"
                      value={deliveryStatus}
                      onChange={(e) => setDeliveryStatus(e.target.value)}
                    >
                      <option value="assigned">Assigned (just accepted)</option>
                      <option value="picked_up">Picked Up (already collected)</option>
                    </select>
                  </div>

                  <button
                    className="btn btn-success w-100"
                    onClick={handleAssignDelivery}
                    disabled={loading || !actingRiderEmail}
                  >
                    {loading ? 'Processing...' : 'Accept Order'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )

  const renderActiveView = () => (
    <>
      <div className="alert alert-light border mb-3">
        <small className="text-muted">
          <strong>Active Deliveries:</strong> Orders you've accepted. Update status as you progress.
        </small>
      </div>

      <div className="row">
        {renderOrdersList(activeDeliveries, 'No active deliveries. Accept an order from Available Orders tab.')}

        <div className="col-md-5">
          <div className="card sticky-top" style={{ top: '1rem' }}>
            <div className="card-header bg-info text-white">
              <h5 className="mb-0">Update Delivery</h5>
            </div>
            <div className="card-body">
              {!selectedOrder ? (
                <p className="text-muted text-center">Select a delivery to update its status</p>
              ) : (
                <>
                  <h6 className="mb-3">Order #{selectedOrder.orderId}</h6>
                  <dl className="row mb-3">
                    <dt className="col-sm-5">Restaurant:</dt>
                    <dd className="col-sm-7">{selectedOrder.restaurantName}</dd>
                    
                    <dt className="col-sm-5">Total:</dt>
                    <dd className="col-sm-7">€{Number(selectedOrder.totalAmount).toFixed(2)}</dd>
                    
                    <dt className="col-sm-5">Current Status:</dt>
                    <dd className="col-sm-7">
                      <span className="badge bg-warning">{selectedOrder.deliveryStatus || 'assigned'}</span>
                    </dd>
                  </dl>

                  <div className="mb-3">
                    <label className="form-label">Update Status</label>
                    <select
                      className="form-select"
                      value={deliveryStatus}
                      onChange={(e) => setDeliveryStatus(e.target.value)}
                    >
                      <option value="assigned">Assigned</option>
                      <option value="picked_up">Picked Up</option>
                      <option value="delivered">Delivered</option>
                    </select>
                  </div>

                  <button
                    className="btn btn-primary w-100"
                    onClick={handleAssignDelivery}
                    disabled={loading}
                  >
                    {loading ? 'Updating...' : 'Update Status'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )

  const renderCompletedView = () => (
    <>
      <div className="alert alert-light border mb-3">
        <small className="text-muted">
          <strong>Completed Deliveries:</strong> Orders you've successfully delivered.
        </small>
      </div>

      <div className="row">
        <div className="col-12">
          <button 
            className="btn btn-sm btn-outline-secondary mb-3"
            onClick={loadCompletedDeliveries}
            disabled={loading}
          >
            Refresh
          </button>

          {completedDeliveries.length === 0 ? (
            <div className="alert alert-info">
              No completed deliveries yet. Complete a delivery to see it here.
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover">
                <thead className="table-light">
                  <tr>
                    <th>Order #</th>
                    <th>Restaurant</th>
                    <th>Total</th>
                    <th>Completed At</th>
                  </tr>
                </thead>
                <tbody>
                  {completedDeliveries.map(order => (
                    <tr key={order.orderId}>
                      <td><strong>#{order.orderId}</strong></td>
                      <td>{order.restaurantName}</td>
                      <td>€{Number(order.totalAmount).toFixed(2)}</td>
                      <td>{order.assignedAt ? new Date(order.assignedAt).toLocaleString() : 'N/A'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  )

  const renderAnalyticsView = () => (
    <>
      <h3 className="h5 mb-3">Delivery Analytics Report</h3>
      <p className="text-muted">View delivery assignments and status by rider.</p>
      
      <form onSubmit={handleReport}>
        <div className="row g-3">
          <div className="col-md-4">
            <label className="form-label">Rider Email</label>
            <input
              type="email"
              className="form-control"
              value={reportForm.riderEmail}
              onChange={(e) => setReportForm({ ...reportForm, riderEmail: e.target.value })}
              placeholder="rider@example.com"
              required
            />
            <small className="form-text text-muted">
              Pre-filled with acting rider
            </small>
          </div>

          <div className="col-md-4">
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
          
          <div className="col-md-2">
            <label className="form-label">From (optional)</label>
            <input
              type="datetime-local"
              className="form-control"
              value={reportForm.from}
              onChange={(e) => setReportForm({ ...reportForm, from: e.target.value })}
            />
          </div>
          
          <div className="col-md-2">
            <label className="form-label">To (optional)</label>
            <input
              type="datetime-local"
              className="form-control"
              value={reportForm.to}
              onChange={(e) => setReportForm({ ...reportForm, to: e.target.value })}
            />
          </div>
        </div>

        <button type="submit" className="btn btn-primary mt-3" disabled={loading}>
          {loading ? 'Generating Report...' : 'Generate Report'}
        </button>
      </form>

      {reportResult && (
        <div className={`alert mt-3 ${reportResult.success ? 'alert-success' : 'alert-danger'}`}>
          {reportResult.success ? (
            <>
              <h5 className="alert-heading">Report Generated</h5>
              {reportResult.data.rows && reportResult.data.rows.length > 0 ? (
                <div className="table-responsive mt-3">
                  <table className="table table-striped table-bordered table-hover table-sm">
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
                            <td key={i}>{val != null ? JSON.stringify(val) : '-'}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mt-2 mb-0">No data found for the selected criteria.</p>
              )}
            </>
          ) : (
            <>
              <div>Error: {reportResult.error.error}</div>
              {reportResult.error.stack && <pre className="mt-2 mb-0 small">{reportResult.error.stack}</pre>}
            </>
          )}
        </div>
      )}
    </>
  )

  return (
    <div className="card mb-4">
      <div className="card-body">
        <div className="d-flex justify-content-between align-items-center mb-4">
          <h2 className="card-title mb-0">Rider Delivery Management</h2>
          <div className="btn-group" role="group">
            <button
              type="button"
              className={`btn btn-sm ${view === 'available' ? 'btn-primary' : 'btn-outline-primary'}`}
              onClick={() => {
                setView('available')
                setSelectedOrder(null)
                // Reset to default for available orders (Bug 2 fix)
                setDeliveryStatus('assigned')
              }}
            >
              Available Orders
            </button>
            <button
              type="button"
              className={`btn btn-sm ${view === 'active' ? 'btn-primary' : 'btn-outline-primary'}`}
              onClick={() => {
                setView('active')
                setSelectedOrder(null)
                // Reset to default for active deliveries (Bug 2 fix)
                setDeliveryStatus('assigned')
              }}
            >
              Active Deliveries
            </button>
            <button
              type="button"
              className={`btn btn-sm ${view === 'completed' ? 'btn-primary' : 'btn-outline-primary'}`}
              onClick={() => {
                setView('completed')
                setSelectedOrder(null)
                // Reset delivery status for consistency
                setDeliveryStatus('assigned')
              }}
            >
              Completed
            </button>
            <button
              type="button"
              className={`btn btn-sm ${view === 'analytics' ? 'btn-primary' : 'btn-outline-primary'}`}
              onClick={() => {
                setView('analytics')
                setSelectedOrder(null)
                // Reset delivery status for consistency
                setDeliveryStatus('assigned')
              }}
            >
              Analytics
            </button>
          </div>
        </div>

        {!actingRiderEmail && view !== 'analytics' && (
          <div className="alert alert-warning" role="alert">
            <strong>Note:</strong> Please select an acting rider from the global selector above to manage deliveries.
          </div>
        )}

        {assignResult && (
          <div className={`alert ${assignResult.success ? 'alert-success' : 'alert-danger'}`}>
            {assignResult.success ? (
              <>
                <h5 className="alert-heading">Success!</h5>
                <p className="mb-0">Order status updated successfully.</p>
              </>
            ) : (
              <>
                <div>Error: {assignResult.error.error}</div>
                {assignResult.error.stack && <pre className="mt-2 mb-0 small">{assignResult.error.stack}</pre>}
              </>
            )}
            <button 
              className="btn btn-sm btn-outline-secondary mt-2"
              onClick={() => setAssignResult(null)}
            >
              Dismiss
            </button>
          </div>
        )}

        {view === 'available' && renderAvailableView()}
        {view === 'active' && renderActiveView()}
        {view === 'completed' && renderCompletedView()}
        {view === 'analytics' && renderAnalyticsView()}
      </div>
    </div>
  )
}

export default Student2Section
