import express from 'express';
import path from 'path';
import bodyParser from 'body-parser';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import mysql from 'mysql2/promise';
import neo4j from 'neo4j-driver';
import { fileURLToPath } from "url";

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 5000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Middleware
app.use(bodyParser.json());
app.use(cors());


// // MySQL Database Connection
// const mysqlPool = mysql.createPool({
//   host: process.env.MYSQL_HOST,
//   user: process.env.MYSQL_USER,
//   password: process.env.MYSQL_PASSWORD,
//   database: process.env.MYSQL_DATABASE,
//   waitForConnections: true,
//   connectionLimit: 10,
// });

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
