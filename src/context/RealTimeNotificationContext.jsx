import { createContext, useContext, useState, useEffect } from 'react'
import { toast } from 'react-hot-toast'

const RealTimeNotificationContext = createContext()

export const useRealTimeNotifications = () => {
  const context = useContext(RealTimeNotificationContext)
  if (!context) {
    throw new Error('useRealTimeNotifications must be used within a RealTimeNotificationProvider')
  }
  return context
}

const WS_URL = 'ws://localhost:3001'
const API_URL = 'http://localhost:3001/api'

export const RealTimeNotificationProvider = ({ children }) => {
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState('disconnected')
  const [ws, setWs] = useState(null)

  // WebSocket connection management
  useEffect(() => {
    let websocket = null
    let reconnectTimeout = null
    let maxRetries = 3
    let retryCount = 0

    const connect = () => {
      try {
        console.log('🔗 [RealTimeContext] Connecting to WebSocket server at', WS_URL)
        setConnectionStatus('connecting')
        websocket = new WebSocket(WS_URL)
        
        websocket.onopen = () => {
          console.log('✅ [RealTimeContext] WebSocket connected successfully')
          setConnectionStatus('connected')
          setWs(websocket)
          retryCount = 0
          
          if (reconnectTimeout) {
            clearTimeout(reconnectTimeout)
            reconnectTimeout = null
          }
          
          // Request initial notifications immediately after connection
          console.log('📞 [RealTimeContext] Requesting initial notifications')
        }
        
        websocket.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data)
            console.log('📨 [RealTimeContext] WebSocket message:', data.type)
            
            switch (data.type) {
              case 'INITIAL_NOTIFICATIONS':
                console.log(`📋 [RealTimeContext] Loading ${data.notifications.length} initial notifications`)
                setNotifications(data.notifications)
                localStorage.setItem('notifications', JSON.stringify(data.notifications))
                console.log('✅ [RealTimeContext] Initial notifications set in state')
                break
                
              case 'NEW_NOTIFICATION':
                console.log('🚀 [RealTimeContext] New notification received:', data.notification.title)
                setNotifications(data.allNotifications)
                localStorage.setItem('notifications', JSON.stringify(data.allNotifications))
                
                toast.success(`New notification: ${data.notification.title}`, {
                  duration: 4000,
                  icon: '🔔'
                })
                break
                
              case 'NOTIFICATION_DELETED':
                console.log('🗑️ Real-time notification deleted:', data.deletedId)
                console.log('🗑️ Deleted notification:', data.deletedNotification)
                setNotifications(data.allNotifications)
                // Update localStorage for cross-tab sync
                localStorage.setItem('notifications', JSON.stringify(data.allNotifications))
                
                // Show toast for deleted notification
                if (data.deletedNotification) {
                  toast.success(`Notification deleted: ${data.deletedNotification.title}`, {
                    duration: 3000,
                    icon: '🗑️'
                  })
                } else {
                  toast.success('Notification deleted successfully', {
                    duration: 2000,
                    icon: '✅'
                  })
                }
                break
                
              case 'OWNER_PROFILE_UPDATED':
                console.log('🔄 Owner profile updated:', data.profileData.name)
                // Dispatch custom event for profile updates
                window.dispatchEvent(new CustomEvent('ownerProfileUpdated', {
                  detail: data.profileData
                }))
                
                toast.success('Owner profile updated successfully!', {
                  duration: 3000,
                  icon: '🔄'
                })
                break
                
              case 'TENANT_PROFILE_UPDATED':
                console.log('🔄 Tenant profile updated:', data.profileData.name)
                // Dispatch custom event for profile updates
                window.dispatchEvent(new CustomEvent('tenantProfileUpdated', {
                  detail: data.profileData
                }))
                
                toast.success('Tenant profile updated successfully!', {
                  duration: 3000,
                  icon: '🔄'
                })
                break
                
              default:
                console.log('📨 Unknown message type:', data.type)
            }
          } catch (error) {
            console.error('❌ Error parsing WebSocket message:', error)
          }
        }
        
        websocket.onclose = (event) => {
          console.log('🔌 [RealTimeContext] WebSocket disconnected:', event.code, event.reason)
          setConnectionStatus('disconnected')
          setWs(null)
          
          // Always attempt to reconnect if not manually closed
          if (event.code !== 1000 && !reconnectTimeout) {
            retryCount++
            console.log(`🔄 [RealTimeContext] Auto-reconnecting... (attempt ${retryCount})`)
            reconnectTimeout = setTimeout(() => {
              reconnectTimeout = null
              connect()
            }, Math.min(1000 * retryCount, 10000)) // Exponential backoff, max 10s
          }
        }
        
        websocket.onerror = (error) => {
          console.error('❌ WebSocket error:', error)
          setConnectionStatus('error')
        }
        
      } catch (error) {
        console.error('❌ Failed to create WebSocket connection:', error)
        setConnectionStatus('error')
        retryCount++
        
        // Fallback to localStorage immediately
        loadFromLocalStorage()
        
        // Try to reconnect if we haven't exceeded max retries
        if (retryCount < maxRetries && !reconnectTimeout) {
          console.log(`🔄 Retrying connection... (${retryCount}/${maxRetries})`)
          reconnectTimeout = setTimeout(() => {
            connect()
          }, 5000)
        } else {
          console.log('⚠️ WebSocket server unavailable. Using offline mode only.')
          setConnectionStatus('offline')
        }
      }
    }

    // Load from localStorage and API immediately to prevent blank pages
    const initializeNotifications = async () => {
      console.log('🚀 [RealTimeContext] Initializing notifications...')
      
      // Try API first for most up-to-date data
      try {
        const response = await fetch(`${API_URL}/notifications`, {
          cache: 'no-cache',
          headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        })
        
        if (response.ok) {
          const data = await response.json()
          console.log(`🌍 [RealTimeContext] Loaded ${data.notifications.length} notifications from API`)
          setNotifications(data.notifications)
          localStorage.setItem('notifications', JSON.stringify(data.notifications))
          return // Successfully loaded from API
        }
      } catch (apiError) {
        console.log('📞 [RealTimeContext] API not available, falling back to localStorage:', apiError.message)
      }
      
      // Fallback to localStorage if API fails
      loadFromLocalStorage()
    }
    
    // Initialize notifications first, then WebSocket
    initializeNotifications().then(() => {
      console.log('✅ [RealTimeContext] Initial notifications loaded, starting WebSocket...')
      connect()
    })

    // Cleanup on unmount
    return () => {
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout)
      }
      if (websocket) {
        websocket.close()
      }
    }
  }, [])

  // Fallback to localStorage when WebSocket isn't available
  const loadFromLocalStorage = () => {
    try {
      const stored = localStorage.getItem('notifications')
      if (stored) {
        const localNotifications = JSON.parse(stored)
        console.log(`💾 Loaded ${localNotifications.length} notifications from localStorage`)
        setNotifications(localNotifications)
      }
    } catch (error) {
      console.error('❌ Error loading from localStorage:', error)
    }
  }

  // Add new notification
  const addNotification = async (notificationData) => {
    setLoading(true)
    try {
      console.log('🚀 Adding notification via API:', notificationData)
      
      const response = await fetch(`${API_URL}/notifications`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(notificationData)
      })
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      
      const result = await response.json()
      console.log(`✅ Notification sent to ${result.broadcastedTo} clients via WebSocket`)
      
      toast.success(`Notification sent: ${result.notification.title}`, {
        duration: 3000,
        icon: '✅'
      })
      
      return result.notification
    } catch (error) {
      console.warn('⚠️ API failed, using localStorage fallback:', error.message)
      
      // Fallback to localStorage if API fails
      try {
        const newNotification = {
          id: Date.now() + Math.random(),
          ...notificationData,
          timestamp: Date.now(),
          date: new Date().toISOString(),
          read: false,
          author: notificationData.author || 'Building Management'
        }
        
        const current = JSON.parse(localStorage.getItem('notifications') || '[]')
        const updated = [newNotification, ...current]
        localStorage.setItem('notifications', JSON.stringify(updated))
        
        setNotifications(updated)
        
        toast.success(`Notification sent: ${newNotification.title} (offline mode)`, {
          duration: 3000,
          icon: '✅'
        })
        
        return newNotification
      } catch (fallbackError) {
        console.error('❌ Fallback failed:', fallbackError)
        toast.error('Failed to send notification')
        throw fallbackError
      }
    } finally {
      setLoading(false)
    }
  }

  // Get notifications for specific tenant
  const getNotificationsForTenant = (tenantId) => {
    const filtered = notifications.filter(notification => {
      // Common notifications visible to all tenants
      if (notification.type === 'common') {
        return true
      }
      
      // Personal notifications only for specific tenant
      if (notification.type === 'personal') {
        return notification.tenantId == tenantId || 
               (notification.tenantIds && notification.tenantIds.includes(tenantId))
      }
      
      return false
    })
    
    console.log(`🔍 [Context] Filtered ${filtered.length}/${notifications.length} notifications for tenant ${tenantId}`)
    return filtered
  }

  // Mark notification as read
  const markAsRead = async (notificationId) => {
    try {
      console.log(`✅ Marking notification ${notificationId} as read`)
      
      const response = await fetch(`${API_URL}/notifications/${notificationId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ read: true })
      })
      
      if (response.ok) {
        // Update local state immediately
        setNotifications(prev => 
          prev.map(n => n.id == notificationId ? { ...n, read: true } : n)
        )
      }
    } catch (error) {
      console.error('❌ Error marking as read:', error)
      // Update local state anyway
      setNotifications(prev => 
        prev.map(n => n.id == notificationId ? { ...n, read: true } : n)
      )
    }
  }

  // Delete notification with comprehensive real-time synchronization
  const deleteNotification = async (notificationId) => {
    try {
      console.log(`🗑️ [RealTimeContext] Deleting notification ${notificationId}`)
      
      // Find the notification being deleted for logging
      const deletedNotification = notifications.find(n => n.id == notificationId)
      if (deletedNotification) {
        console.log(`🗑️ [RealTimeContext] Deleting: "${deletedNotification.title}"`)
      }
      
      const response = await fetch(`${API_URL}/notifications/${notificationId}`, {
        method: 'DELETE'
      })
      
      if (response.ok) {
        console.log('✅ [RealTimeContext] Notification deleted successfully via API')
        const result = await response.json()
        console.log(`📡 [RealTimeContext] Deletion broadcast to ${result.broadcastedTo || 'N/A'} WebSocket clients`)
        
        // Update local state immediately
        const updatedNotifications = notifications.filter(n => n.id != notificationId)
        setNotifications(updatedNotifications)
        
        // Update localStorage for cross-tab sync
        localStorage.setItem('notifications', JSON.stringify(updatedNotifications))
        console.log(`💾 [RealTimeContext] Updated localStorage with ${updatedNotifications.length} notifications`)
        
        // Show success toast (but only if not from WebSocket to avoid double toasts)
        if (deletedNotification) {
          toast.success(`Notification deleted: ${deletedNotification.title}`, {
            duration: 2000,
            icon: '🗑️',
          })
        } else {
          toast.success('Notification deleted successfully', {
            duration: 2000,
            icon: '✅',
          })
        }
      } else {
        console.error(`❌ [RealTimeContext] API delete failed: ${response.status} ${response.statusText}`)
        // Still try to update local state for immediate UI feedback
        setNotifications(prev => prev.filter(n => n.id != notificationId))
        localStorage.setItem('notifications', JSON.stringify(notifications.filter(n => n.id != notificationId)))
      }
    } catch (error) {
      console.error('❌ [RealTimeContext] Error deleting notification:', error)
      // Update local state anyway for immediate UI feedback
      const updatedNotifications = notifications.filter(n => n.id != notificationId)
      setNotifications(updatedNotifications)
      localStorage.setItem('notifications', JSON.stringify(updatedNotifications))
      
      toast.error('Failed to delete notification from server, but removed locally')
    }
  }

  // Force refresh
  const forceRefresh = async () => {
    console.log('🔄 Force refreshing notifications...')
    if (connectionStatus === 'connected') {
      // WebSocket will handle updates automatically
      console.log('✅ Using WebSocket for real-time updates')
    } else {
      // Fall back to API or localStorage
      try {
        const response = await fetch(`${API_URL}/notifications`)
        if (response.ok) {
          const data = await response.json()
          setNotifications(data.notifications)
        }
      } catch (error) {
        loadFromLocalStorage()
      }
    }
  }

  // Update unread count whenever notifications change
  useEffect(() => {
    const count = notifications.filter(n => !n.read).length
    setUnreadCount(count)
  }, [notifications])

  // Add debug information to window for easy debugging
  if (typeof window !== 'undefined') {
    window.realTimeNotificationDebug = {
      notifications,
      unreadCount,
      connectionStatus,
      loading,
      wsUrl: WS_URL,
      apiUrl: API_URL
    }
  }

  const value = {
    notifications,
    unreadCount,
    loading,
    connectionStatus,
    addNotification,
    getNotificationsForTenant,
    markAsRead,
    deleteNotification,
    forceRefresh
  }

  return (
    <RealTimeNotificationContext.Provider value={value}>
      {children}
    </RealTimeNotificationContext.Provider>
  )
}

export default RealTimeNotificationContext