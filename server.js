// Load environment variables
require('dotenv').config();

const express = require('express');
const http = require('http');
const cors = require('cors');
const mongoose = require('mongoose');
const { WebSocketServer } = require('ws');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cron = require('node-cron');
const connectDB = require('./config/database');
const { Owner, Room, Tenant, Bill, Payment, Notification } = require('./models');
const emailService = require('./backend/services/emailService');

// Import route modules
const tenantRoutes = require('./backend/routes/tenant');
const paymentRoutes = require('./backend/routes/payments');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key';
// Connect to MongoDB
connectDB();

// Middleware
app.use(cors());
// Increase body size limits to allow base64 profile photos and documents
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Use route modules
app.use('/api/tenant', tenantRoutes);
app.use('/api/payments', paymentRoutes);

// Create HTTP server and WebSocket server
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Store connected WebSocket clients
const connectedClients = new Set();

// WebSocket connection handling
wss.on('connection', (ws, request) => {
  console.log('🔗 New WebSocket client connected');
  connectedClients.add(ws);
  
  // Send initial notifications immediately when client connects
  setTimeout(async () => {
    try {
      const notifications = await Notification.find()
        .populate('recipients.tenant', 'name username')
        .sort({ createdAt: -1 })
        .limit(50);
      
      console.log(`📡 Sending ${notifications.length} initial notifications to new client`);
      
      ws.send(JSON.stringify({
        type: 'INITIAL_NOTIFICATIONS',
        notifications: notifications
      }));
    } catch (error) {
      console.error('❌ Error sending initial notifications:', error);
    }
  }, 100); // Small delay to ensure connection is ready
  
  // Handle incoming messages from client
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      console.log('📱 WebSocket received message:', data.type);
      
      if (data.type === 'GET_NOTIFICATIONS') {
        const notifications = await Notification.find()
          .populate('recipients.tenant', 'name username')
          .sort({ createdAt: -1 })
          .limit(50);
        
        console.log(`📡 Sending ${notifications.length} notifications to requesting client`);
        
        ws.send(JSON.stringify({
          type: 'INITIAL_NOTIFICATIONS',
          notifications: notifications
        }));
      }
    } catch (error) {
      console.error('❌ WebSocket message error:', error);
    }
  });
  
  ws.on('close', () => {
    console.log('🔌 WebSocket client disconnected');
    connectedClients.delete(ws);
  });
  
  ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error);
    connectedClients.delete(ws);
  });
});

// Broadcast to all WebSocket clients
function broadcastToClients(message) {
  const messageString = JSON.stringify(message);
  let activeClients = 0;
  
  connectedClients.forEach(client => {
    if (client.readyState === client.OPEN) {
      try {
        client.send(messageString);
        activeClients++;
      } catch (error) {
        console.error('❌ Error sending to client:', error);
        connectedClients.delete(client);
      }
    } else {
      connectedClients.delete(client);
    }
  });
  
  console.log(`📡 Broadcasted to ${activeClients} active clients`);
  return activeClients;
}

// JWT Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// ============= AUTH ROUTES =============

// Login route
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password, role } = req.body;

    let user;
    if (role === 'owner') {
      user = await Owner.findOne({ username });
    } else {
      user = await Tenant.findOne({ username }).populate('room');
    }

    if (!user || !await bcrypt.compare(password, user.password)) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { 
        id: user._id, 
        username: user.username, 
        role: role,
        name: user.name 
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        username: user.username,
        name: user.name,
        role: role,
        ...(role === 'tenant' && { 
          room: user.room,
          securityDepositPaid: user.securityDepositPaid 
        })
      }
    });
  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Forgot password - Step 1: Send verification code
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email, role } = req.body;

    if (!email || !role) {
      return res.status(400).json({ error: 'Email and role are required' });
    }

    // Find user by email and role
    let user;
    if (role === 'owner') {
      user = await Owner.findOne({ email });
    } else {
      user = await Tenant.findOne({ email });
    }

    if (!user) {
      return res.status(404).json({ error: 'No account found with this email address' });
    }

    // Send verification code
    const result = await emailService.sendVerificationCode(email, role);
    
    console.log(`🔐 Password reset requested for ${email} (${role})`);
    
    res.json({
      success: true,
      message: result.message,
      resetToken: result.resetToken,
      devMode: result.devMode,
      code: result.code // Only included in development mode
    });
  } catch (error) {
    console.error('❌ Forgot password error:', error);
    
    // Provide specific error message to user
    let userErrorMessage = 'Failed to send verification code';
    
    if (error.message.includes('authentication failed')) {
      userErrorMessage = 'Email service not configured properly. Please contact administrator.';
    } else if (error.message.includes('connect')) {
      userErrorMessage = 'Cannot connect to email server. Please try again later.';
    }
    
    res.status(500).json({ 
      error: userErrorMessage,
      details: error.message // For debugging
    });
  }
});

// Forgot password - Step 2: Verify code
app.post('/api/auth/verify-reset-code', async (req, res) => {
  try {
    const { email, code, resetToken } = req.body;

    if (!email || !code || !resetToken) {
      return res.status(400).json({ error: 'Email, code, and reset token are required' });
    }

    const result = emailService.verifyCode(email, code, resetToken);
    
    if (result.success) {
      console.log(`✅ Reset code verified for ${email}`);
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('❌ Code verification error:', error);
    res.status(500).json({ error: 'Failed to verify code' });
  }
});

// Forgot password - Step 3: Reset password
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { email, code, newPassword, resetToken } = req.body;

    if (!email || !code || !newPassword || !resetToken) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Validate password length
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    // Check if code is still verified and valid
    if (!emailService.isCodeVerified(email, resetToken)) {
      return res.status(400).json({ error: 'Verification code expired or invalid. Please start over.' });
    }

    // Find user by email (check both Owner and Tenant collections)
    let user = await Owner.findOne({ email });
    let userType = 'owner';
    
    if (!user) {
      user = await Tenant.findOne({ email });
      userType = 'tenant';
    }

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update password (the pre-save hook will hash it)
    user.password = newPassword;
    await user.save();

    console.log(`🔑 Password reset successfully for ${email} (${userType})`);

    // Send confirmation notification if it's a tenant
    if (userType === 'tenant') {
      try {
        const notification = new Notification({
          title: 'Password Reset Successful',
          message: 'Your password has been reset successfully. If you did not make this change, please contact building management immediately.',
          type: 'personal',
          category: 'info',
          priority: 'medium',
          recipients: [{
            tenant: user._id
          }]
        });
        await notification.save();
        
        // Broadcast notification
        broadcastToClients({
          type: 'NEW_NOTIFICATION',
          notification: await Notification.findById(notification._id)
            .populate('recipients.tenant', 'name username')
        });
      } catch (notifError) {
        console.error('❌ Failed to send password reset notification:', notifError);
        // Don't fail the password reset if notification fails
      }
    }

    res.json({
      success: true,
      message: 'Password reset successfully',
      userType
    });
  } catch (error) {
    console.error('❌ Password reset error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// ============= OWNER/ADMIN ROUTES =============

// Get all tenants
app.get('/api/admin/tenants', authenticateToken, async (req, res) => {
  try {
    const tenants = await Tenant.find()
      .populate('room', 'roomNumber type rent')
      .sort({ createdAt: -1 });
    
    res.json({ success: true, tenants });
  } catch (error) {
    console.error('❌ Error fetching tenants:', error);
    res.status(500).json({ error: 'Failed to fetch tenants' });
  }
});

// Update tenant (basic fields and optional room reassignment)
app.put('/api/admin/tenants/:tenantId', authenticateToken, async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { name, email, phone, roomId } = req.body || {};

    const tenant = await Tenant.findById(tenantId).populate('room');
    if (!tenant) return res.status(404).json({ success: false, error: 'Tenant not found' });

    // Update basic fields
    if (name) tenant.name = name;
    if (email) tenant.email = email;
    if (phone) tenant.phone = phone;

    // Handle room reassignment
    if (roomId && (!tenant.room || tenant.room._id.toString() !== roomId)) {
      // Vacate old room
      if (tenant.room) {
        await Room.findByIdAndUpdate(tenant.room._id, { currentTenant: null, status: 'vacant' });
      }
      // Assign new room (must be vacant)
      const newRoom = await Room.findById(roomId);
      if (!newRoom) return res.status(404).json({ success: false, error: 'New room not found' });
      if (newRoom.currentTenant) return res.status(400).json({ success: false, error: 'New room is occupied' });
      tenant.room = newRoom._id;
      await Room.findByIdAndUpdate(newRoom._id, { currentTenant: tenant._id, status: 'occupied' });
    }

    await tenant.save();
    const updated = await Tenant.findById(tenant._id).populate('room');

    // Broadcast tenant profile update
    broadcastToClients({
      type: 'TENANT_PROFILE_UPDATED',
      tenantId: updated._id,
      profileData: {
        userId: updated._id,
        id: updated._id,
        name: updated.name,
        fullName: updated.name,
        email: updated.email,
        phone: updated.phone,
        profilePhoto: updated.profilePhoto,
        room: updated.room,
        roomNumber: updated.room?.roomNumber,
        profileData: updated.profileData || {}
      }
    });

    res.json({ success: true, tenant: updated });
  } catch (error) {
    console.error('❌ Error updating tenant:', error);
    res.status(500).json({ error: 'Failed to update tenant' });
  }
});

// Delete tenant (vacate room)
app.delete('/api/admin/tenants/:tenantId', authenticateToken, async (req, res) => {
  try {
    const { tenantId } = req.params;
    const tenant = await Tenant.findById(tenantId);
    if (!tenant) return res.status(404).json({ success: false, error: 'Tenant not found' });

    const roomId = tenant.room;
    await Tenant.findByIdAndDelete(tenantId);

    if (roomId) {
      await Room.findByIdAndUpdate(roomId, { currentTenant: null, status: 'vacant' });
    }

    broadcastToClients({ type: 'TENANT_REMOVED', tenantId });
    broadcastToClients({ type: 'ROOMS_UPDATED' });

    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error deleting tenant:', error);
    res.status(500).json({ error: 'Failed to delete tenant' });
  }
});

// Get all rooms
app.get('/api/admin/rooms', authenticateToken, async (req, res) => {
  try {
    const rooms = await Room.find()
      .populate('currentTenant', 'name username phone email')
      .sort({ roomNumber: 1 });
    
    res.json({ success: true, rooms });
  } catch (error) {
    console.error('❌ Error fetching rooms:', error);
    res.status(500).json({ error: 'Failed to fetch rooms' });
  }
});

// Update room details
app.put('/api/admin/rooms/:roomId', authenticateToken, async (req, res) => {
  try {
    const { roomId } = req.params;
    const updates = req.body || {};

    const room = await Room.findById(roomId);
    if (!room) {
      return res.status(404).json({ success: false, error: 'Room not found' });
    }

    // Don't allow changing unique roomNumber to an existing one
    if (updates.roomNumber && updates.roomNumber !== room.roomNumber) {
      const clash = await Room.findOne({ roomNumber: updates.roomNumber });
      if (clash) {
        return res.status(400).json({ success: false, error: 'Room number already exists' });
      }
      room.roomNumber = updates.roomNumber;
    }

    // Apply mutable fields
    if (typeof updates.floor !== 'undefined') room.floor = updates.floor;
    if (updates.type) room.type = updates.type;
    if (typeof updates.rent !== 'undefined') room.rent = updates.rent;
    if (typeof updates.securityDeposit !== 'undefined') room.securityDeposit = updates.securityDeposit;

    // Utilities
    if (updates.utilities) {
      room.utilities = {
        ...room.utilities,
        electricity: { ...room.utilities.electricity, ...(updates.utilities.electricity || {}) },
        water: { ...room.utilities.water, ...(updates.utilities.water || {}) },
        gas: { ...room.utilities.gas, ...(updates.utilities.gas || {}) },
        internet: { ...room.utilities.internet, ...(updates.utilities.internet || {}) },
        parking: { ...room.utilities.parking, ...(updates.utilities.parking || {}) },
        maintenance: { ...room.utilities.maintenance, ...(updates.utilities.maintenance || {}) }
      }
    }

    if (updates.status) room.status = updates.status;

    await room.save();

    // If room has a current tenant, broadcast their updated profile so their dashboard syncs
    if (room.currentTenant) {
      const tenant = await Tenant.findById(room.currentTenant).populate('room');
      if (tenant) {
        const activeClients = broadcastToClients({
          type: 'TENANT_PROFILE_UPDATED',
          tenantId: tenant._id,
          profileData: {
            userId: tenant._id,
            id: tenant._id,
            name: tenant.name,
            fullName: tenant.name,
            email: tenant.email,
            phone: tenant.phone,
            profilePhoto: tenant.profilePhoto,
            room: tenant.room,
            roomNumber: tenant.room?.roomNumber,
            profileData: tenant.profileData || {}
          }
        });
        console.log(`📡 [Server] Room update broadcast to ${activeClients} clients for tenant ${tenant.username}`);
      }
    }

    // Optional: broadcast room list update for owner dashboards
    broadcastToClients({ type: 'ROOMS_UPDATED' });

    res.json({ success: true, room });
  } catch (error) {
    console.error('❌ Error updating room:', error);
    res.status(500).json({ error: 'Failed to update room' });
  }
});

// Add new room
app.post('/api/admin/rooms', authenticateToken, async (req, res) => {
  try {
    const { roomNumber } = req.body;

    // Enforce unique roomNumber
    const existing = await Room.findOne({ roomNumber });
    if (existing) {
      return res.status(400).json({ success: false, error: 'Room number already exists' });
    }

    // Apply safe defaults for utilities if not provided
    const payload = {
      ...req.body,
      utilities: {
        electricity: { included: false, rate: 0, ...(req.body.utilities?.electricity || {}) },
        water: { included: true, rate: 0, ...(req.body.utilities?.water || {}) },
        gas: { included: false, rate: 0, ...(req.body.utilities?.gas || {}) },
        internet: { included: false, rate: 0, ...(req.body.utilities?.internet || {}) },
        parking: { included: false, rate: 0, ...(req.body.utilities?.parking || {}) },
        maintenance: { included: true, rate: 0, ...(req.body.utilities?.maintenance || {}) }
      },
      status: req.body.status || 'vacant'
    };

    const room = new Room(payload);
    await room.save();

    // Optional: broadcast rooms update for admin dashboards (owners)
    broadcastToClients({ type: 'ROOMS_UPDATED' });
    
    res.json({ success: true, room });
  } catch (error) {
    console.error('❌ Error adding room:', error);
    res.status(500).json({ error: 'Failed to add room' });
  }
});

// Add tenant to room
app.post('/api/admin/rooms/:roomId/assign-tenant', authenticateToken, async (req, res) => {
  try {
    const { roomId } = req.params;
    const { 
      name, 
      email, 
      phone, 
      emergencyContact, 
      moveInDate, 
      securityDepositPaid 
    } = req.body;

    // Generate username and password
    const username = `tenant_${Date.now()}`;
    const password = Math.random().toString(36).slice(-8);

    // Create tenant
    const tenant = new Tenant({
      username,
      password,
      name,
      email,
      phone,
      emergencyContact,
      room: roomId,
      moveInDate: moveInDate ? new Date(moveInDate) : new Date(),
      securityDepositPaid: securityDepositPaid || 0,
      status: 'active'
    });

    await tenant.save();

    // Update room
    const updatedRoom = await Room.findByIdAndUpdate(roomId, {
      currentTenant: tenant._id,
      status: 'occupied'
    }, { new: true });

    // Send credentials notification
    const notification = new Notification({
      title: 'Welcome to Bhuyan Complex',
      message: `Welcome ${name}! Your login credentials: Username: ${username}, Password: ${password}. Please change your password after first login.`,
      type: 'personal',
      category: 'info',
      priority: 'high',
      recipients: [{
        tenant: tenant._id
      }]
    });

    await notification.save();

    // Broadcast notification
    broadcastToClients({
      type: 'NEW_NOTIFICATION',
      notification
    });

    // Broadcast tenant profile update so client dashboards sync instantly
    const populatedTenant = await Tenant.findById(tenant._id).populate('room');
    const activeClients = broadcastToClients({
      type: 'TENANT_PROFILE_UPDATED',
      tenantId: populatedTenant._id,
      profileData: {
        userId: populatedTenant._id,
        id: populatedTenant._id,
        name: populatedTenant.name,
        fullName: populatedTenant.name,
        email: populatedTenant.email,
        phone: populatedTenant.phone,
        profilePhoto: populatedTenant.profilePhoto,
        room: populatedTenant.room,
        roomNumber: populatedTenant.room?.roomNumber,
        profileData: populatedTenant.profileData || {}
      }
    });

    console.log(`📡 [Server] Tenant assignment broadcast to ${activeClients} WebSocket clients`);

    res.json({ 
      success: true, 
      tenant: {
        ...tenant.toObject(),
        generatedUsername: username,
        generatedPassword: password
      },
      room: updatedRoom
    });
  } catch (error) {
    console.error('❌ Error assigning tenant:', error);
    res.status(500).json({ error: 'Failed to assign tenant' });
  }
});

// Get payment summary
app.get('/api/admin/payments/summary', authenticateToken, async (req, res) => {
  try {
    const { month, year } = req.query;
    const currentMonth = month ? parseInt(month) : new Date().getMonth() + 1;
    const currentYear = year ? parseInt(year) : new Date().getFullYear();

    // Total payments received this month
    const totalPayments = await Payment.aggregate([
      {
        $lookup: {
          from: 'bills',
          localField: 'bill',
          foreignField: '_id',
          as: 'billDetails'
        }
      },
      {
        $unwind: '$billDetails'
      },
      {
        $match: {
          'billDetails.month': currentMonth,
          'billDetails.year': currentYear,
          status: 'completed'
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      }
    ]);

    // Pending dues
    const pendingBills = await Bill.find({
      month: currentMonth,
      year: currentYear,
      status: { $in: ['pending', 'overdue'] }
    }).populate('tenant', 'name username').populate('room', 'roomNumber');

    const totalPending = pendingBills.reduce((sum, bill) => sum + bill.totalAmount + bill.penalty.amount, 0);

    res.json({
      success: true,
      summary: {
        totalReceived: totalPayments[0]?.total || 0,
        paymentsCount: totalPayments[0]?.count || 0,
        totalPending,
        pendingBills: pendingBills.length,
        pendingBillsDetails: pendingBills
      }
    });
  } catch (error) {
    console.error('❌ Error fetching payment summary:', error);
    res.status(500).json({ error: 'Failed to fetch payment summary' });
  }
});

// Generate bills for all tenants
app.post('/api/admin/bills/generate', authenticateToken, async (req, res) => {
  try {
    const { month, year } = req.body;
    const dueDate = new Date(year, month, 10); // 10th of next month

    // Get all active tenants with rooms
    const tenants = await Tenant.find({ 
      status: 'active', 
      room: { $ne: null } 
    }).populate('room');

    const bills = [];

    for (const tenant of tenants) {
      // Check if bill already exists
      const existingBill = await Bill.findOne({
        tenant: tenant._id,
        month: parseInt(month),
        year: parseInt(year)
      });

      if (!existingBill) {
        const room = tenant.room;
        
        // Calculate total amount
        let totalAmount = room.rent;
        
        // Add utilities that are not included
        Object.keys(room.utilities).forEach(utility => {
          if (!room.utilities[utility].included) {
            totalAmount += room.utilities[utility].rate;
          }
        });

        const bill = new Bill({
          tenant: tenant._id,
          room: room._id,
          month: parseInt(month),
          year: parseInt(year),
          dueDate,
          items: {
            rent: {
              amount: room.rent,
              description: `Monthly rent for room ${room.roomNumber}`
            },
            utilities: {
              electricity: { 
                amount: !room.utilities.electricity.included ? room.utilities.electricity.rate : 0 
              },
              water: { 
                amount: !room.utilities.water.included ? room.utilities.water.rate : 0 
              },
              gas: { 
                amount: !room.utilities.gas.included ? room.utilities.gas.rate : 0 
              },
              internet: { 
                amount: !room.utilities.internet.included ? room.utilities.internet.rate : 0 
              },
              parking: { 
                amount: !room.utilities.parking.included ? room.utilities.parking.rate : 0 
              },
              maintenance: { 
                amount: !room.utilities.maintenance.included ? room.utilities.maintenance.rate : 0 
              }
            }
          },
          totalAmount
        });

        await bill.save();
        bills.push(bill);

        // Send bill notification
        const notification = new Notification({
          title: 'New Bill Generated',
          message: `Your bill for ${new Date(year, month - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} has been generated. Amount: ₹${totalAmount}. Due date: ${dueDate.toLocaleDateString()}.`,
          type: 'personal',
          category: 'info',
          priority: 'medium',
          recipients: [{
            tenant: tenant._id
          }]
        });

        await notification.save();
      }
    }

    // Broadcast notification about new bills
    if (bills.length > 0) {
      broadcastToClients({
        type: 'BILLS_GENERATED',
        count: bills.length
      });
    }

    res.json({
      success: true,
      message: `Generated ${bills.length} bills`,
      bills: bills.length
    });
  } catch (error) {
    console.error('❌ Error generating bills:', error);
    res.status(500).json({ error: 'Failed to generate bills' });
  }
});

// Get all tenants for bill generation (Admin)
app.get('/api/admin/tenants-for-billing', authenticateToken, async (req, res) => {
  try {
    const tenants = await Tenant.find({ status: 'active', room: { $ne: null } })
      .populate('room', 'roomNumber type rent securityDeposit utilities')
      .select('name phone email room username')
      .sort({ name: 1 });
    
    res.json({ success: true, tenants });
  } catch (error) {
    console.error('❌ Error fetching tenants for billing:', error);
    res.status(500).json({ error: 'Failed to fetch tenants for billing' });
  }
});

// Generate individual bill for specific tenant (Admin)
app.post('/api/admin/bills/generate-individual', authenticateToken, async (req, res) => {
  try {
    const {
      tenantId,
      month,
      year,
      rent,
      electricity: {
        meterStartReading = 0,
        meterEndReading = 0,
        chargesPerUnit = 0
      } = {},
      waterBill = 0,
      commonAreaCharges = 0
    } = req.body;

    // Check if bill already exists
    const existingBill = await Bill.findOne({
      tenant: tenantId,
      month: parseInt(month),
      year: parseInt(year)
    });

    if (existingBill) {
      return res.status(400).json({ 
        success: false, 
        error: 'Bill already exists for this tenant and month' 
      });
    }

    // Get tenant and room details
    const tenant = await Tenant.findById(tenantId).populate('room');
    if (!tenant) {
      return res.status(404).json({ success: false, error: 'Tenant not found' });
    }

    // Calculate electricity bill
    const unitsConsumed = Math.max(0, meterEndReading - meterStartReading);
    const electricityAmount = unitsConsumed * chargesPerUnit;

    // Calculate total amount
    const totalAmount = rent + electricityAmount + waterBill + commonAreaCharges;

    // Set due date to 10th of the month
    const dueDate = new Date(year, month - 1, 10);
    if (dueDate < new Date()) {
      // If due date is in the past, set it to 10th of next month
      dueDate.setMonth(dueDate.getMonth() + 1);
    }

    // Generate bill number manually as backup
    const billCount = await Bill.countDocuments();
    const billNumber = `BILL${String(billCount + 1).padStart(6, '0')}`;

    const bill = new Bill({
      tenant: tenantId,
      room: tenant.room._id,
      billNumber,
      month: parseInt(month),
      year: parseInt(year),
      dueDate,
      items: {
        rent: {
          amount: rent,
          description: `Monthly rent for room ${tenant.room.roomNumber}`
        },
        electricity: {
          meterStartReading,
          meterEndReading,
          unitsConsumed,
          chargesPerUnit,
          amount: electricityAmount
        },
        waterBill: {
          amount: waterBill,
          description: 'Water Bill'
        },
        commonAreaCharges: {
          amount: commonAreaCharges,
          description: 'Common Area Maintenance'
        }
      },
      totalAmount,
      remainingAmount: totalAmount
    });

    await bill.save();

    // Send bill notification
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                      'July', 'August', 'September', 'October', 'November', 'December'];
    
    const notification = new Notification({
      title: 'New Bill Generated',
      message: `Your bill for ${monthNames[month - 1]} ${year} has been generated. Amount: ₹${totalAmount}. Due date: ${dueDate.toLocaleDateString()}.`,
      type: 'personal',
      category: 'info',
      priority: 'medium',
      recipients: [{
        tenant: tenantId
      }]
    });

    await notification.save();

    // Broadcast notification
    broadcastToClients({
      type: 'NEW_NOTIFICATION',
      notification: await Notification.findById(notification._id)
        .populate('recipients.tenant', 'name username')
    });

    // Broadcast bill update
    broadcastToClients({
      type: 'BILL_GENERATED',
      tenantId,
      bill: await Bill.findById(bill._id).populate('tenant', 'name username').populate('room', 'roomNumber')
    });

    res.json({
      success: true,
      message: 'Bill generated successfully',
      bill: await Bill.findById(bill._id)
        .populate('tenant', 'name username phone')
        .populate('room', 'roomNumber')
    });
  } catch (error) {
    console.error('❌ Error generating individual bill:', error);
    console.error('❌ Error stack:', error.stack);
    console.error('❌ Error details:', {
      name: error.name,
      message: error.message,
      code: error.code
    });
    res.status(500).json({ 
      error: 'Failed to generate bill',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get all bills (Admin) - for payment management
app.get('/api/admin/bills', authenticateToken, async (req, res) => {
  try {
    const { month, year, status } = req.query;
    
    let query = {};
    if (month) query.month = parseInt(month);
    if (year) query.year = parseInt(year);
    if (status) query.status = status;

    const bills = await Bill.find(query)
      .populate('tenant', 'name phone email username')
      .populate('room', 'roomNumber')
      .sort({ generatedAt: -1, 'tenant.name': 1 });

    // Get payment details for each bill
    const billsWithPayments = await Promise.all(bills.map(async (bill) => {
      const payments = await Payment.find({ bill: bill._id })
        .sort({ paidAt: -1 });
      
      return {
        ...bill.toObject(),
        payments
      };
    }));

    res.json({ success: true, bills: billsWithPayments });
  } catch (error) {
    console.error('❌ Error fetching bills:', error);
    res.status(500).json({ error: 'Failed to fetch bills' });
  }
});

// Delete bill (Admin)
app.delete('/api/admin/bills/:billId', authenticateToken, async (req, res) => {
  try {
    const { billId } = req.params;
    
    // First, check if the bill exists
    const bill = await Bill.findById(billId).populate('tenant', 'name username').populate('room', 'roomNumber');
    if (!bill) {
      return res.status(404).json({ success: false, error: 'Bill not found' });
    }

    // Check if the bill has any payments associated with it
    const payments = await Payment.find({ bill: billId });
    if (payments.length > 0) {
      // If there are payments, we need to delete them first or prevent deletion
      // For safety, let's prevent deletion of bills with payments
      return res.status(400).json({ 
        success: false, 
        error: 'Cannot delete bill with associated payments. Please remove payments first.' 
      });
    }

    // Store bill info for logging and broadcasting
    const billInfo = {
      billNumber: bill.billNumber,
      tenantName: bill.tenant?.name,
      tenantId: bill.tenant?._id,
      month: bill.month,
      year: bill.year,
      amount: bill.totalAmount,
      roomNumber: bill.room?.roomNumber
    };

    // Delete the bill
    await Bill.findByIdAndDelete(billId);

    // Log the deletion
    console.log(`🗑️ Bill deleted: ${billInfo.billNumber} for ${billInfo.tenantName} (${billInfo.roomNumber}) - ₹${billInfo.amount}`);

    // Broadcast bill deletion to all clients
    broadcastToClients({
      type: 'BILL_DELETED',
      billId,
      billInfo
    });

    // Send notification to tenant about bill deletion
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                      'July', 'August', 'September', 'October', 'November', 'December'];
                      
    const notification = new Notification({
      title: 'Bill Deleted',
      message: `Your bill for ${monthNames[billInfo.month - 1]} ${billInfo.year} (₹${billInfo.amount}) has been deleted by the admin.`,
      type: 'personal',
      category: 'info',
      priority: 'medium',
      recipients: [{
        tenant: billInfo.tenantId
      }]
    });

    await notification.save();

    // Broadcast notification
    broadcastToClients({
      type: 'NEW_NOTIFICATION',
      notification: await Notification.findById(notification._id)
        .populate('recipients.tenant', 'name username')
    });

    res.json({
      success: true,
      message: 'Bill deleted successfully',
      deletedBill: billInfo
    });
  } catch (error) {
    console.error('❌ Error deleting bill:', error);
    res.status(500).json({ error: 'Failed to delete bill' });
  }
});

// Verify payment screenshot (Admin)
app.put('/api/admin/payments/:paymentId/verify', authenticateToken, async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { verified, notes } = req.body;
    const ownerId = req.user.id;

    const payment = await Payment.findById(paymentId).populate('bill');
    if (!payment) {
      return res.status(404).json({ success: false, error: 'Payment not found' });
    }

    // Update payment verification
    payment.paymentScreenshot.verified = verified;
    payment.paymentScreenshot.verifiedBy = ownerId;
    payment.paymentScreenshot.verifiedDate = new Date();
    payment.paymentScreenshot.notes = notes || '';
    payment.status = verified ? 'verified' : 'failed';

    await payment.save();

    // Update bill status if payment is verified
    if (verified) {
      const bill = await Bill.findById(payment.bill._id);
      bill.status = 'paid';
      bill.paidAmount = bill.totalAmount;
      bill.remainingAmount = 0;
      bill.paidDate = new Date();
      await bill.save();

      // Broadcast bill update
      broadcastToClients({
        type: 'BILL_PAYMENT_VERIFIED',
        billId: bill._id,
        paymentId: payment._id
      });
    }

    res.json({ success: true, payment });
  } catch (error) {
    console.error('❌ Error verifying payment:', error);
    res.status(500).json({ error: 'Failed to verify payment' });
  }
});

// ============= TENANT ROUTES =============

// Get tenant dashboard data
app.get('/api/tenant/dashboard', authenticateToken, async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.user.id).populate('room');
    
    // Get current and recent bills with late fee calculation
    const bills = await Bill.find({ tenant: req.user.id })
      .populate('room', 'roomNumber')
      .sort({ generatedAt: -1 })
      .limit(10);

    // Calculate late fees for each bill
    const billsWithLateFees = bills.map(bill => {
      if (bill.status === 'pending' && new Date() > bill.dueDate) {
        const daysLate = Math.floor((new Date() - bill.dueDate) / (1000 * 60 * 60 * 24));
        const lateFee = daysLate * (bill.penalty.rate || 50);
        
        return {
          ...bill.toObject(),
          lateFee,
          daysLate,
          totalWithLateFee: bill.totalAmount + lateFee,
          status: 'overdue'
        };
      }
      return bill;
    });

    // Get payment history
    const payments = await Payment.find({ tenant: req.user.id })
      .populate('bill')
      .sort({ paidAt: -1 })
      .limit(10);

    // Get current month statistics
    const currentMonth = new Date().getMonth() + 1;
    const currentYear = new Date().getFullYear();
    
    const currentMonthBill = await Bill.findOne({
      tenant: req.user.id,
      month: currentMonth,
      year: currentYear
    });

    res.json({
      success: true,
      tenant,
      bills: billsWithLateFees,
      payments,
      currentMonthBill
    });
  } catch (error) {
    console.error('❌ Error fetching tenant dashboard:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

// Get tenant bills (Pay Bills section)
app.get('/api/tenant/bills', authenticateToken, async (req, res) => {
  try {
    const { status, year, month } = req.query;
    
    let query = { tenant: req.user.id };
    if (status) query.status = status;
    if (year) query.year = parseInt(year);
    if (month) query.month = parseInt(month);

    const bills = await Bill.find(query)
      .populate('room', 'roomNumber')
      .sort({ generatedAt: -1 });

    // Calculate late fees and update status for each bill
    const billsWithDetails = bills.map(bill => {
      const billObj = bill.toObject();
      
      if (bill.status === 'pending' && new Date() > bill.dueDate) {
        const daysLate = Math.floor((new Date() - bill.dueDate) / (1000 * 60 * 60 * 24));
        const lateFee = daysLate * (bill.penalty.rate || 50);
        
        billObj.lateFee = lateFee;
        billObj.daysLate = daysLate;
        billObj.totalWithLateFee = bill.totalAmount + lateFee;
        billObj.status = 'overdue';
        billObj.remainingAmount = bill.totalAmount + lateFee - bill.paidAmount;
      } else {
        billObj.lateFee = 0;
        billObj.daysLate = 0;
        billObj.totalWithLateFee = bill.totalAmount;
        billObj.remainingAmount = Math.max(0, bill.totalAmount - bill.paidAmount);
      }
      
      return billObj;
    });

    res.json({ success: true, bills: billsWithDetails });
  } catch (error) {
    console.error('❌ Error fetching tenant bills:', error);
    res.status(500).json({ error: 'Failed to fetch bills' });
  }
});

// Get previous bills for tenant
app.get('/api/tenant/previous-bills', authenticateToken, async (req, res) => {
  try {
    const bills = await Bill.find({ tenant: req.user.id })
      .populate('room', 'roomNumber')
      .sort({ year: -1, month: -1 });

    const billsWithDetails = bills.map(bill => {
      const billObj = bill.toObject();
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                         'July', 'August', 'September', 'October', 'November', 'December'];
      
      billObj.monthName = monthNames[bill.month - 1];
      
      // Calculate late fees if applicable
      if (bill.status === 'overdue' || (bill.status === 'pending' && new Date() > bill.dueDate)) {
        const daysLate = Math.floor((new Date() - bill.dueDate) / (1000 * 60 * 60 * 24));
        billObj.lateFee = daysLate * (bill.penalty.rate || 50);
        billObj.daysLate = daysLate;
      } else {
        billObj.lateFee = bill.penalty.amount || 0;
        billObj.daysLate = bill.penalty.days || 0;
      }
      
      billObj.totalWithLateFee = bill.totalAmount + (billObj.lateFee || 0);
      billObj.remainingAmount = Math.max(0, billObj.totalWithLateFee - bill.paidAmount);
      
      return billObj;
    });

    res.json({ success: true, bills: billsWithDetails });
  } catch (error) {
    console.error('❌ Error fetching previous bills:', error);
    res.status(500).json({ error: 'Failed to fetch previous bills' });
  }
});

// Get individual bill details
app.get('/api/tenant/bills/:billId', authenticateToken, async (req, res) => {
  try {
    const { billId } = req.params;
    
    const bill = await Bill.findOne({ 
      _id: billId, 
      tenant: req.user.id 
    }).populate('room', 'roomNumber type');

    if (!bill) {
      return res.status(404).json({ success: false, error: 'Bill not found' });
    }

    // Get payments for this bill
    const payments = await Payment.find({ bill: billId })
      .sort({ paidAt: -1 });

    // Calculate late fees if applicable
    let lateFee = 0;
    let daysLate = 0;
    
    if (bill.status === 'pending' && new Date() > bill.dueDate) {
      daysLate = Math.floor((new Date() - bill.dueDate) / (1000 * 60 * 60 * 24));
      lateFee = daysLate * (bill.penalty.rate || 50);
    } else if (bill.penalty.amount) {
      lateFee = bill.penalty.amount;
      daysLate = bill.penalty.days;
    }

    const billWithDetails = {
      ...bill.toObject(),
      lateFee,
      daysLate,
      totalWithLateFee: bill.totalAmount + lateFee,
      remainingAmount: Math.max(0, bill.totalAmount + lateFee - bill.paidAmount),
      payments
    };

    res.json({ success: true, bill: billWithDetails });
  } catch (error) {
    console.error('❌ Error fetching bill details:', error);
    res.status(500).json({ error: 'Failed to fetch bill details' });
  }
});

// ============= NOTIFICATION ROUTES =============

// Get notifications
app.get('/api/notifications', async (req, res) => {
  try {
    const notifications = await Notification.find()
      .populate('recipients.tenant', 'name username')
      .sort({ createdAt: -1 })
      .limit(50);

    res.json({ success: true, notifications });
  } catch (error) {
    console.error('❌ Error fetching notifications:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// Add notification
app.post('/api/notifications', async (req, res) => {
  try {
    const { title, message, type, category, priority, tenantIds } = req.body;

    const notification = new Notification({
      title,
      message,
      type,
      category: category || 'info',
      priority: priority || 'medium'
    });

    // Add recipients based on type
    if (type === 'common') {
      // Send to all active tenants
      const tenants = await Tenant.find();
      notification.recipients = tenants.map(tenant => ({
        tenant: tenant._id
      }));
    } else if (type === 'personal' && tenantIds) {
      // Send to specific tenants
      notification.recipients = tenantIds.map(tenantId => ({
        tenant: tenantId
      }));
    }

    await notification.save();

    // Get all notifications for broadcasting
    const allNotifications = await Notification.find()
      .populate('recipients.tenant', 'name username')
      .sort({ createdAt: -1 })
      .limit(50);

    // Broadcast to WebSocket clients with all notifications
    const activeClients = broadcastToClients({
      type: 'NEW_NOTIFICATION',
      notification: await Notification.findById(notification._id)
        .populate('recipients.tenant', 'name username'),
      allNotifications
    });

    console.log(`📡 New notification broadcast to ${activeClients} WebSocket clients`);

    res.json({
      success: true,
      notification: await Notification.findById(notification._id)
        .populate('recipients.tenant', 'name username'),
      broadcastedTo: activeClients
    });
  } catch (error) {
    console.error('❌ Error creating notification:', error);
    res.status(500).json({ error: 'Failed to create notification' });
  }
});

// Delete notification
app.delete('/api/notifications/:id', async (req, res) => {
  try {
    const notificationId = req.params.id;
    console.log(`🗑️ [Server] Deleting notification ${notificationId}`);
    
    // Find the notification before deleting for broadcasting
    const deletedNotification = await Notification.findById(notificationId)
      .populate('recipients.tenant', 'name username');
    
    if (!deletedNotification) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    
    console.log(`🗑️ [Server] Found notification to delete: "${deletedNotification.title}"`);
    
    // Delete the notification
    await Notification.findByIdAndDelete(notificationId);
    console.log(`✅ [Server] Notification deleted from database`);
    
    // Get updated notifications list
    const allNotifications = await Notification.find()
      .populate('recipients.tenant', 'name username')
      .sort({ createdAt: -1 })
      .limit(50);
    
    console.log(`📊 [Server] Remaining notifications: ${allNotifications.length}`);
    
    // Broadcast deletion to all WebSocket clients
    const activeClients = broadcastToClients({
      type: 'NOTIFICATION_DELETED',
      deletedId: notificationId,
      deletedNotification: deletedNotification,
      allNotifications
    });
    
    console.log(`📡 [Server] Deletion broadcast to ${activeClients} WebSocket clients`);
    
    res.json({ 
      success: true, 
      deletedId: notificationId,
      deletedNotification: deletedNotification,
      remainingCount: allNotifications.length,
      broadcastedTo: activeClients
    });
  } catch (error) {
    console.error('❌ [Server] Error deleting notification:', error);
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

// Mark notification as read
app.put('/api/notifications/:id', async (req, res) => {
  try {
    const notificationId = req.params.id;
    const { read } = req.body;
    
    const notification = await Notification.findById(notificationId);
    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    
    // Update read status for all recipients (simplified approach)
    notification.recipients.forEach(recipient => {
      if (read) {
        recipient.read = true;
        recipient.readAt = new Date();
      } else {
        recipient.read = false;
        recipient.readAt = null;
      }
    });
    
    await notification.save();
    
    res.json({ 
      success: true, 
      notification: await Notification.findById(notificationId)
        .populate('recipients.tenant', 'name username')
    });
  } catch (error) {
    console.error('❌ Error updating notification:', error);
    res.status(500).json({ error: 'Failed to update notification' });
  }
});

// ============= PROFILE UPDATE ROUTES =============

// Get owner profile
app.get('/api/owner/profile', authenticateToken, async (req, res) => {
  try {
    const ownerId = req.user.id;
    
    console.log(`📂 [Server] Loading owner profile for ID: ${ownerId}`);
    
    const owner = await Owner.findById(ownerId);
    if (!owner) {
      return res.status(404).json({ error: 'Owner not found' });
    }
    
    console.log(`✅ [Server] Owner profile loaded successfully`);
    
    res.json({ 
      success: true, 
      owner: {
        id: owner._id,
        name: owner.name,
        email: owner.email,
        phone: owner.phone,
        profilePhoto: owner.profilePhoto,
        address: owner.address,
        profileData: owner.profileData
      }
    });
  } catch (error) {
    console.error('❌ [Server] Error loading owner profile:', error);
    res.status(500).json({ error: 'Failed to load owner profile' });
  }
});

// Update owner profile
app.put('/api/owner/profile', authenticateToken, async (req, res) => {
  try {
    const ownerId = req.user.id;
    const profileData = req.body;
    
    console.log(`🔄 [Server] Updating owner profile for ID: ${ownerId}`);
    console.log('📝 [Server] Profile data received:', Object.keys(profileData));
    
    // Find and update owner
    const owner = await Owner.findById(ownerId);
    if (!owner) {
      return res.status(404).json({ error: 'Owner not found' });
    }
    
    // Update basic info
    if (profileData.basicInfo) {
      owner.name = profileData.basicInfo.fullName || owner.name;
      owner.email = profileData.basicInfo.email || owner.email;
      owner.phone = profileData.basicInfo.primaryPhone || owner.phone;
      owner.profilePhoto = profileData.basicInfo.profilePhoto || owner.profilePhoto;
      owner.address = profileData.basicInfo.residentialAddress || owner.address;
      
      // Store additional profile data as nested object
      owner.profileData = {
        ...owner.profileData,
        basicInfo: profileData.basicInfo,
        buildingDetails: profileData.buildingDetails,
        billingSettings: profileData.billingSettings,
        documents: profileData.documents
      };
    }
    
    await owner.save();
    
    console.log(`✅ [Server] Owner profile updated successfully`);
    
    // Broadcast profile update to all WebSocket clients
    const activeClients = broadcastToClients({
      type: 'OWNER_PROFILE_UPDATED',
      ownerId: ownerId,
      profileData: {
        id: owner._id,
        name: owner.name,
        email: owner.email,
        phone: owner.phone,
        profilePhoto: owner.profilePhoto,
        profileData: owner.profileData
      }
    });
    
    console.log(`📡 [Server] Profile update broadcast to ${activeClients} WebSocket clients`);
    
    res.json({ 
      success: true, 
      owner: {
        id: owner._id,
        name: owner.name,
        email: owner.email,
        phone: owner.phone,
        profilePhoto: owner.profilePhoto,
        profileData: owner.profileData
      },
      broadcastedTo: activeClients
    });
  } catch (error) {
    console.error('❌ [Server] Error updating owner profile:', error);
    res.status(500).json({ error: 'Failed to update owner profile' });
  }
});

// Get tenant profile
app.get('/api/tenant/profile', authenticateToken, async (req, res) => {
  try {
    const tenantId = req.user.id;
    
    console.log(`📂 [Server] Loading tenant profile for ID: ${tenantId}`);
    
    const tenant = await Tenant.findById(tenantId).populate('room');
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }
    
    console.log(`✅ [Server] Tenant profile loaded successfully`);
    
    res.json({ 
      success: true, 
      tenant: {
        id: tenant._id,
        name: tenant.name,
        email: tenant.email,
        phone: tenant.phone,
        profilePhoto: tenant.profilePhoto,
        room: tenant.room,
        securityDepositPaid: tenant.securityDepositPaid,
        profileData: tenant.profileData
      }
    });
  } catch (error) {
    console.error('❌ [Server] Error loading tenant profile:', error);
    res.status(500).json({ error: 'Failed to load tenant profile' });
  }
});

// Update tenant profile
app.put('/api/tenant/profile', authenticateToken, async (req, res) => {
  try {
    const tenantId = req.user.id;
    const profileData = req.body;
    
    console.log(`🔄 [Server] Updating tenant profile for ID: ${tenantId}`);
    console.log('📝 [Server] Profile data received:', Object.keys(profileData));
    
    // Find and update tenant
    const tenant = await Tenant.findById(tenantId).populate('room');
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }
    
    // Update basic info
    if (profileData.basicInfo) {
      tenant.name = profileData.basicInfo.fullName || tenant.name;
      tenant.email = profileData.basicInfo.email || tenant.email;
      tenant.phone = profileData.basicInfo.primaryPhone || tenant.phone;
      tenant.profilePhoto = profileData.basicInfo.profilePhoto || tenant.profilePhoto;
    }
    
    // Store complete profile data including documents and rental details
    tenant.profileData = {
      ...tenant.profileData,
      basicInfo: profileData.basicInfo || tenant.profileData?.basicInfo,
      emergencyContact: profileData.emergencyContact || tenant.profileData?.emergencyContact,
      preferences: profileData.preferences || tenant.profileData?.preferences,
      rentalDetails: profileData.rentalDetails || tenant.profileData?.rentalDetails,
      documents: profileData.documents || tenant.profileData?.documents
    };
    
    await tenant.save();
    
    console.log(`✅ [Server] Tenant profile updated successfully`);
    
    // Broadcast profile update to all WebSocket clients
    const activeClients = broadcastToClients({
      type: 'TENANT_PROFILE_UPDATED',
      tenantId: tenantId,
      profileData: {
        userId: tenant._id,
        id: tenant._id,
        name: tenant.name,
        fullName: tenant.name,
        email: tenant.email,
        phone: tenant.phone,
        profilePhoto: tenant.profilePhoto,
        room: tenant.room,
        roomNumber: tenant.room?.roomNumber,
        emergencyContactName: tenant.profileData?.emergencyContact?.name,
        emergencyContactPhone: tenant.profileData?.emergencyContact?.phone,
        emergencyContactRelation: tenant.profileData?.emergencyContact?.relation,
        paymentDueDate: tenant.profileData?.preferences?.paymentDueDate,
        rentAmount: tenant.profileData?.rentalDetails?.rentAmount,
        securityDeposit: tenant.profileData?.rentalDetails?.securityDeposit,
        leaseStartDate: tenant.profileData?.rentalDetails?.leaseStartDate,
        leaseEndDate: tenant.profileData?.rentalDetails?.leaseEndDate,
        outstandingBill: tenant.profileData?.rentalDetails?.outstandingBill,
        documents: tenant.profileData?.documents,
        profileData: tenant.profileData
      }
    });
    
    console.log(`📡 [Server] Profile update broadcast to ${activeClients} WebSocket clients`);
    
    res.json({ 
      success: true, 
      tenant: {
        id: tenant._id,
        name: tenant.name,
        email: tenant.email,
        phone: tenant.phone,
        profilePhoto: tenant.profilePhoto,
        room: tenant.room,
        profileData: tenant.profileData
      },
      broadcastedTo: activeClients
    });
  } catch (error) {
    console.error('❌ [Server] Error updating tenant profile:', error);
    res.status(500).json({ error: 'Failed to update tenant profile' });
  }
});

// ============= SCHEDULED TASKS =============

// Auto-generate bills on 10th of every month at 9 AM
cron.schedule('0 9 10 * *', async () => {
  console.log('🕘 Running monthly bill generation...');
  
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  
  try {
    // Auto-generate bills (same logic as manual generation)
    const tenants = await Tenant.find({ 
      status: 'active', 
      room: { $ne: null } 
    }).populate('room');

    let billsGenerated = 0;

    for (const tenant of tenants) {
      const existingBill = await Bill.findOne({
        tenant: tenant._id,
        month,
        year
      });

      if (!existingBill) {
        const room = tenant.room;
        let totalAmount = room.rent;
        
        Object.keys(room.utilities).forEach(utility => {
          if (!room.utilities[utility].included) {
            totalAmount += room.utilities[utility].rate;
          }
        });

        const bill = new Bill({
          tenant: tenant._id,
          room: room._id,
          month,
          year,
          dueDate: new Date(year, month, 10),
          items: {
            rent: {
              amount: room.rent,
              description: `Monthly rent for room ${room.roomNumber}`
            },
            utilities: {
              electricity: { amount: !room.utilities.electricity.included ? room.utilities.electricity.rate : 0 },
              water: { amount: !room.utilities.water.included ? room.utilities.water.rate : 0 },
              gas: { amount: !room.utilities.gas.included ? room.utilities.gas.rate : 0 },
              internet: { amount: !room.utilities.internet.included ? room.utilities.internet.rate : 0 },
              parking: { amount: !room.utilities.parking.included ? room.utilities.parking.rate : 0 },
              maintenance: { amount: !room.utilities.maintenance.included ? room.utilities.maintenance.rate : 0 }
            }
          },
          totalAmount
        });

        await bill.save();
        billsGenerated++;
      }
    }

    console.log(`✅ Auto-generated ${billsGenerated} bills for ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`);
  } catch (error) {
    console.error('❌ Auto bill generation failed:', error);
  }
});

// Calculate penalties daily at midnight
cron.schedule('0 0 * * *', async () => {
  console.log('🕛 Running daily penalty calculation...');
  
  try {
    const overdueBills = await Bill.find({
      status: 'pending',
      dueDate: { $lt: new Date() }
    });

    for (const bill of overdueBills) {
      const daysOverdue = Math.floor((new Date() - bill.dueDate) / (1000 * 60 * 60 * 24));
      const penaltyAmount = daysOverdue * bill.penalty.rate;
      
      bill.status = 'overdue';
      bill.penalty.amount = penaltyAmount;
      bill.penalty.days = daysOverdue;
      
      await bill.save();
    }

    console.log(`✅ Updated penalties for ${overdueBills.length} overdue bills`);
  } catch (error) {
    console.error('❌ Penalty calculation failed:', error);
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// Start server
server.listen(PORT, async () => {
  console.log('🚀 Rental Management Server Started!');
  console.log(`📡 HTTP Server: http://localhost:${PORT}`);
  console.log(`🔗 WebSocket Server: ws://localhost:${PORT}`);
  console.log('');
  console.log('Available endpoints:');
  console.log('  Authentication:');
  console.log('    POST   /api/auth/login           - User authentication');
  console.log('    POST   /api/auth/forgot-password    - Request password reset code');
  console.log('    POST   /api/auth/verify-reset-code  - Verify reset code');
  console.log('    POST   /api/auth/reset-password     - Reset password');
  console.log('  Admin/Owner:');
  console.log('    GET    /api/admin/tenants           - Get all tenants');
  console.log('    PUT    /api/admin/tenants/:tenantId - Update tenant');
  console.log('    DELETE /api/admin/tenants/:tenantId - Remove tenant');
  console.log('    GET    /api/admin/rooms             - Get all rooms');
  console.log('    POST   /api/admin/rooms             - Add new room');
  console.log('    PUT    /api/admin/rooms/:roomId     - Update room');
  console.log('    POST   /api/admin/rooms/:roomId/assign-tenant - Assign tenant to room (auto-credentials)');
  console.log('    GET    /api/admin/payments/summary  - Payment summary');
  console.log('    POST   /api/admin/bills/generate    - Generate bills');
  console.log('  Tenant Dashboard:');
  console.log('    GET    /api/tenant/dashboard     - Complete dashboard data');
  console.log('    GET    /api/tenant/bills/:id    - Individual bill details');
  console.log('    GET    /api/tenant/bills/:id/pdf - Download PDF invoice');
  console.log('    PUT    /api/tenant/profile      - Update profile');
  console.log('    GET    /api/tenant/notifications - Get notifications');
  console.log('  Payment Processing:');
  console.log('    POST   /api/payments/create-order - Create Razorpay order');
  console.log('    POST   /api/payments/verify     - Verify payment');
  console.log('    POST   /api/payments/record     - Record manual payment');
  console.log('    GET    /api/payments/history    - Payment history');
  console.log('    GET    /api/payments/statistics - Payment analytics');
  console.log('  Profile Management:');
  console.log('    GET    /api/owner/profile        - Get owner profile');
  console.log('    PUT    /api/owner/profile        - Update owner profile');
  console.log('    GET    /api/tenant/profile       - Get tenant profile');
  console.log('    PUT    /api/tenant/profile       - Update tenant profile');
  console.log('  System:');
  console.log('    GET    /api/notifications        - Get notifications');
  console.log('    POST   /api/notifications        - Create notification');
  console.log('    PUT    /api/notifications/:id    - Mark notification as read');
  console.log('    DELETE /api/notifications/:id    - Delete notification');
  console.log('    GET    /health                   - Health check');
  
  // Test email configuration
  try {
    const emailConfigured = await emailService.testEmailConfiguration();
    if (!emailConfigured) {
      console.log('📫 Email not configured - Password reset will not work');
      console.log('   Set EMAIL_USER and EMAIL_PASS environment variables');
      console.log('   For Gmail: Use App Password, not regular password');
    }
  } catch (error) {
    console.log('📫 Email configuration test failed - Password reset disabled');
  }
  
  // Create default owner if doesn't exist
  try {
    const existingOwner = await Owner.findOne({ username: 'owner' });
    if (!existingOwner) {
      const owner = new Owner({
        username: 'owner',
        email: 'owner@building.com',
        password: 'owner123',
        name: 'Building Owner'
      });
      await owner.save();
      console.log('Default owner account created');
    }
  } catch (error) {
    console.error('❌ Error creating default owner:', error);
  }
});