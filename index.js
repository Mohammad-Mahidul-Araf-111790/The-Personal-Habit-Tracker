// reminder-server.js
const express = require('express');
const cron = require('node-cron');
const nodemailer = require('nodemailer');
const mysql = require('mysql2/promise');
require('dotenv').config();

const app = express();
const port = process.env.REMINDER_PORT || 3001;

// Database connection configuration
const dbConfig = {
  host: process.env.DATABASE_HOST || 'mysql-3e64b06d-dev-projects.f.aivencloud.com',
  user: process.env.DATABASE_USER || 'avnadmin',
  password: process.env.DATABASE_PASSWORD || 'AVNS_1OvsGJOv15x-NB3HYE_',
  database: process.env.DATABASE || 'personal_habit_tracker',
  port: process.env.DATABASE_PORT || 10309,
  ssl: {
    rejectUnauthorized: false
  }
};

// Email transporter configuration - FIXED: createTransport instead of createTransporter
const transporter = nodemailer.createTransport({
  service: 'gmail', // or your email service
  auth: {
    user: process.env.EMAIL_USER || 'your_email@gmail.com',
    pass: process.env.EMAIL_PASSWORD || 'your_app_password' // Use app password for Gmail
  }
});

// Test email configuration
async function testEmailConnection() {
  try {
    await transporter.verify();
    console.log('✓ Email connection verified');
  } catch (error) {
    console.error('✗ Email connection failed:', error.message);
  }
}

// Get current day name
function getCurrentDayName() {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[new Date().getDay()];
}

// Check if reminder should be sent based on frequency and day
function shouldSendReminder(reminder) {
  const now = new Date();
  const currentDay = getCurrentDayName();

  // Get current time in HH:MM format
  const currentHour = now.getHours().toString().padStart(2, '0');
  const currentMinute = now.getMinutes().toString().padStart(2, '0');
  const currentTime = `${currentHour}:${currentMinute}`;

  // Handle reminder time - it might be HH:MM:SS or HH:MM format
  let reminderTime = reminder.reminder_time;
  if (typeof reminderTime === 'string' && reminderTime.includes(':')) {
    // If it's HH:MM:SS format, take only HH:MM
    reminderTime = reminderTime.slice(0, 5);
  }

  console.log(`Checking reminder for ${reminder.habit_name}:`);
  console.log(`  Current time: ${currentTime}, Reminder time: ${reminderTime}`);
  console.log(`  Current day: ${currentDay}, Frequency: ${reminder.frequency}`);
  console.log(`  Day of week setting: ${reminder.day_of_week}`);

  // Check if it's time for the reminder (exact match)
  if (currentTime !== reminderTime) {
    console.log(`  ❌ Time mismatch: ${currentTime} !== ${reminderTime}`);
    return false;
  }

  // Check frequency rules
  switch (reminder.frequency) {
    case 'daily':
      console.log(`  ✓ Daily reminder - sending`);
      return true;

    case 'weekly':
      const shouldSendWeekly = reminder.day_of_week === currentDay;
      console.log(`  ${shouldSendWeekly ? '✓' : '❌'} Weekly reminder - ${reminder.day_of_week} === ${currentDay}: ${shouldSendWeekly}`);
      return shouldSendWeekly;

    case 'specific_days':
      const selectedDays = reminder.day_of_week ? reminder.day_of_week.split(',') : [];
      const shouldSendSpecific = selectedDays.includes(currentDay);
      console.log(`  ${shouldSendSpecific ? '✓' : '❌'} Specific days reminder - ${selectedDays.join(',')} includes ${currentDay}: ${shouldSendSpecific}`);
      return shouldSendSpecific;

    default:
      console.log(`  ❌ Unknown frequency: ${reminder.frequency}`);
      return false;
  }
}

// Send email reminder
async function sendReminderEmail(reminder) {
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: reminder.email,
    subject: `🔔 Reminder: ${reminder.habit_name}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #3B82F6;">Habit Reminder</h2>
        <p>Hi ${reminder.first_name || 'there'}!</p>
        <p>This is a friendly reminder to complete your habit:</p>
        <div style="background-color: #F3F4F6; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin: 0; color: #1F2937;">${reminder.habit_name}</h3>
          ${reminder.description ? `<p style="margin: 10px 0 0 0; color: #6B7280;">${reminder.description}</p>` : ''}
        </div>
        <p>Keep up the great work building healthy habits! 💪</p>
        <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 30px 0;">
        <p style="font-size: 12px; color: #9CA3AF;">
          This reminder was sent because you have notifications enabled for this habit. 
          You can manage your reminders in your habit tracker app.
        </p>
      </div>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`✓ Reminder sent to ${reminder.email} for habit: ${reminder.habit_name}`);
    return true;
  } catch (error) {
    console.error(`✗ Failed to send reminder to ${reminder.email}:`, error.message);
    return false;
  }
}

// Main reminder checking function
async function checkAndSendReminders() {
  let connection;

  try {
    connection = await mysql.createConnection(dbConfig);

    // Get all active reminders with user and habit info
    const [reminders] = await connection.execute(`
      SELECT 
        r.*,
        h.name as habit_name,
        h.description,
        u.email,
        u.first_name,
        u.timezone
      FROM reminders r
      JOIN habits h ON r.habit_id = h.habit_id
      JOIN users u ON h.user_id = u.user_id
      WHERE r.is_enabled = 1 
        AND h.is_active = 1
    `);

    const currentTime = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
    console.log(`[${currentTime}] Checking ${reminders.length} active reminders...`);

    let remindersSent = 0;
    let remindersSkipped = 0;

    for (const reminder of reminders) {
      console.log(`\n--- Processing reminder ${reminder.reminder_id} ---`);

      // Check if we should send this reminder
      if (shouldSendReminder(reminder)) {
        // Check if we haven't already sent it today
        const today = new Date().toISOString().split('T')[0];
        const lastSentDate = reminder.last_sent_at ?
          new Date(reminder.last_sent_at).toISOString().split('T')[0] : null;

        console.log(`  Last sent: ${lastSentDate}, Today: ${today}`);

        if (lastSentDate !== today) {
          console.log(`  🔄 Attempting to send email to ${reminder.email}...`);
          const emailSent = await sendReminderEmail(reminder);

          if (emailSent) {
            // Update last_sent_at timestamp
            await connection.execute(
              'UPDATE reminders SET last_sent_at = NOW() WHERE reminder_id = ?',
              [reminder.reminder_id]
            );
            remindersSent++;
            console.log(`  ✅ Email sent and database updated`);
          } else {
            console.log(`  ❌ Failed to send email`);
          }
        } else {
          console.log(`  ⏭️ Already sent today, skipping`);
          remindersSkipped++;
        }
      } else {
        console.log(`  ⏭️ Not time to send, skipping`);
        remindersSkipped++;
      }
    }

    console.log(`\n📊 Summary: ${remindersSent} sent, ${remindersSkipped} skipped\n`);

  } catch (error) {
    console.error('Error in checkAndSendReminders:', error);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// Schedule cron job to run every minute
cron.schedule('* * * * *', () => {
  console.log('Running reminder check...');
  checkAndSendReminders();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Reminder service is running',
    timestamp: new Date().toISOString()
  });
});

// Test reminder endpoint (for development)
app.get('/test-reminder', async (req, res) => {
  try {
    await checkAndSendReminders();
    res.json({ message: 'Reminder check completed' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start server
app.listen(port, async () => {
  console.log(`🚀 Reminder service listening at http://localhost:${port}`);
  console.log(`📧 Testing email connection...`);
  await testEmailConnection();
  console.log(`⏰ Cron job scheduled to run every minute`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});