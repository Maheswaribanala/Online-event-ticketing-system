const dns = require("node:dns");
dns.setServers(["1.1.1.1", "8.8.8.8"]);
const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');

// Models & Data
const Ticket = require('./models/Ticket');
const events = require('./data/events');

// Environment variables
dotenv.config();

// Initialize App
const app = express();
const PORT = process.env.PORT || 5000;

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✅ MongoDB Connected'))
.catch(err => console.error('❌ MongoDB Connection Error:', err));

// Middleware
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper - Alert and go back
function sendAlertAndGoBack(res, message) {
  res.send(`<script>alert("${message}"); window.history.back();</script>`);
}

// Homepage
app.get('/', async (req, res) => {
  try {
    const regCounts = {};
    for (const event of events) {
      const count = await Ticket.countDocuments({ eventId: event.id });
      regCounts[event.id] = count;
    }
    res.render('index', { events, regCounts });
  } catch (err) {
    console.error("Error fetching registration counts:", err);
    res.render('index', { events, regCounts: {} });
  }
});

// Event Details Page
app.get('/events/:id', (req, res) => {
  const event = events.find(e => e.id === req.params.id);
  if (!event) {
    return res.status(404).render('error', { message: "Event not found." });
  }

  const deadlineDate = new Date(event.registrationDeadline);
  const now = new Date();
  const registrationDeadlinePassed = now > deadlineDate;

  res.render('event', {
    event,
    countdownDate: event.registrationDeadline,
    registrationDeadlinePassed
  });
});

// Registration Route
app.post('/register', async (req, res) => {
  const { name, email, phone, branch, regNumber, eventId, eventName } = req.body;

  // Validation
  if (!name || !email || !phone || !branch || !regNumber || !eventId || !eventName) {
    return sendAlertAndGoBack(res, "All fields are mandatory. Please fill in all details.");
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return sendAlertAndGoBack(res, "Please enter a valid email address.");
  }

  const phoneRegex = /^\d{10}$/;
  if (!phoneRegex.test(phone)) {
    return sendAlertAndGoBack(res, "Please enter a valid 10-digit phone number.");
  }

  const regNumberRegex = /^[a-zA-Z0-9]{3,15}$/;
  if (!regNumberRegex.test(regNumber)) {
    return sendAlertAndGoBack(res, "Registration Number must be alphanumeric and 3–15 characters long.");
  }

  const targetEvent = events.find(e => e.id === eventId && e.name === eventName);
  if (!targetEvent) {
    return sendAlertAndGoBack(res, "Invalid event selected. Please try again.");
  }

  const now = new Date();
  const regDeadline = new Date(targetEvent.registrationDeadline);
  if (now > regDeadline) {
    return sendAlertAndGoBack(res, "Sorry! Registration deadline has passed.");
  }

  try {
    const existingTicket = await Ticket.findOne({ regNumber, eventId });
    if (existingTicket) {
      return sendAlertAndGoBack(res, `You already registered for ${eventName} with Reg Number: ${regNumber}.`);
    }

    const ticketId = `TICKET-${uuidv4().slice(0, 8).toUpperCase()}`;
    const qrURL = `http://192.168.29.42:${PORT}/ticket/verify/${ticketId}`;

    let qrCodeDataURL;
    try {
      qrCodeDataURL = await QRCode.toDataURL(qrURL);
    } catch (err) {
      console.error('QR Code generation error:', err);
      return sendAlertAndGoBack(res, "Error generating QR code. Please try again.");
    }

    const newTicket = new Ticket({
      name,
      email,
      phone,
      branch,
      regNumber,
      eventId,
      eventName,
      ticketId,
      qrCode: qrCodeDataURL
    });

    await newTicket.save();
    res.render('ticket', { ticket: newTicket });

  } catch (err) {
    console.error("Registration error:", err);
    return sendAlertAndGoBack(res, "Registration failed. Please try again.");
  }
});

// Ticket Verification Route
app.get('/ticket/verify/:ticketId', async (req, res) => {
  try {
    const ticket = await Ticket.findOne({ ticketId: req.params.ticketId });
    if (!ticket) {
      return res.status(404).render('error', {
        message: 'Invalid or Expired Ticket ID. Please ensure the QR code is correct.'
      });
    }
    res.render('verify-ticket', { ticket });
  } catch (err) {
    console.error("Verification error:", err);
    res.status(500).render('error', {
      message: 'Internal server error while verifying ticket. Try again later.'
    });
  }
});

// Redirect /events to home
app.get('/events', (req, res) => res.redirect('/'));

// 404 Page Handler
app.use((req, res) => {
  res.status(404).render('error', {
    message: 'Oops! The page you are looking for does not exist.'
  });
});

// Start the Server
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
