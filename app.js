import express from 'express';
import path from 'path';
import bodyParser from 'body-parser';
import cors from 'cors';
import dotenv from 'dotenv';
import pg from 'pg';
import neo4j from 'neo4j-driver';
import { fileURLToPath } from "url";

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 5000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { Pool } = pg;
// Middleware
app.use(bodyParser.json());
app.use(cors());


const postgresPool = new Pool({
    host: process.env.POSTGRES_HOST,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DATABASE,
    port: process.env.POSTGRES_PORT,
    max: 10, // Max connections in the pool
    idleTimeoutMillis: 30000, // Close idle connections after 30 seconds
  });

// Test the database connection
postgresPool.connect()
  .then(client => {
    console.log("Connected to PostgreSQL!");
    client.release(); // Release the connection back to the pool
  })
  .catch(err => console.error("Error connecting to PostgreSQL:", err));

// // Neo4j Database Connection
// const neo4jDriver = neo4j.driver(
//   process.env.NEO4J_URI,
//   neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
// );
// const neo4jSession = neo4jDriver.session();

// Routes
app.set("view engine", "ejs");
app.use(express.static(path.join(__dirname, "Public")));
app.use(express.json());
app.set("views", path.join(__dirname, "Public", "views"));
app.use(bodyParser.urlencoded({ extended: true }));

app.get('/admin', async (req,res) => {
    res.render('Admin_login')
});

app.get('/', async (req,res) => {
    res.render('index');
})

app.get('/login', async (req,res) => {
    res.render('login')
})  

app.post('/login',(req,res) => {
    const { medicalId, password } = req.body; // For Doctor Login
    const { patientId, accessCode } = req.body; // For Patient Login

    console.log('Form submitted:', req.body);
    res.render('dashboard')
})

app.post('/logout', (req, res) => {
    res.redirect('/');
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
