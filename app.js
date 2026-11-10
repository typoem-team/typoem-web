const express = require('express');
const path = require('path');
const cors = require('cors');

// for Swagger
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');

const authRouter = require('./routes/auth');
const usersRouter = require('./routes/users');
const roomsRouter = require('./routes/rooms');
const dictionaryRouter = require('./routes/dictionary');
const { roomMemosRouter, memosRouter } = require('./routes/memos');
const { roomAnnotationsRouter, annotationsRouter } = require('./routes/annotations');
const publicRouter = require('./routes/public'); 
const vocabRouter = require('./routes/vocab');
const { booksRouter, roomBooksRouter } = require('./routes/books');

const app = express();

// CORS — allow the Capacitor app (Android: https://localhost, iOS: capacitor://localhost).
// Same-origin web pages send no Origin header and are always allowed.
const allowedOrigins = (process.env.CORS_ORIGINS ||
  'https://localhost,capacitor://localhost,http://localhost')
  .split(',').map((s) => s.trim()).filter(Boolean);

app.use(cors({
  origin(origin, cb) {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(null, false);
  },
}));

app.use(express.json());

// Serve the landing page at the root, before express.static auto-serves index.html.
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/rooms', roomsRouter);
app.use('/api/rooms', roomBooksRouter); // before memos/annotations
app.use('/api/rooms', roomMemosRouter);
app.use('/api/memos', memosRouter);
app.use('/api/rooms', roomAnnotationsRouter);
app.use('/api/annotations', annotationsRouter);
app.use('/api/dictionary', dictionaryRouter);
app.use('/api/public', publicRouter);   
app.use('/api/vocab', vocabRouter);
app.use('/api/books', booksRouter);


// API docs
const swaggerDocument = YAML.load(path.join(__dirname, 'openapi.yaml'));
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', app: 'Typoem' });
});

module.exports = app;