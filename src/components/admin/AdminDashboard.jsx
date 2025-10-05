import React, { useState, useEffect } from 'react';
import { 
  Users, 
  Building, 
  DollarSign, 
  Calendar,
  CreditCard,
  AlertCircle,
  CheckCircle,
  Clock,
  Plus,
  Filter,
  Download,
  Edit,
  Trash2,
  UserPlus,
  Home,
  Bell
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import './AdminDashboard.css';

const AdminDashboard = ({ user, onLogout }) => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [tenants, setTenants] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [paymentSummary, setPaymentSummary] = useState({});
  const [loading, setLoading] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());

  // API functions
  const fetchTenants = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/admin/tenants', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      if (data.success) {
        setTenants(data.tenants);
      }
    } catch (error) {
      console.error('Error fetching tenants:', error);
      toast.error('Failed to fetch tenants');
    }
  };

  const fetchRooms = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/admin/rooms', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      if (data.success) {
        setRooms(data.rooms);
      }
    } catch (error) {
      console.error('Error fetching rooms:', error);
      toast.error('Failed to fetch rooms');
    }
  };

  const fetchPaymentSummary = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/admin/payments/summary?month=${selectedMonth}&year=${selectedYear}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      if (data.success) {
        setPaymentSummary(data.summary);
      }
    } catch (error) {
      console.error('Error fetching payment summary:', error);
      toast.error('Failed to fetch payment summary');
    }
  };

  const generateBills = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const response = await fetch('/api/admin/bills/generate', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          month: selectedMonth,
          year: selectedYear
        })
      });
      const data = await response.json();
      if (data.success) {
        toast.success(`Generated ${data.bills} bills successfully`);
        fetchPaymentSummary();
      } else {
        toast.error(data.error || 'Failed to generate bills');
      }
    } catch (error) {
      console.error('Error generating bills:', error);
      toast.error('Failed to generate bills');
    } finally {
      setLoading(false);
    }
  };

  const addRoom = async (roomData) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/admin/rooms', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(roomData)
      });
      const data = await response.json();
      if (data.success) {
        toast.success('Room added successfully');
        fetchRooms();
        return data.room;
      } else {
        toast.error(data.error || 'Failed to add room');
      }
    } catch (error) {
      console.error('Error adding room:', error);
      toast.error('Failed to add room');
    }
  };

  const assignTenant = async (roomId, tenantData) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/admin/rooms/${roomId}/assign-tenant`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(tenantData)
      });
      const data = await response.json();
      if (data.success) {
        toast.success('Tenant assigned successfully');
        toast.success(`Login: ${data.tenant.generatedUsername} / ${data.tenant.generatedPassword}`);
        fetchTenants();
        fetchRooms();
        return data.tenant;
      } else {
        toast.error(data.error || 'Failed to assign tenant');
      }
    } catch (error) {
      console.error('Error assigning tenant:', error);
      toast.error('Failed to assign tenant');
    }
  };

  useEffect(() => {
    fetchTenants();
    fetchRooms();
    fetchPaymentSummary();
  }, [selectedMonth, selectedYear]);

  // Dashboard Overview Component
  const DashboardOverview = () => (
    <div className="dashboard-overview">
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-header">
            <Users size={24} />
            <h3>Total Tenants</h3>
          </div>
          <div className="stat-value">{tenants.length}</div>
          <div className="stat-subtitle">
            Active: {tenants.filter(t => t.status === 'active').length}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-header">
            <Building size={24} />
            <h3>Total Rooms</h3>
          </div>
          <div className="stat-value">{rooms.length}</div>
          <div className="stat-subtitle">
            Occupied: {rooms.filter(r => r.status === 'occupied').length}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-header">
            <DollarSign size={24} />
            <h3>Monthly Revenue</h3>
          </div>
          <div className="stat-value">₹{paymentSummary.totalReceived?.toLocaleString() || 0}</div>
          <div className="stat-subtitle">
            Payments: {paymentSummary.paymentsCount || 0}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-header">
            <AlertCircle size={24} />
            <h3>Pending Dues</h3>
          </div>
          <div className="stat-value">₹{paymentSummary.totalPending?.toLocaleString() || 0}</div>
          <div className="stat-subtitle">
            Bills: {paymentSummary.pendingBills || 0}
          </div>
        </div>
      </div>

      <div className="month-filter">
        <select 
          value={selectedMonth} 
          onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
        >
          {Array.from({ length: 12 }, (_, i) => (
            <option key={i + 1} value={i + 1}>
              {new Date(2024, i).toLocaleString('default', { month: 'long' })}
            </option>
          ))}
        </select>
        <select 
          value={selectedYear} 
          onChange={(e) => setSelectedYear(parseInt(e.target.value))}
        >
          {Array.from({ length: 5 }, (_, i) => (
            <option key={2020 + i} value={2020 + i}>
              {2020 + i}
            </option>
          ))}
        </select>
        <button onClick={generateBills} disabled={loading} className="generate-bills-btn">
          {loading ? 'Generating...' : 'Generate Bills'}
        </button>
      </div>

      {paymentSummary.pendingBillsDetails && paymentSummary.pendingBillsDetails.length > 0 && (
        <div className="pending-bills">
          <h3>Pending Bills</h3>
          <div className="bills-list">
            {paymentSummary.pendingBillsDetails.map(bill => (
              <div key={bill._id} className="bill-item">
                <div className="bill-info">
                  <strong>{bill.tenant.name}</strong>
                  <span>Room {bill.room.roomNumber}</span>
                  <span>₹{(bill.totalAmount + bill.penalty.amount).toLocaleString()}</span>
                </div>
                <div className={`bill-status ${bill.status}`}>
                  {bill.status.toUpperCase()}
                  {bill.penalty.amount > 0 && (
                    <span className="penalty">+₹{bill.penalty.amount} penalty</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  // Tenants Management Component
  const TenantsManagement = () => (
    <div className="tenants-management">
      <div className="section-header">
        <h2>Tenants Management</h2>
        <button className="add-btn" onClick={() => setActiveTab('add-room')}>
          <UserPlus size={20} />
          Add New Tenant
        </button>
      </div>

      <div className="tenants-grid">
        {tenants.map(tenant => (
          <div key={tenant._id} className="tenant-card">
            <div className="tenant-header">
              <div className="tenant-avatar">
                {tenant.profilePhoto ? (
                  <img src={tenant.profilePhoto} alt={tenant.name} />
                ) : (
                  <Users size={24} />
                )}
              </div>
              <div className="tenant-info">
                <h3>{tenant.name}</h3>
                <span className="username">@{tenant.username}</span>
                <span className={`status ${tenant.status}`}>{tenant.status}</span>
              </div>
            </div>

            <div className="tenant-details">
              <div className="detail-row">
                <span>Room:</span>
                <span>{tenant.room ? tenant.room.roomNumber : 'Not assigned'}</span>
              </div>
              <div className="detail-row">
                <span>Phone:</span>
                <span>{tenant.phone}</span>
              </div>
              <div className="detail-row">
                <span>Email:</span>
                <span>{tenant.email}</span>
              </div>
              <div className="detail-row">
                <span>Security Deposit:</span>
                <span>₹{tenant.securityDepositPaid?.toLocaleString() || 0}</span>
              </div>
              {tenant.moveInDate && (
                <div className="detail-row">
                  <span>Move In:</span>
                  <span>{new Date(tenant.moveInDate).toLocaleDateString()}</span>
                </div>
              )}
            </div>

            <div className="tenant-actions">
              <button className="edit-btn">
                <Edit size={16} />
                Edit
              </button>
              <button className="view-btn">
                View Profile
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // Rooms Management Component
  const RoomsManagement = () => (
    <div className="rooms-management">
      <div className="section-header">
        <h2>Rooms Management</h2>
        <button className="add-btn" onClick={() => setActiveTab('add-room')}>
          <Plus size={20} />
          Add New Room
        </button>
      </div>

      <div className="rooms-grid">
        {rooms.map(room => (
          <div key={room._id} className="room-card">
            <div className="room-header">
              <div className="room-number">
                <Home size={24} />
                <span>Room {room.roomNumber}</span>
              </div>
              <span className={`room-status ${room.status}`}>
                {room.status.toUpperCase()}
              </span>
            </div>

            <div className="room-details">
              <div className="detail-row">
                <span>Type:</span>
                <span>{room.type}</span>
              </div>
              <div className="detail-row">
                <span>Size:</span>
                <span>{room.size}</span>
              </div>
              <div className="detail-row">
                <span>Rent:</span>
                <span>₹{room.rent.toLocaleString()}/month</span>
              </div>
              <div className="detail-row">
                <span>Security Deposit:</span>
                <span>₹{room.securityDeposit.toLocaleString()}</span>
              </div>
              {room.currentTenant && (
                <div className="current-tenant">
                  <h4>Current Tenant:</h4>
                  <p>{room.currentTenant.name}</p>
                  <p>{room.currentTenant.phone}</p>
                </div>
              )}
            </div>

            <div className="room-utilities">
              <h4>Utilities:</h4>
              <div className="utilities-list">
                {Object.entries(room.utilities).map(([utility, details]) => (
                  <div key={utility} className="utility-item">
                    <span className="utility-name">{utility}:</span>
                    <span className={details.included ? 'included' : 'not-included'}>
                      {details.included ? 'Included' : `₹${details.rate}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="room-actions">
              <button className="edit-btn">
                <Edit size={16} />
                Edit
              </button>
              {room.status === 'vacant' && (
                <button 
                  className="assign-btn"
                  onClick={() => {/* Open assign tenant modal */}}
                >
                  <UserPlus size={16} />
                  Assign Tenant
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // Add Room/Tenant Component
  const AddRoomComponent = () => {
    const [roomData, setRoomData] = useState({
      roomNumber: '',
      floor: '',
      type: '1BHK',
      size: '',
      rent: '',
      securityDeposit: '',
      utilities: {
        electricity: { included: false, rate: 0 },
        water: { included: true, rate: 0 },
        gas: { included: false, rate: 0 },
        internet: { included: false, rate: 0 },
        parking: { included: false, rate: 0 },
        maintenance: { included: true, rate: 0 }
      },
      description: '',
      amenities: []
    });

    const [tenantData, setTenantData] = useState({
      name: '',
      email: '',
      phone: '',
      emergencyContact: {
        name: '',
        phone: '',
        relationship: ''
      },
      moveInDate: '',
      securityDepositPaid: ''
    });

    const [assignTenantImmediately, setAssignTenantImmediately] = useState(false);

    const handleSubmit = async (e) => {
      e.preventDefault();
      setLoading(true);

      try {
        const newRoom = await addRoom(roomData);
        
        if (newRoom && assignTenantImmediately) {
          await assignTenant(newRoom._id, tenantData);
        }

        // Reset form
        setRoomData({
          roomNumber: '',
          floor: '',
          type: '1BHK',
          size: '',
          rent: '',
          securityDeposit: '',
          utilities: {
            electricity: { included: false, rate: 0 },
            water: { included: true, rate: 0 },
            gas: { included: false, rate: 0 },
            internet: { included: false, rate: 0 },
            parking: { included: false, rate: 0 },
            maintenance: { included: true, rate: 0 }
          },
          description: '',
          amenities: []
        });
        setTenantData({
          name: '',
          email: '',
          phone: '',
          emergencyContact: { name: '', phone: '', relationship: '' },
          moveInDate: '',
          securityDepositPaid: ''
        });
      } catch (error) {
        console.error('Error:', error);
      } finally {
        setLoading(false);
      }
    };

    return (
      <div className="add-room-component">
        <h2>Add New Room</h2>
        
        <form onSubmit={handleSubmit} className="add-room-form">
          <div className="form-section">
            <h3>Room Details</h3>
            <div className="form-grid">
              <input
                type="text"
                placeholder="Room Number"
                value={roomData.roomNumber}
                onChange={(e) => setRoomData({...roomData, roomNumber: e.target.value})}
                required
              />
              <input
                type="number"
                placeholder="Floor"
                value={roomData.floor}
                onChange={(e) => setRoomData({...roomData, floor: parseInt(e.target.value)})}
              />
              <select
                value={roomData.type}
                onChange={(e) => setRoomData({...roomData, type: e.target.value})}
                required
              >
                <option value="1BHK">1BHK</option>
                <option value="2BHK">2BHK</option>
                <option value="3BHK">3BHK</option>
                <option value="Studio">Studio</option>
                <option value="Single">Single</option>
                <option value="Shared">Shared</option>
              </select>
              <input
                type="text"
                placeholder="Size (e.g., 400 sqft)"
                value={roomData.size}
                onChange={(e) => setRoomData({...roomData, size: e.target.value})}
              />
              <input
                type="number"
                placeholder="Monthly Rent"
                value={roomData.rent}
                onChange={(e) => setRoomData({...roomData, rent: parseInt(e.target.value)})}
                required
              />
              <input
                type="number"
                placeholder="Security Deposit"
                value={roomData.securityDeposit}
                onChange={(e) => setRoomData({...roomData, securityDeposit: parseInt(e.target.value)})}
                required
              />
            </div>

            <div className="utilities-section">
              <h4>Utilities</h4>
              <div className="utilities-grid">
                {Object.entries(roomData.utilities).map(([utility, details]) => (
                  <div key={utility} className="utility-config">
                    <label>
                      <input
                        type="checkbox"
                        checked={details.included}
                        onChange={(e) => setRoomData({
                          ...roomData,
                          utilities: {
                            ...roomData.utilities,
                            [utility]: {
                              ...details,
                              included: e.target.checked
                            }
                          }
                        })}
                      />
                      {utility.charAt(0).toUpperCase() + utility.slice(1)} Included
                    </label>
                    {!details.included && (
                      <input
                        type="number"
                        placeholder="Rate"
                        value={details.rate}
                        onChange={(e) => setRoomData({
                          ...roomData,
                          utilities: {
                            ...roomData.utilities,
                            [utility]: {
                              ...details,
                              rate: parseInt(e.target.value) || 0
                            }
                          }
                        })}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="tenant-assignment-section">
            <label className="assign-tenant-checkbox">
              <input
                type="checkbox"
                checked={assignTenantImmediately}
                onChange={(e) => setAssignTenantImmediately(e.target.checked)}
              />
              Assign tenant immediately
            </label>

            {assignTenantImmediately && (
              <div className="tenant-form-section">
                <h3>Tenant Details</h3>
                <div className="form-grid">
                  <input
                    type="text"
                    placeholder="Full Name"
                    value={tenantData.name}
                    onChange={(e) => setTenantData({...tenantData, name: e.target.value})}
                    required={assignTenantImmediately}
                  />
                  <input
                    type="email"
                    placeholder="Email"
                    value={tenantData.email}
                    onChange={(e) => setTenantData({...tenantData, email: e.target.value})}
                    required={assignTenantImmediately}
                  />
                  <input
                    type="tel"
                    placeholder="Phone Number"
                    value={tenantData.phone}
                    onChange={(e) => setTenantData({...tenantData, phone: e.target.value})}
                    required={assignTenantImmediately}
                  />
                  <input
                    type="date"
                    placeholder="Move In Date"
                    value={tenantData.moveInDate}
                    onChange={(e) => setTenantData({...tenantData, moveInDate: e.target.value})}
                    required={assignTenantImmediately}
                  />
                  <input
                    type="number"
                    placeholder="Security Deposit Paid"
                    value={tenantData.securityDepositPaid}
                    onChange={(e) => setTenantData({...tenantData, securityDepositPaid: e.target.value})}
                  />
                </div>

                <div className="emergency-contact">
                  <h4>Emergency Contact</h4>
                  <div className="form-grid">
                    <input
                      type="text"
                      placeholder="Emergency Contact Name"
                      value={tenantData.emergencyContact.name}
                      onChange={(e) => setTenantData({
                        ...tenantData,
                        emergencyContact: {
                          ...tenantData.emergencyContact,
                          name: e.target.value
                        }
                      })}
                    />
                    <input
                      type="tel"
                      placeholder="Emergency Contact Phone"
                      value={tenantData.emergencyContact.phone}
                      onChange={(e) => setTenantData({
                        ...tenantData,
                        emergencyContact: {
                          ...tenantData.emergencyContact,
                          phone: e.target.value
                        }
                      })}
                    />
                    <input
                      type="text"
                      placeholder="Relationship"
                      value={tenantData.emergencyContact.relationship}
                      onChange={(e) => setTenantData({
                        ...tenantData,
                        emergencyContact: {
                          ...tenantData.emergencyContact,
                          relationship: e.target.value
                        }
                      })}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="form-actions">
            <button type="button" onClick={() => setActiveTab('dashboard')}>
              Cancel
            </button>
            <button type="submit" disabled={loading}>
              {loading ? 'Adding...' : 'Add Room'}
            </button>
          </div>
        </form>
      </div>
    );
  };

  return (
    <div className="admin-dashboard">
      <nav className="admin-nav">
        <div className="nav-header">
          <h1>Admin Panel</h1>
          <span>Welcome, {user.name}</span>
        </div>
        
        <div className="nav-tabs">
          <button 
            className={activeTab === 'dashboard' ? 'active' : ''}
            onClick={() => setActiveTab('dashboard')}
          >
            <DollarSign size={20} />
            Dashboard
          </button>
          <button 
            className={activeTab === 'tenants' ? 'active' : ''}
            onClick={() => setActiveTab('tenants')}
          >
            <Users size={20} />
            Tenants
          </button>
          <button 
            className={activeTab === 'rooms' ? 'active' : ''}
            onClick={() => setActiveTab('rooms')}
          >
            <Building size={20} />
            Rooms
          </button>
          <button 
            className={activeTab === 'add-room' ? 'active' : ''}
            onClick={() => setActiveTab('add-room')}
          >
            <Plus size={20} />
            Add Room
          </button>
          <button 
            className={activeTab === 'notifications' ? 'active' : ''}
            onClick={() => setActiveTab('notifications')}
          >
            <Bell size={20} />
            Notifications
          </button>
        </div>

        <button className="logout-btn" onClick={onLogout}>
          Logout
        </button>
      </nav>

      <main className="admin-content">
        {activeTab === 'dashboard' && <DashboardOverview />}
        {activeTab === 'tenants' && <TenantsManagement />}
        {activeTab === 'rooms' && <RoomsManagement />}
        {activeTab === 'add-room' && <AddRoomComponent />}
      </main>
    </div>
  );
};

export default AdminDashboard;