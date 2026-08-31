require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// ===== MONGODB CONNECTION =====
const MONGODB_URI = process.env.MONGODB_URI;

mongoose.connect(MONGODB_URI, {
  serverSelectionTimeoutMS: 10000
})
.then(() => {
  console.log('✅ MongoDB Atlas connected successfully');
  console.log('📊 Database:', mongoose.connection.name);
  console.log('🌐 Host:', mongoose.connection.host);
})
.catch(err => {
  console.error('❌ MongoDB connection error:', err.message);
});

// ===== SCHEMAS =====

// Egg Schema (Products) with productType
const eggSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, required: true, trim: true },
  price: { type: Number, required: true, min: 0 },
  imageUrl: { type: String, required: true },
  productType: { type: String, default: 'default' },
  createdAt: { type: Date, default: Date.now }
});

const Egg = mongoose.model('Egg', eggSchema);

// Order Schema
const orderSchema = new mongoose.Schema({
  orderNumber: { type: String, required: true, unique: true },
  productId: { type: String, required: true },
  productName: { type: String, required: true },
  productPrice: { type: Number, required: true },
  quantity: { type: Number, required: true, min: 1 },
  totalAmount: { type: Number, required: true },
  customerName: { type: String, required: true },
  customerPhone: { type: String, required: true },
  customerEmail: { type: String, default: '' },
  deliveryAddress: { type: String, required: true },
  deliveryCity: { type: String, required: true },
  deliveryPincode: { type: String, required: true },
  specialInstructions: { type: String, default: '' },
  status: { type: String, enum: ['pending', 'confirmed', 'delivered', 'cancelled'], default: 'pending' },
  createdAt: { type: Date, default: Date.now }
});

const Order = mongoose.model('Order', orderSchema);

// ===== ADMIN AUTHENTICATION =====
function adminAuth(req, res, next) {
  const adminPass = req.headers['x-admin-pass'];
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

  if (!adminPass) {
    return res.status(401).json({ error: 'Missing admin password header' });
  }

  if (adminPass !== ADMIN_PASSWORD) {
    return res.status(403).json({ error: 'Invalid admin credentials' });
  }

  next();
}

// ===== IMAGE UPLOAD CONFIGURATION =====
const multerStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage: multerStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// ===== HEALTH CHECK =====
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
});

// ===== ADMIN AUTH ROUTES =====
app.post('/api/admin/verify', (req, res) => {
  const { password } = req.body;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

  if (password === ADMIN_PASSWORD) {
    res.json({ valid: true, message: 'Authentication successful' });
  } else {
    res.status(401).json({ valid: false, error: 'Invalid password' });
  }
});

// ===== PRODUCT ROUTES =====
app.get('/api/eggs', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'Database not connected', eggs: [] });
    }
    const eggs = await Egg.find().sort({ createdAt: -1 });
    res.json(eggs);
  } catch (error) {
    console.error('Error fetching eggs:', error);
    res.status(500).json({ error: 'Failed to fetch eggs', eggs: [] });
  }
});

app.get('/api/eggs/:id', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'Database not connected' });
    }
    const egg = await Egg.findById(req.params.id);
    if (!egg) {
      return res.status(404).json({ error: 'Egg not found' });
    }
    res.json(egg);
  } catch (error) {
    console.error('Error fetching egg:', error);
    res.status(500).json({ error: 'Failed to fetch egg' });
  }
});

// ===== IMAGE UPLOAD ROUTE =====
app.post('/api/upload', upload.single('image'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }
    const imageUrl = `/uploads/${req.file.filename}`;
    res.json({ url: imageUrl, message: 'Image uploaded successfully' });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

app.get('/uploads/:filename', (req, res) => {
  const filePath = path.join(uploadsDir, req.params.filename);
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).json({ error: 'Image not found' });
  }
});

// ===== ORDER ROUTES =====
app.post('/api/orders', async (req, res) => {
  try {
    const { 
      productId, productName, productPrice, quantity, totalAmount,
      customerName, customerPhone, customerEmail,
      deliveryAddress, deliveryCity, deliveryPincode, specialInstructions
    } = req.body;

    if (!productId || !productName || !productPrice || !quantity || !totalAmount ||
        !customerName || !customerPhone || !deliveryAddress || !deliveryCity || !deliveryPincode) {
      return res.status(400).json({ error: 'All required fields must be filled' });
    }

    const phoneRegex = /^[0-9]{10}$/;
    if (!phoneRegex.test(customerPhone)) {
      return res.status(400).json({ error: 'Please enter a valid 10-digit phone number' });
    }

    const pincodeRegex = /^[0-9]{6}$/;
    if (!pincodeRegex.test(deliveryPincode)) {
      return res.status(400).json({ error: 'Please enter a valid 6-digit pincode' });
    }

    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'Database not connected. Cannot place order.' });
    }

    const orderNumber = 'ORD-' + Date.now().toString().slice(-8) + '-' + Math.floor(Math.random() * 1000);

    const order = new Order({
      orderNumber,
      productId,
      productName,
      productPrice,
      quantity,
      totalAmount,
      customerName,
      customerPhone,
      customerEmail: customerEmail || '',
      deliveryAddress,
      deliveryCity,
      deliveryPincode,
      specialInstructions: specialInstructions || ''
    });

    await order.save();
    console.log('✅ New order saved:', orderNumber);
    res.status(201).json(order);
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ error: 'Failed to place order' });
  }
});

app.get('/api/orders', adminAuth, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'Database not connected', orders: [] });
    }
    const orders = await Order.find().sort({ createdAt: -1 });
    res.json(orders);
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ error: 'Failed to fetch orders', orders: [] });
  }
});

app.get('/api/orders/:id', adminAuth, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'Database not connected' });
    }
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    res.json(order);
  } catch (error) {
    console.error('Error fetching order:', error);
    res.status(500).json({ error: 'Failed to fetch order' });
  }
});

app.put('/api/admin/orders/:id/status', adminAuth, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['pending', 'confirmed', 'delivered', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'Database not connected' });
    }
    const order = await Order.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    res.json(order);
  } catch (error) {
    console.error('Error updating order status:', error);
    res.status(500).json({ error: 'Failed to update order status' });
  }
});

app.delete('/api/admin/orders/:id', adminAuth, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'Database not connected' });
    }
    const order = await Order.findByIdAndDelete(req.params.id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting order:', error);
    res.status(500).json({ error: 'Failed to delete order' });
  }
});

// ===== ADMIN PRODUCT ROUTES =====
app.post('/api/admin/eggs', adminAuth, async (req, res) => {
  try {
    const { name, description, price, imageUrl, productType } = req.body;
    if (!name || !description || !price || !imageUrl) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    if (price < 0) {
      return res.status(400).json({ error: 'Price cannot be negative' });
    }
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'Database not connected' });
    }
    const egg = new Egg({ 
      name, 
      description, 
      price: parseFloat(price), 
      imageUrl,
      productType: productType || 'default'
    });
    await egg.save();
    res.status(201).json(egg);
  } catch (error) {
    console.error('Error creating egg:', error);
    res.status(500).json({ error: 'Failed to create egg' });
  }
});

app.delete('/api/admin/eggs/:id', adminAuth, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'Database not connected' });
    }
    const egg = await Egg.findByIdAndDelete(req.params.id);
    if (!egg) {
      return res.status(404).json({ error: 'Egg not found' });
    }
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting egg:', error);
    res.status(500).json({ error: 'Failed to delete egg' });
  }
});

app.put('/api/admin/eggs/:id', adminAuth, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'Database not connected' });
    }
    const egg = await Egg.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!egg) {
      return res.status(404).json({ error: 'Egg not found' });
    }
    res.json(egg);
  } catch (error) {
    console.error('Error updating egg:', error);
    res.status(500).json({ error: 'Failed to update egg' });
  }
});

// ===== SEED DATABASE =====
app.post('/api/seed', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(400).json({ error: 'Database not connected' });
    }
    const sampleEggs = [
      { 
        name: 'Natu Kodi Eggs', 
        description: 'Premium free-range country eggs, rich in protein and nutrients', 
        price: 400, 
        imageUrl: 'type:egg',
        productType: 'egg'
      },
      { 
        name: 'Organic Brown Eggs', 
        description: 'Nutritious organic brown eggs from free-range hens', 
        price: 350, 
        imageUrl: 'type:egg',
        productType: 'egg'
      },
      { 
        name: 'Omega-3 Enriched Eggs', 
        description: 'Eggs rich in Omega-3 fatty acids for better health', 
        price: 450, 
        imageUrl: 'type:egg',
        productType: 'egg'
      }
    ];
    await Egg.deleteMany({});
    const seeds = await Egg.insertMany(sampleEggs);
    res.status(201).json({ message: 'Database seeded successfully', count: seeds.length });
  } catch (error) {
    console.error('Error seeding database:', error);
    res.status(500).json({ error: 'Failed to seed database' });
  }
});

// ===== CONTACT FORM =====
app.post('/api/contact', async (req, res) => {
  try {
    const { name, email, phone, message } = req.body;
    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Please fill all required fields' });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address' });
    }
    console.log('📧 Contact form submission:', { name, email, phone, message });
    res.status(200).json({ success: true, message: 'Message received!' });
  } catch (error) {
    console.error('Contact error:', error);
    res.status(500).json({ error: 'Failed to process your request.' });
  }
});

// ===== ERROR HANDLING =====
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Max size is 5MB.' });
    }
    return res.status(400).json({ error: err.message });
  }
  res.status(500).json({ error: 'Internal server error' });
});

// ===== START SERVER =====
app.listen(PORT, () => {
  console.log('=========================================');
  console.log('🚀 Server running on port:', PORT);
  console.log('=========================================');
});