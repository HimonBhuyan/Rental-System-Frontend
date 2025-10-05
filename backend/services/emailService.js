const nodemailer = require('nodemailer');
const crypto = require('crypto');

// Store verification codes in memory (in production, use Redis or database)
const verificationCodes = new Map();

// Configure nodemailer transporter
const createTransporter = () => {
  // For development, you can use Gmail with App Password
  // For production, use proper SMTP service like SendGrid, Mailgun, etc.
  
  if (process.env.EMAIL_SERVICE === 'gmail') {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS // Use App Password for Gmail
      }
    });
  } else if (process.env.EMAIL_SERVICE === 'ethereal') {
    // Ethereal Email - for testing (creates temporary test account)
    return nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: {
        user: process.env.EMAIL_USER || 'ethereal.user@ethereal.email',
        pass: process.env.EMAIL_PASS || 'ethereal.pass'
      }
    });
  } else {
    // Generic SMTP configuration
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: process.env.SMTP_PORT || 587,
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });
  }
};

// Generate 6-digit verification code
const generateVerificationCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Generate reset token for additional security
const generateResetToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

// Send verification code email
const sendVerificationCode = async (email, userType = 'user') => {
  try {
    const code = generateVerificationCode();
    const resetToken = generateResetToken();
    const expiryTime = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes from now

    // Store verification code with expiry
    verificationCodes.set(email, {
      code,
      resetToken,
      expiryTime,
      attempts: 0,
      maxAttempts: 3
    });

    // Check if email is configured
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      // Development fallback - log the code to console
      console.log('\n' + '='.repeat(60));
      console.log('📧 EMAIL NOT CONFIGURED - DEVELOPMENT MODE');
      console.log('='.repeat(60));
      console.log(`🔑 Verification Code for ${email}: ${code}`);
      console.log(`⏰ Code expires at: ${expiryTime.toLocaleString()}`);
      console.log(`👤 User type: ${userType}`);
      console.log('='.repeat(60) + '\n');
      
      return {
        success: true,
        message: 'Verification code generated (check server console)',
        resetToken,
        devMode: true,
        code // Only include in development
      };
    }
    
    // Double-check email configuration is valid format
    if (!process.env.EMAIL_USER.includes('@') || process.env.EMAIL_PASS.length < 8) {
      console.log('\n' + '='.repeat(60));
      console.log('⚠️  INVALID EMAIL CONFIGURATION - DEVELOPMENT MODE');
      console.log('='.repeat(60));
      console.log(`🔑 Verification Code for ${email}: ${code}`);
      console.log(`⏰ Code expires at: ${expiryTime.toLocaleString()}`);
      console.log(`👤 User type: ${userType}`);
      console.log('='.repeat(60) + '\n');
      
      return {
        success: true,
        message: 'Verification code generated (check server console)',
        resetToken,
        devMode: true,
        code // Only include in development
      };
    }

    // Configure transporter
    const transporter = createTransporter();

    // Email content
    const mailOptions = {
      from: {
        name: 'Bhuyan Complex Management',
        address: process.env.EMAIL_USER || 'noreply@bhuyancpx.com'
      },
      to: email,
      subject: 'Password Reset Verification Code - Bhuyan Complex',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Password Reset Verification</title>
          <style>
            body {
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
              background-color: #f4f4f4;
            }
            .container {
              background: white;
              padding: 30px;
              border-radius: 10px;
              box-shadow: 0 0 20px rgba(0,0,0,0.1);
            }
            .header {
              text-align: center;
              margin-bottom: 30px;
              padding: 20px;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
              border-radius: 10px;
            }
            .header h1 {
              margin: 0;
              font-size: 24px;
            }
            .code-container {
              text-align: center;
              margin: 30px 0;
              padding: 20px;
              background: #f8f9ff;
              border: 2px dashed #667eea;
              border-radius: 10px;
            }
            .verification-code {
              font-size: 36px;
              font-weight: bold;
              color: #667eea;
              letter-spacing: 8px;
              font-family: 'Courier New', monospace;
            }
            .info {
              background: #e3f2fd;
              padding: 15px;
              border-left: 4px solid #2196f3;
              margin: 20px 0;
              border-radius: 4px;
            }
            .warning {
              background: #fff3e0;
              padding: 15px;
              border-left: 4px solid #ff9800;
              margin: 20px 0;
              border-radius: 4px;
            }
            .footer {
              text-align: center;
              margin-top: 30px;
              padding-top: 20px;
              border-top: 1px solid #eee;
              font-size: 14px;
              color: #666;
            }
            .button {
              display: inline-block;
              padding: 12px 30px;
              background: #667eea;
              color: white;
              text-decoration: none;
              border-radius: 5px;
              margin: 10px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🏢 Password Reset Request</h1>
              <p>Bhuyan Complex Management System</p>
            </div>
            
            <h2>Hello${userType === 'owner' ? ' Building Owner' : ' Tenant'},</h2>
            
            <p>We received a request to reset your password for your account. Use the verification code below to proceed with resetting your password:</p>
            
            <div class="code-container">
              <div class="verification-code">${code}</div>
              <p><strong>Your verification code</strong></p>
            </div>
            
            <div class="info">
              <h3>📋 Instructions:</h3>
              <ol>
                <li>Enter this 6-digit code in the password reset form</li>
                <li>Create your new password</li>
                <li>Confirm your new password</li>
              </ol>
            </div>
            
            <div class="warning">
              <h3>⚠️ Security Information:</h3>
              <ul>
                <li><strong>This code expires in 15 minutes</strong></li>
                <li>Don't share this code with anyone</li>
                <li>If you didn't request this reset, please ignore this email</li>
                <li>You have 3 attempts to enter the correct code</li>
              </ul>
            </div>
            
            <p>If you're having trouble with the reset process, please contact the building management for assistance.</p>
            
            <div class="footer">
              <p><strong>Bhuyan Complex Management System</strong></p>
              <p>This is an automated email. Please do not reply to this message.</p>
              <p>Generated on: ${new Date().toLocaleString()}</p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
        Password Reset Verification Code - Bhuyan Complex Management

        Hello${userType === 'owner' ? ' Building Owner' : ' Tenant'},

        We received a request to reset your password. Your verification code is:

        ${code}

        This code expires in 15 minutes. Enter this code in the password reset form to proceed.

        Security Information:
        - Don't share this code with anyone
        - If you didn't request this reset, please ignore this email
        - You have 3 attempts to enter the correct code

        Best regards,
        Bhuyan Complex Management System
      `
    };

    // Send email
    console.log(`📧 Attempting to send email to ${email}...`);
    const emailResult = await transporter.sendMail(mailOptions);
    
    console.log(`✅ Verification code sent successfully to ${email}`);
    console.log(`📬 Message ID: ${emailResult.messageId}`);
    
    return {
      success: true,
      message: 'Verification code sent to your email',
      resetToken
    };

  } catch (error) {
    console.error('❌ Error sending verification email:', error);
    
    // Provide specific error messages based on error type
    let errorMessage = 'Failed to send verification email';
    
    if (error.code === 'EAUTH') {
      errorMessage = 'Email authentication failed. Please check EMAIL_USER and EMAIL_PASS in .env file.';
      console.error('🔑 SOLUTION: Make sure you\'re using Gmail App Password, not regular password');
    } else if (error.code === 'ECONNECTION') {
      errorMessage = 'Cannot connect to email server. Check your internet connection.';
    } else if (error.response && error.response.includes('Invalid login')) {
      errorMessage = 'Invalid email credentials. Please check EMAIL_USER and EMAIL_PASS.';
    }
    
    console.error(`🚑 Error Details: ${errorMessage}`);
    throw new Error(errorMessage);
  }
};

// Verify the code
const verifyCode = (email, inputCode, resetToken) => {
  const stored = verificationCodes.get(email);
  
  if (!stored) {
    return {
      success: false,
      error: 'No verification code found. Please request a new one.'
    };
  }

  // Check if token matches (additional security)
  if (stored.resetToken !== resetToken) {
    return {
      success: false,
      error: 'Invalid reset session. Please request a new verification code.'
    };
  }

  // Check expiry
  if (new Date() > stored.expiryTime) {
    verificationCodes.delete(email);
    return {
      success: false,
      error: 'Verification code has expired. Please request a new one.'
    };
  }

  // Check attempt limit
  if (stored.attempts >= stored.maxAttempts) {
    verificationCodes.delete(email);
    return {
      success: false,
      error: 'Too many failed attempts. Please request a new verification code.'
    };
  }

  // Check if code matches
  if (stored.code !== inputCode) {
    stored.attempts += 1;
    verificationCodes.set(email, stored);
    
    const remainingAttempts = stored.maxAttempts - stored.attempts;
    return {
      success: false,
      error: `Invalid verification code. ${remainingAttempts} attempts remaining.`
    };
  }

  // Code is valid - mark as used
  stored.verified = true;
  stored.verifiedAt = new Date();
  verificationCodes.set(email, stored);

  console.log(`✅ Verification code verified for ${email}`);
  return {
    success: true,
    message: 'Verification code verified successfully'
  };
};

// Check if code is verified and still valid
const isCodeVerified = (email, resetToken) => {
  const stored = verificationCodes.get(email);
  
  if (!stored) {
    return false;
  }

  // Check if token matches
  if (stored.resetToken !== resetToken) {
    return false;
  }

  // Check if verified and not expired (allow 30 minutes for password reset after verification)
  const verificationExpiry = new Date(stored.expiryTime.getTime() + 15 * 60 * 1000); // Extra 15 minutes
  return stored.verified && new Date() < verificationExpiry;
};

// Clean up expired codes (call this periodically)
const cleanupExpiredCodes = () => {
  const now = new Date();
  let cleaned = 0;
  
  for (const [email, data] of verificationCodes.entries()) {
    // Remove codes that are older than 30 minutes
    const maxAge = new Date(data.expiryTime.getTime() + 15 * 60 * 1000);
    if (now > maxAge) {
      verificationCodes.delete(email);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    console.log(`🧹 Cleaned up ${cleaned} expired verification codes`);
  }
};

// Test email configuration
const testEmailConfiguration = async () => {
  try {
    const transporter = createTransporter();
    await transporter.verify();
    console.log('✅ Email configuration is valid');
    return true;
  } catch (error) {
    console.error('❌ Email configuration error:', error.message);
    return false;
  }
};

// Run cleanup every 10 minutes
setInterval(cleanupExpiredCodes, 10 * 60 * 1000);

module.exports = {
  sendVerificationCode,
  verifyCode,
  isCodeVerified,
  cleanupExpiredCodes,
  testEmailConfiguration
};