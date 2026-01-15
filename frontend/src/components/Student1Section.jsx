import { useState, useEffect } from 'react'
import api from '../api'

function Student1Section() {
  const [mode, setMode] = useState('sql')
  
  // Helper data
  const [customers, setCustomers] = useState([])
  const [restaurants, setRestaurants] = useState([])
  const [menuItems, setMenuItems] = useState([])
  
  // Place Order state
  const [orderForm, setOrderForm] = useState({
    customerEmail: '',
    restaurantName: '',
    items: [{ menuItemId: '', menuItemName: '', name: '', unitPrice: '', quantity: 1 }]
  })
  const [orderResult, setOrderResult] = useState(null)
  
  // Pay Order state
  const [payForm, setPayForm] = useState({
    orderId: '',
    paymentMethod: 'card'
  })
  const [payResult, setPayResult] = useState(null)
  
  // Report state
  const [reportForm, setReportForm] = useState({
    restaurantName: '',
    from: '',
    to: ''
  })
  const [reportResult, setReportResult] = useState(null)
  
  const [loading, setLoading] = useState(false)

  // Load helper data on mount
  useEffect(() => {
    loadCustomers()
    loadRestaurants()
  }, [])

  // Load menu items when restaurant changes
  useEffect(() => {
    if (orderForm.restaurantName) {
      loadMenuItems(orderForm.restaurantName)
    }
  }, [orderForm.restaurantName])

  const loadCustomers = async () => {
    try {
      const response = await api.get('/customers')
      if (response.data.customers) {
        setCustomers(response.data.customers)
      }
    } catch (error) {
      console.error('Error loading customers:', error)
    }
  }

  const loadRestaurants = async () => {
    try {
      const response = await api.get('/restaurants')
      if (response.data.restaurants) {
        setRestaurants(response.data.restaurants)
      }
    } catch (error) {
      console.error('Error loading restaurants:', error)
    }
  }

  const loadMenuItems = async (restaurantName) => {
    try {
      const response = await api.get(`/menu_items?restaurantName=${encodeURIComponent(restaurantName)}`)
      if (response.data.menuItems) {
        setMenuItems(response.data.menuItems)
      }
    } catch (error) {
      console.error('Error loading menu items:', error)
      setMenuItems([])
    }
  }

  const handleAddItem = () => {
    setOrderForm({
      ...orderForm,
      items: [...orderForm.items, { menuItemId: '', menuItemName: '', name: '', unitPrice: '', quantity: 1 }]
    })
  }

  const handleRemoveItem = (index) => {
    const newItems = orderForm.items.filter((_, i) => i !== index)
    setOrderForm({ ...orderForm, items: newItems })
  }

  const handleItemChange = (index, field, value) => {
    const newItems = [...orderForm.items]
    newItems[index][field] = value
    setOrderForm({ ...orderForm, items: newItems })
  }

  const handlePlaceOrder = async (e) => {
    e.preventDefault()
    setLoading(true)
    setOrderResult(null)
    
    try {
      const endpoint = `/student1/${mode}/place_order`
      let payload = {
        customerEmail: orderForm.customerEmail,
        restaurantName: orderForm.restaurantName,
        items: orderForm.items.map(item => {
          if (mode === 'sql') {
            return {
              quantity: parseInt(item.quantity),
              ...(item.menuItemId ? { menuItemId: parseInt(item.menuItemId) } : {}),
              ...(item.menuItemName ? { menuItemName: item.menuItemName } : {})
            }
          } else {
            return {
              name: item.name,
              unitPrice: parseFloat(item.unitPrice),
              quantity: parseInt(item.quantity),
              ...(item.menuItemId ? { menuItemId: parseInt(item.menuItemId) } : {})
            }
          }
        })
      }
      
      const response = await api.post(endpoint, payload)
      setOrderResult({ success: true, data: response.data })
      
      // Auto-fill pay form with returned orderId
      if (response.data.orderId) {
        setPayForm({ ...payForm, orderId: response.data.orderId })
      }
    } catch (error) {
      setOrderResult({ 
        success: false, 
        error: error.response?.data || { error: error.message } 
      })
    } finally {
      setLoading(false)
    }
  }

  const handlePay = async (e) => {
    e.preventDefault()
    setLoading(true)
    setPayResult(null)
    
    try {
      const endpoint = `/student1/${mode}/pay`
      const payload = {
        orderId: parseInt(payForm.orderId),
        paymentMethod: payForm.paymentMethod
      }
      
      const response = await api.post(endpoint, payload)
      setPayResult({ success: true, data: response.data })
    } catch (error) {
      setPayResult({ 
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
      const endpoint = `/student1/${mode}/report`
      const params = new URLSearchParams()
      params.append('restaurantName', reportForm.restaurantName)
      if (reportForm.from) params.append('from', reportForm.from)
      if (reportForm.to) params.append('to', reportForm.to)
      
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
        <h2 className="card-title">Student 1 - Place Order & Pay</h2>
        
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

        {/* Place Order Form */}
        <form onSubmit={handlePlaceOrder}>
          <h3 className="h5 mb-3">Place Order</h3>
          
          <div className="mb-3">
            <label className="form-label">Customer Email</label>
            <select
              className="form-select"
              value={orderForm.customerEmail}
              onChange={(e) => setOrderForm({ ...orderForm, customerEmail: e.target.value })}
              required
            >
              <option value="">Select a customer...</option>
              {customers.map(customer => (
                <option key={customer.email} value={customer.email}>
                  {customer.name} ({customer.email})
                </option>
              ))}
            </select>
          </div>
          
          <div className="mb-3">
            <label className="form-label">Restaurant Name</label>
            <select
              className="form-select"
              value={orderForm.restaurantName}
              onChange={(e) => setOrderForm({ ...orderForm, restaurantName: e.target.value })}
              required
            >
              <option value="">Select a restaurant...</option>
              {restaurants.map(restaurant => (
                <option key={restaurant.name} value={restaurant.name}>
                  {restaurant.name}
                </option>
              ))}
            </select>
          </div>

          <div className="mb-3">
            <label className="form-label">Items</label>
            {orderForm.items.map((item, index) => (
              <div key={index} className="row g-2 mb-2">
                {mode === 'sql' ? (
                  <>
                    <div className="col-md-5">
                      <select
                        className="form-select"
                        value={item.menuItemId}
                        onChange={(e) => {
                          const selectedItem = menuItems.find(mi => mi.menuItemId === parseInt(e.target.value))
                          handleItemChange(index, 'menuItemId', e.target.value)
                          if (selectedItem) {
                            handleItemChange(index, 'menuItemName', selectedItem.name)
                          }
                        }}
                      >
                        <option value="">Select menu item...</option>
                        {menuItems.map(menuItem => (
                          <option key={menuItem.menuItemId} value={menuItem.menuItemId}>
                            {menuItem.name} (${menuItem.price})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="col-md-4">
                      <input
                        type="text"
                        className="form-control"
                        placeholder="Item name (auto-filled)"
                        value={item.menuItemName}
                        onChange={(e) => handleItemChange(index, 'menuItemName', e.target.value)}
                        readOnly
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="col-md-4">
                      <select
                        className="form-select"
                        value={item.menuItemId}
                        onChange={(e) => {
                          const selectedItem = menuItems.find(mi => mi.menuItemId === parseInt(e.target.value))
                          if (selectedItem) {
                            handleItemChange(index, 'menuItemId', e.target.value)
                            handleItemChange(index, 'name', selectedItem.name)
                            handleItemChange(index, 'unitPrice', selectedItem.price)
                          }
                        }}
                      >
                        <option value="">Select menu item...</option>
                        {menuItems.map(menuItem => (
                          <option key={menuItem.menuItemId} value={menuItem.menuItemId}>
                            {menuItem.name} (${menuItem.price})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="col-md-3">
                      <input
                        type="text"
                        className="form-control"
                        placeholder="Item name (auto-filled)"
                        value={item.name}
                        onChange={(e) => handleItemChange(index, 'name', e.target.value)}
                        readOnly
                      />
                    </div>
                    <div className="col-md-2">
                      <input
                        type="number"
                        className="form-control"
                        step="0.01"
                        placeholder="Unit Price"
                        value={item.unitPrice}
                        onChange={(e) => handleItemChange(index, 'unitPrice', e.target.value)}
                        readOnly
                      />
                    </div>
                  </>
                )}
                <div className="col-md-2">
                  <input
                    type="number"
                    className="form-control"
                    placeholder="Quantity"
                    value={item.quantity}
                    onChange={(e) => handleItemChange(index, 'quantity', e.target.value)}
                    required
                    min="1"
                  />
                </div>
                <div className="col-md-1">
                  <button type="button" className="btn btn-danger w-100" onClick={() => handleRemoveItem(index)}>✕</button>
                </div>
              </div>
            ))}
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={handleAddItem}>
              + Add Item
            </button>
          </div>

          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Placing Order...' : 'Place Order'}
          </button>
        </form>

        {orderResult && (
          <div className={`alert mt-3 ${orderResult.success ? 'alert-success' : 'alert-danger'}`}>
            {orderResult.success ? (
              <>
                <div>Order placed! Order ID: {orderResult.data.orderId}</div>
                <pre className="mt-2 mb-0">{JSON.stringify(orderResult.data, null, 2)}</pre>
              </>
            ) : (
              <>
                <div>✗ Error: {orderResult.error.error}</div>
                {orderResult.error.stack && <pre className="mt-2 mb-0">{orderResult.error.stack}</pre>}
              </>
            )}
          </div>
        )}

        {/* Pay Order Form */}
        <form onSubmit={handlePay} className="mt-4 pt-4 border-top">
          <h3 className="h5 mb-3">Pay Order</h3>
          
          <div className="mb-3">
            <label className="form-label">Order ID</label>
            <input
              type="number"
              className="form-control"
              value={payForm.orderId}
              onChange={(e) => setPayForm({ ...payForm, orderId: e.target.value })}
              required
            />
          </div>
          
          <div className="mb-3">
            <label className="form-label">Payment Method</label>
            <select
              className="form-select"
              value={payForm.paymentMethod}
              onChange={(e) => setPayForm({ ...payForm, paymentMethod: e.target.value })}
            >
              <option value="card">Card</option>
              <option value="cash">Cash</option>
              <option value="paypal">PayPal</option>
            </select>
          </div>

          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Processing Payment...' : 'Pay'}
          </button>
        </form>

        {payResult && (
          <div className={`alert mt-3 ${payResult.success ? 'alert-success' : 'alert-danger'}`}>
            {payResult.success ? (
              <>
                <div>Payment successful!</div>
                <pre className="mt-2 mb-0">{JSON.stringify(payResult.data, null, 2)}</pre>
              </>
            ) : (
              <>
                <div>✗ Error: {payResult.error.error}</div>
                {payResult.error.stack && <pre className="mt-2 mb-0">{payResult.error.stack}</pre>}
              </>
            )}
          </div>
        )}

        {/* Report Form */}
        <form onSubmit={handleReport} className="mt-4 pt-4 border-top">
          <h3 className="h5 mb-3">Student 1 Report</h3>
          
          <div className="mb-3">
            <label className="form-label">Restaurant Name (required)</label>
            <select
              className="form-select"
              value={reportForm.restaurantName}
              onChange={(e) => setReportForm({ ...reportForm, restaurantName: e.target.value })}
              required
            >
              <option value="">Select a restaurant...</option>
              {restaurants.map(restaurant => (
                <option key={restaurant.name} value={restaurant.name}>
                  {restaurant.name}
                </option>
              ))}
            </select>
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

export default Student1Section
