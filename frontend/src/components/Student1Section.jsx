import { useState, useEffect } from 'react'
import api from '../api'

function Student1Section({ mode, actingCustomerEmail }) {
  const [view, setView] = useState('order')
  const [menuView, setMenuView] = useState('restaurants')
  
  // Restaurant and menu data
  const [restaurants, setRestaurants] = useState([])
  const [selectedRestaurant, setSelectedRestaurant] = useState(null)
  const [menuItems, setMenuItems] = useState([])
  
  // Cart state
  const [cart, setCart] = useState([])
  
  // Order state
  const [currentOrder, setCurrentOrder] = useState(null)
  const [orderResult, setOrderResult] = useState(null)
  const [payResult, setPayResult] = useState(null)
  
  // My Orders state
  const [myOrders, setMyOrders] = useState([])
  
  // Report state
  const [reportForm, setReportForm] = useState({
    restaurantName: '',
    from: '',
    to: ''
  })
  const [reportResult, setReportResult] = useState(null)
  
  const [loading, setLoading] = useState(false)

  // Load restaurants on mount
  useEffect(function() {
    loadRestaurants()
  }, [])



  // Load user's orders when customer email or mode changes
  useEffect(() => {
    if ( actingCustomerEmail && view === 'myorders' ) {
      loadMyOrders()
    }
  }, [actingCustomerEmail, mode, view])



  // Load menu when restaurant is selected
  useEffect(function() {
    if ( selectedRestaurant ) {
      loadMenuItems(selectedRestaurant.name)
    } else {
      setMenuItems([])
    }
  }, [selectedRestaurant])



  const loadRestaurants = async () => {
    try {
      const response = await api.get('/restaurants')
      if ( response.data.restaurants ) {
        setRestaurants(response.data.restaurants)
      }
    } 
    catch (error) {
      console.error('Error loading restaurants:', error)
    }
  }



  const loadMenuItems = async (restaurantName) => {
    try {
      const response = await api.get(`/menu_items?restaurantName=${encodeURIComponent(restaurantName)}`)
      if ( response.data.menuItems ) {
        setMenuItems(response.data.menuItems)
      }
    } 
    catch (error) {
      console.error('Error loading menu items:', error)
      setMenuItems([])
    }
  }



  const loadMyOrders = async () => {
    if (!actingCustomerEmail) return
    
    try {
      // Use mode-specific endpoint to fetch orders from correct database
      const endpoint = mode === 'sql'
        ? '/orders?limit=100'
        : `/student1/${mode}/orders?customerEmail=${encodeURIComponent(actingCustomerEmail)}&limit=100`
      const response = await api.get(endpoint)
      if ( response.data.orders ) {
        // Filter orders for the current customer (SQL returns all orders)
        const customerOrders = mode === 'sql'
          ? response.data.orders.filter(function(order) {
              return order.customerEmail === actingCustomerEmail;
            })
          : response.data.orders
        setMyOrders(customerOrders)
      }
    } 
    catch (error) {
      console.error('Error loading orders:', error)
    }
  }



  const addToCart = function(menuItem) {
    const existingItem = cart.find(function(item) {
      return item.menuItemId === menuItem.menuItemId
    })
    
    if ( existingItem ) {
      setCart(cart.map(function(item) {
        if ( item.menuItemId === menuItem.menuItemId ) {
          return { ...item, quantity: item.quantity + 1 }
        } 
        else {
          return item
        }
      }))
    } 
    else {
      setCart([...cart, { ...menuItem, quantity: 1 }])
    }
  }



  const updateCartQuantity = function(menuItemId, quantity) {
    if ( quantity <= 0 ) {
      removeFromCart(menuItemId)
    } 
    else {
      setCart(cart.map(function(item) {
        if ( item.menuItemId === menuItemId ) {
          return { ...item, quantity: quantity }
        } 
        else {
          return item
        }
      }))
    }
  }



  const removeFromCart = function(menuItemId) {
    setCart(cart.filter(function(item) {
      return item.menuItemId !== menuItemId
    }))
  }



  const clearCart = function() {
    setCart([])
  }



  const calculateTotal = function() {
    return cart.reduce(function(sum, item) {
      return sum + (item.price * item.quantity)
    }, 0).toFixed(2)
  }



  const handlePlaceOrder = async () => {
    if (!actingCustomerEmail) {
      alert('Please select an acting customer from the global selector above.')
      return
    }
    
    if (!selectedRestaurant) {
      alert('Please select a restaurant.')
      return
    }
    
    if ( cart.length === 0 ) {
      alert('Your cart is empty.')
      return
    }

    setLoading(true)
    setOrderResult(null)
    
    try {
      const endpoint = `/student1/${mode}/place_order`
      const payload = {
        customerEmail: actingCustomerEmail,
        restaurantName: selectedRestaurant.name,
        items: cart.map(function(item) {
          if ( mode === 'sql' ) {
            return {
              menuItemId: item.menuItemId,
              quantity: item.quantity
            }
          } 
          else {
            return {
              menuItemId: item.menuItemId,
              name: item.name,
              unitPrice: item.price,
              quantity: item.quantity
            }
          }
        })
      }
      
      const response = await api.post(endpoint, payload)
      setOrderResult({ success: true, data: response.data })
      setCurrentOrder(response.data)
      clearCart()
    } 
    catch (error) {
      setOrderResult({ 
        success: false, 
        error: error.response?.data || { error: error.message } 
      })
    } 
    finally {
      setLoading(false)
    }
  }



  const handlePay = async function(orderId, paymentMethod) {
    if ( paymentMethod === undefined ) {
      paymentMethod = 'card'
    }
    setLoading(true)
    setPayResult(null)
    
    try {
      const endpoint = `/student1/${mode}/pay`
      const payload = {
        orderId: parseInt(orderId),
        paymentMethod
      }
      
      const response = await api.post(endpoint, payload)
      setPayResult({ success: true, data: response.data })
      setCurrentOrder(null)
      
      // Reload orders if on My Orders tab
      if ( view === 'myorders' ) {
        await loadMyOrders()
      }
    } 
    catch (error) {
      setPayResult({ 
        success: false, 
        error: error.response?.data || { error: error.message } 
      })
    } 
    finally {
      setLoading(false)
    }
  }



  const handleReport = async function(e) {
    e.preventDefault()
    setLoading(true)
    setReportResult(null)
    
    try {
      const endpoint = `/student1/${mode}/report`
      const params = new URLSearchParams()
      params.append('restaurantName', reportForm.restaurantName)
      if ( reportForm.from ) {
        params.append('from', reportForm.from);
      }
      if ( reportForm.to ) {
        params.append('to', reportForm.to);
      }
      
      const response = await api.get(`${endpoint}?${params}`)
      setReportResult({ success: true, data: response.data })
    } 
    catch (error) {
      setReportResult({ 
        success: false, 
        error: error.response?.data || { error: error.message } 
      })
    } 
    finally {
      setLoading(false)
    }
  }



  const getOrderStatusBadge = function(order) {
    // Check if order has been paid
    const isPaid = order.paymentMethod || order.payment
    
    if ( order.deliveryStatus === 'delivered' ) {
      return <span className="badge bg-success">Delivered</span>
    } 
    else if ( order.deliveryStatus === 'picked_up' ) {
      return <span className="badge bg-info">Picked Up</span>
    } 
    else if ( order.deliveryStatus === 'assigned' ) {
      return <span className="badge bg-warning text-dark">Assigned to Rider</span>
    } 
    else if ( isPaid ) {
      return <span className="badge bg-primary">Paid</span>
    } 
    else {
      return <span className="badge bg-secondary">Awaiting Payment</span>
    }
  }



  const handleSelectRestaurant = function(restaurant) {
    setSelectedRestaurant(restaurant)
    setMenuView('menu')
    // Clear cart when switching restaurants to prevent mixing items
    setCart([])
  }



  const handleBackToRestaurants = function() {
    setMenuView('restaurants')
    setSelectedRestaurant(null)
    // Clear cart when returning to restaurant list
    setCart([])
  }



  const renderOrderView = function() {
    return (
    <>
      <div className="row">
        <div className="col-md-8">
          {menuView === 'restaurants' ? (
            <>
              <h3 className="h5 mb-3">Select Restaurant</h3>
              <div className="list-group mb-4">
                {restaurants.map(function(restaurant) {
                  return (
                  <button
                    key={restaurant.restaurantId}
                    type="button"
                    className="list-group-item list-group-item-action"
                    onClick={function() {
                      handleSelectRestaurant(restaurant)
                    }}
                  >
                    <div className="d-flex w-100 justify-content-between">
                      <h6 className="mb-1">{restaurant.name}</h6>
                    </div>
                    <small>{restaurant.address}</small>
                  </button>
                  )
                })}
              </div>
            </>
          ) 
          : (
            <>
              <div className="d-flex align-items-center mb-3">
                <button
                  className="btn btn-outline-secondary btn-sm me-3"
                  onClick={handleBackToRestaurants}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="bi bi-arrow-left" viewBox="0 0 16 16" style={{ verticalAlign: 'text-bottom' }}>
                    <path fillRule="evenodd" d="M15 8a.5.5 0 0 0-.5-.5H2.707l3.147-3.146a.5.5 0 1 0-.708-.708l-4 4a.5.5 0 0 0 0 .708l4 4a.5.5 0 0 0 .708-.708L2.707 8.5H14.5A.5.5 0 0 0 15 8z"/>
                  </svg>
                  {' '}Back to Restaurants
                </button>
                <h3 className="h5 mb-0">Menu - {selectedRestaurant?.name}</h3>
              </div>
              
              {menuItems.length === 0 ? (
                <div className="alert alert-info">No menu items available for this restaurant.</div>
              ) 
              : (
                <div className="row row-cols-1 row-cols-md-2 g-3 mb-4">
                  {menuItems.map(function(item) {
                    return (
                    <div key={item.menuItemId} className="col">
                      <div className="card h-100">
                        <div className="card-body">
                          <h6 className="card-title">{item.name}</h6>
                          {item.description && (
                            <p className="card-text small text-muted">{item.description}</p>
                          )}
                          <div className="d-flex justify-content-between align-items-center">
                            <span className="fw-bold text-success">€{Number(item.price).toFixed(2)}</span>
                            <button 
                              className="btn btn-sm btn-primary"
                              onClick={function() {
                                addToCart(item)
                              }}
                            >
                              Add to Cart
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>


        <div className="col-md-4">
          <div className="card sticky-top" style={{ top: '1rem' }}>
            <div className="card-header bg-primary text-white">
              <h5 className="mb-0">Cart</h5>
            </div>
            <div className="card-body">
              {cart.length === 0 ? (
                <p className="text-muted text-center">Your cart is empty</p>
              ) 
              : (
                <>
                  <div className="list-group list-group-flush mb-3">
                    {cart.map(function(item) {
                      return (
                      <div key={item.menuItemId} className="list-group-item px-0">
                        <div className="d-flex justify-content-between align-items-start">
                          <div className="flex-grow-1">
                            <h6 className="mb-1">{item.name}</h6>
                            <small className="text-muted">€{Number(item.price).toFixed(2)} each</small>
                          </div>
                          <button
                            className="btn btn-sm btn-outline-danger"
                            onClick={function() {
                              removeFromCart(item.menuItemId)
                            }}
                          >
                            ×
                          </button>
                        </div>
                        <div className="input-group input-group-sm mt-2">
                          <button
                            className="btn btn-outline-secondary"
                            onClick={function() {
                              updateCartQuantity(item.menuItemId, item.quantity - 1)
                            }}
                          >
                            -
                          </button>
                          <input
                            type="number"
                            className="form-control text-center"
                            value={item.quantity}
                            onChange={function(e) {
                              updateCartQuantity(item.menuItemId, parseInt(e.target.value) || 1)
                            }}
                            min="1"
                          />
                          <button
                            className="btn btn-outline-secondary"
                            onClick={function() {
                              updateCartQuantity(item.menuItemId, item.quantity + 1)
                            }}
                          >
                            +
                          </button>
                        </div>
                      </div>
                      )
                    })}
                  </div>
                  
                  <div className="border-top pt-3 mb-3">
                    <div className="d-flex justify-content-between fw-bold">
                      <span>Total:</span>
                      <span className="text-success">€{calculateTotal()}</span>
                    </div>
                  </div>

                  <button 
                    className="btn btn-success w-100 mb-2"
                    onClick={handlePlaceOrder}
                    disabled={loading || !actingCustomerEmail}
                  >
                    {loading ? 'Placing Order...' : 'Place Order'}
                  </button>
                  <button 
                    className="btn btn-outline-secondary w-100"
                    onClick={clearCart}
                  >
                    Clear Cart
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>


      {orderResult && (
        <div className={`alert mt-3 ${orderResult.success ? 'alert-success' : 'alert-danger'}`}>
          {orderResult.success ? (
            <>
              <h5 className="alert-heading">Order Placed Successfully!</h5>
              <p>Order ID: <strong>#{orderResult.data.orderId || orderResult.data.order?.orderId}</strong></p>
              <p className="mb-0">You can now pay for this order below or view it in the "My Orders" tab.</p>
            </>
          ) 
          : (
            <>
              <div>Error: {orderResult.error.error}</div>
              {orderResult.error.stack && <pre className="mt-2 mb-0 small">{orderResult.error.stack}</pre>}
            </>
          )}
        </div>
      )}


      {currentOrder && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={function() {
          setCurrentOrder(null)
        }}>
          <div className="modal-dialog modal-dialog-centered" onClick={function(e) {
            e.stopPropagation()
          }}>
            <div className="modal-content">
              <div className="modal-header bg-warning">
                <h5 className="modal-title">Complete Payment</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={function() {
                    setCurrentOrder(null)
                  }}
                  disabled={loading}
                ></button>
              </div>
              <div className="modal-body">
                <div className="alert alert-info mb-3">
                  <strong>Order placed successfully!</strong> Please select a payment method to complete your order.
                </div>
                
                <dl className="row mb-3">
                  <dt className="col-sm-4">Order ID:</dt>
                  <dd className="col-sm-8"><strong>#{currentOrder.orderId || currentOrder.order?.orderId}</strong></dd>
                  
                  <dt className="col-sm-4">Restaurant:</dt>
                  <dd className="col-sm-8">{currentOrder.restaurant?.name || currentOrder.order?.restaurant?.name || 'N/A'}</dd>
                  
                  <dt className="col-sm-4">Total Amount:</dt>
                  <dd className="col-sm-8"><strong className="text-success">€{Number(currentOrder.totalAmount || currentOrder.order?.totalAmount).toFixed(2)}</strong></dd>
                </dl>

                <div className="mb-3">
                  <label className="form-label fw-bold">Select Payment Method:</label>
                  <div className="d-grid gap-2">
                    <button
                      className="btn btn-primary btn-lg"
                      onClick={function() {
                        handlePay(currentOrder.orderId || currentOrder.order?.orderId, 'card')
                      }}
                      disabled={loading}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" className="bi bi-credit-card me-2" viewBox="0 0 16 16" style={{ verticalAlign: 'text-bottom' }}>
                        <path d="M0 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V4zm2-1a1 1 0 0 0-1 1v1h14V4a1 1 0 0 0-1-1H2zm13 4H1v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7z"/>
                        <path d="M2 10a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-1z"/>
                      </svg>
                      {loading ? 'Processing...' : 'Pay with Card'}
                    </button>
                    <button
                      className="btn btn-success btn-lg"
                      onClick={function() {
                        handlePay(currentOrder.orderId || currentOrder.order?.orderId, 'cash')
                      }}
                      disabled={loading}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" className="bi bi-cash me-2" viewBox="0 0 16 16" style={{ verticalAlign: 'text-bottom' }}>
                        <path d="M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/>
                        <path d="M0 4a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H1a1 1 0 0 1-1-1V4zm3 0a2 2 0 0 1-2 2v4a2 2 0 0 1 2 2h10a2 2 0 0 1 2-2V6a2 2 0 0 1-2-2H3z"/>
                      </svg>
                      {loading ? 'Processing...' : 'Pay with Cash'}
                    </button>
                    <button
                      className="btn btn-info btn-lg"
                      onClick={function() {
                        handlePay(currentOrder.orderId || currentOrder.order?.orderId, 'paypal')
                      }}
                      disabled={loading}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" className="bi bi-paypal me-2" viewBox="0 0 16 16" style={{ verticalAlign: 'text-bottom' }}>
                        <path d="M14.06 3.713c.12-1.071-.093-1.832-.702-2.526C12.628.356 11.312 0 9.626 0H4.734a.7.7 0 0 0-.691.59L2.005 13.509a.42.42 0 0 0 .415.486h2.756l-.202 1.28a.628.628 0 0 0 .62.726H8.14c.429 0 .793-.31.862-.731l.025-.13.48-3.043.03-.164.001-.007a.351.351 0 0 1 .348-.297h.38c1.266 0 2.425-.256 3.345-.91.379-.27.712-.603.993-1.005a4.942 4.942 0 0 0 .88-2.195c.242-1.246.13-2.356-.57-3.154a2.687 2.687 0 0 0-.76-.59l-.094-.061ZM6.543 8.82a.695.695 0 0 1 .321-.079H8.3c2.82 0 5.027-1.144 5.672-4.456l.003-.016c.217.124.4.27.548.438.546.623.679 1.535.45 2.71-.272 1.397-.866 2.307-1.663 2.874-.802.57-1.842.815-3.043.815h-.38a.873.873 0 0 0-.863.734l-.03.164-.48 3.043-.024.13-.001.004a.352.352 0 0 1-.348.296H5.595a.106.106 0 0 1-.105-.123l.208-1.32.845-5.214Z"/>
                      </svg>
                      {loading ? 'Processing...' : 'Pay with PayPal'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {payResult && (
        <div className={`alert mt-3 ${payResult.success ? 'alert-success' : 'alert-danger'}`}>
          {payResult.success ? (
            <>
              <h5 className="alert-heading">Payment Successful!</h5>
              <p className="mb-2">Your order has been paid and is now being prepared.</p>
              <button 
                className="btn btn-sm btn-success"
                onClick={function() {
                  setView('myorders')
                }}
              >
                View in My Orders
              </button>
            </>
          ) 
          : (
            <>
              <div>Error: {payResult.error.error}</div>
              {payResult.error.stack && <pre className="mt-2 mb-0 small">{payResult.error.stack}</pre>}
            </>
          )}
        </div>
      )}
    </>
    )
  }



  const renderMyOrdersView = function() {
    return (
    <>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h3 className="h5 mb-0">My Orders</h3>
        <button 
          className="btn btn-sm btn-outline-secondary"
          onClick={loadMyOrders}
          disabled={loading}
        >
          Refresh
        </button>
      </div>

      {!actingCustomerEmail ? (
        <div className="alert alert-info">
          Please select an acting customer from the global selector above to view orders.
        </div>
      ) : myOrders.length === 0 ? (
        <div className="alert alert-info">
          You haven't placed any orders yet. Go to the "Browse & Order" tab to start ordering!
        </div>
      ) : (
        <div className="table-responsive">
          <table className="table table-hover">
            <thead className="table-light">
              <tr>
                <th>Order #</th>
                <th>Restaurant</th>
                <th>Total</th>
                <th>Status</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {myOrders.map(function(order) {
                const isPaid = order.paymentMethod || order.payment
                return (
                  <tr key={order.orderId}>
                    <td><strong>#{order.orderId}</strong></td>
                    <td>{order.restaurantName}</td>
                    <td>€{Number(order.totalAmount).toFixed(2)}</td>
                    <td>{getOrderStatusBadge(order)}</td>
                    <td>{new Date(order.createdAt).toLocaleString()}</td>
                    <td>
                      {!isPaid && (
                        <div className="btn-group btn-group-sm" role="group">
                          <button
                            className="btn btn-outline-primary"
                            onClick={function() {
                              handlePay(order.orderId, 'card')
                            }}
                            disabled={loading}
                          >
                            Pay (Card)
                          </button>
                          <button
                            className="btn btn-outline-primary"
                            onClick={function() {
                              handlePay(order.orderId, 'cash')
                            }}
                            disabled={loading}
                          >
                            Cash
                          </button>
                          <button
                            className="btn btn-outline-primary"
                            onClick={function() {
                              handlePay(order.orderId, 'paypal')
                            }}
                            disabled={loading}
                          >
                            PayPal
                          </button>
                        </div>
                      )}
                      
                      {isPaid && (
                        <span className="text-success small">✓ Paid</span>
                      )}
                    </td>
                  </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
      )}


      {payResult && (
        <div className={`alert mt-3 ${payResult.success ? 'alert-success' : 'alert-danger'}`}>
          {payResult.success ? (
            <div>Payment successful! Order status updated.</div>
          ) : (
            <>
              <div>Error: {payResult.error.error}</div>
              {payResult.error.stack && <pre className="mt-2 mb-0 small">{payResult.error.stack}</pre>}
            </>
          )}
        </div>
      )}
    </>
    )
  }



  const renderAnalyticsView = function() {
    return (
    <>
      <h3 className="h5 mb-3">Order Analytics Report</h3>
      <p className="text-muted">View order history and payment data by restaurant.</p>
      
      <form onSubmit={handleReport}>
        <div className="row g-3">
          <div className="col-md-6">
            <label className="form-label">Restaurant</label>
            <select
              className="form-select"
              value={reportForm.restaurantName}
              onChange={function(e) {
                setReportForm({ ...reportForm, restaurantName: e.target.value })
              }}
              required
            >
              <option value="">Select a restaurant...</option>
              {restaurants.map(function(restaurant) {
                return (
                  <option key={restaurant.name} value={restaurant.name}>
                    {restaurant.name}
                  </option>
                  )
                })}
            </select>
          </div>
          
          <div className="col-md-3">
            <label className="form-label">From (optional)</label>
            <input
              type="datetime-local"
              className="form-control"
              value={reportForm.from}
              onChange={function(e) {
                setReportForm({ ...reportForm, from: e.target.value })
              }}
            />
          </div>
          
          <div className="col-md-3">
            <label className="form-label">To (optional)</label>
            <input
              type="datetime-local"
              className="form-control"
              value={reportForm.to}
              onChange={function(e) {
                setReportForm({ ...reportForm, to: e.target.value })
              }}
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
                        {Object.keys(reportResult.data.rows[0]).map(function(key) {
                          return (
                            <th key={key}>{key}</th>
                            )
                          })}
                      </tr>
                    </thead>
                    <tbody>
                      {reportResult.data.rows.map(function(row, idx) {
                        return (
                          <tr key={idx}>
                            {Object.values(row).map(function(val, i) {
                              return (
                                <td key={i}>{val != null ? JSON.stringify(val) : '-'}</td>
                                )
                              })}
                          </tr>
                          )
                        })}
                    </tbody>
                  </table>
                </div>
              ) 
              : (
                <p className="mt-2 mb-0">No data found for the selected criteria.</p>
              )}
            </>
          ) 
          : (
            <>
              <div>Error: {reportResult.error.error}</div>
              {reportResult.error.stack && <pre className="mt-2 mb-0 small">{reportResult.error.stack}</pre>}
            </>
          )}
        </div>
      )}
    </>
    )
  }



  return (
    <div className="card mb-4">
      <div className="card-body">
        <div className="d-flex justify-content-between align-items-center mb-4">
          <h2 className="card-title mb-0">Customer Ordering</h2>
          <div className="btn-group" role="group">
            <button
              type="button"
              className={`btn btn-sm ${view === 'order' ? 'btn-primary' : 'btn-outline-primary'}`}
              onClick={function() {
                setView('order')
              }}
            >
              Browse & Order
            </button>
            <button
              type="button"
              className={`btn btn-sm ${view === 'myorders' ? 'btn-primary' : 'btn-outline-primary'}`}
              onClick={function() {
                setView('myorders')
              }}
            >
              My Orders
            </button>
            <button
              type="button"
              className={`btn btn-sm ${view === 'analytics' ? 'btn-primary' : 'btn-outline-primary'}`}
              onClick={function() {
                setView('analytics')
              }}
            >
              Analytics
            </button>
          </div>
        </div>

        {!actingCustomerEmail && view === 'order' && (
          <div className="alert alert-warning" role="alert">
            <strong>Note:</strong> Please select an acting customer from the global selector above to place orders.
          </div>
        )}

        {view === 'order' && renderOrderView()}
        {view === 'myorders' && renderMyOrdersView()}
        {view === 'analytics' && renderAnalyticsView()}
      </div>
    </div>
    )
  }

export default Student1Section
