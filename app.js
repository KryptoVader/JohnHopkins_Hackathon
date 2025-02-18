import express from 'express';
import path from 'path';
import bodyParser from 'body-parser';
import cors from 'cors';
import dotenv from 'dotenv';
import session from 'express-session';
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
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors());
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false },
}));

const postgresPool = new Pool({
  host: process.env.POSTGRES_HOST,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DATABASE,
  port: process.env.POSTGRES_PORT,
  idleTimeoutMillis: 30000, // Close idle connections after 30 seconds
});

// Test the database connection
postgresPool.connect()
  .then(client => {
    console.log("Connected to PostgreSQL!");
    client.release(); // Release the connection back to the pool
  })
  .catch(err => console.error("Error connecting to PostgreSQL:", err));

// Neo4j Database Connection
const neo4jDriver = neo4j.driver(
  process.env.NEO4J_URI,
  neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
);
const neo4jSession = neo4jDriver.session();

async function checkNeo4jConnection() {
  try {
    await neo4jSession.run("RETURN 1");
    console.log("✅ Connected to Neo4j successfully!");
  } catch (error) {
    console.error("❌ Neo4j connection failed:", error);
  }
}

checkNeo4jConnection();

// Routes
app.set("view engine", "ejs");
app.use(express.static(path.join(__dirname, "Public")));
app.use(express.json());
app.set("views", path.join(__dirname, "Public", "views"));
app.use(bodyParser.urlencoded({ extended: true }));

app.get('/admin', async (req, res) => {
  res.render('Admin_login')
});

app.post('/admin', async (req, res) => {
  let client;
  try {
    const { username, password } = req.body;

    // Get a client from the pool
    client = await postgresPool.connect();

    // Query to check if admin exists
    const result = await client.query('SELECT * FROM admins WHERE TRIM(username) = $1', [username]);

    if (result.rows.length > 0) {
      const admin = result.rows[0];

      // Check if the password matches
      if (admin.password === password) {
        // Authentication success
        res.render("Admin");
      } else {
        // Password mismatch
        res.status(401).send('Invalid password');
      }
    } else {
      // Admin not found
      res.status(404).send('Admin not found');
    }
  } catch (err) {
    console.error('Error:', err);
    res.status(500).send('Internal Server Error');
  } finally {
    // Make sure to release the client back to the pool
    if (client) {
      client.release();
    }
  }
});

// Register a Doctor
app.post('/register-doctor', async (req, res) => {
  let client;
  let neo4jSession;
  try {
    const { name, specialization, medical_id, password } = req.body;
    console.log(name, specialization, medical_id, password);

    client = await postgresPool.connect();

    // Insert the doctor record into PostgreSQL and get the generated doctor_id
    const result = await client.query(
      `INSERT INTO doctors (name, specialization, medical_id, password) 
       VALUES ($1, $2, $3, $4) RETURNING doctor_id`,
      [name, specialization, medical_id, password]
    );
    const doctorId = result.rows[0].doctor_id;

    // Store the doctor in Neo4j
    neo4jSession = neo4jDriver.session();
    await neo4jSession.run(
      `CREATE (d:Doctor {doctor_id: $doctorId, name: $name, specialization: $specialization, medical_id: $medical_id})`,
      { doctorId, name, specialization, medical_id }
    );

    // Log the registration activity in PostgreSQL
    await client.query(
      `INSERT INTO recent_activities (action, details, status) VALUES ($1, $2, $3)`,
      ["Doctor Account Created", `${name} - ${specialization}`, "Success"]
    );

    // Prepare a recent activity object for the response
    const recentActivity = {
      activity_date: new Date().toISOString().split('T')[0],
      action: "Doctor Account Created",
      details: `${name} - ${specialization}`,
      status: "Success"
    };

    res.status(201).json({ message: "Doctor registered successfully", doctorId, recentActivity });
  } catch (error) {
    console.error('Error registering doctor:', error);
    res.status(500).json({ message: 'Error registering doctor', error: error.message });
  } finally {
    if (client) client.release();
    if (neo4jSession) await neo4jSession.close();
  }
});

// Register a Staff Member
app.post('/register-staff', async (req, res) => {
  let client;
  let neo4jSession;
  try {
    const { name, role, staff_id, password } = req.body;
    client = await postgresPool.connect();

    // Insert the staff record into PostgreSQL and return the staff_id
    const result = await client.query(
      `INSERT INTO staff (name, role, staff_id, password) 
       VALUES ($1, $2, $3, $4) RETURNING staff_id`,
      [name, role, staff_id, password]
    );
    const insertedStaffId = result.rows[0].staff_id;

    // Optionally store the staff record in Neo4j
    neo4jSession = neo4jDriver.session();
    await neo4jSession.run(
      `CREATE (s:Staff {staff_id: $insertedStaffId, name: $name, role: $role})`,
      { insertedStaffId, name, role }
    );

    // Log the staff registration activity in PostgreSQL
    await client.query(
      `INSERT INTO recent_activities (action, details, status) VALUES ($1, $2, $3)`,
      ["Staff Account Created", `${name} - ${role}`, "Success"]
    );

    // Prepare a recent activity object for the response
    const recentActivity = {
      activity_date: new Date().toISOString().split('T')[0],
      action: "Staff Account Created",
      details: `${name} - ${role}`,
      status: "Success"
    };

    res.status(201).json({ message: "Staff registered successfully", staffId: insertedStaffId, recentActivity });
  } catch (error) {
    console.error('Error registering staff:', error);
    res.status(500).json({ message: 'Error registering staff', error: error.message });
  } finally {
    if (client) client.release();
    if (neo4jSession) await neo4jSession.close();
  }
});

// Register a Patient
app.post('/register-patient', async (req, res) => {
  let client;
  let neo4jSession;
  try {
    const { name, room_number, patient_id, access_code, doctor_id } = req.body;
    client = await postgresPool.connect();

    // Insert patient data into PostgreSQL
    await client.query(
      `INSERT INTO patients (patient_id, name, room_number, access_code, doctor_id, status, age, gender, last_updated) 
       VALUES ($1, $2, $3, $4, $5, 'stable', 0, 'Male', NOW())`,
      [patient_id, name, room_number, access_code, doctor_id]
    );    

    // Store patient in Neo4j and create a relationship with the doctor
    neo4jSession = neo4jDriver.session();
    await neo4jSession.run(
      `
      MATCH (d:Doctor {medical_id: $doctor_id})
      CREATE (p:Patient {
        patient_id: $patient_id, 
        name: $name, 
        room_number: $room_number, 
        access_code: $access_code
      })
      CREATE (d)-[:HAS_PATIENT]->(p)
      RETURN p
      `,
      { patient_id, name, room_number, access_code, doctor_id }
    );

    // Prepare a recent activity object for the response
    const recentActivity = {
      activity_date: new Date().toISOString().split('T')[0],
      action: "Patient Account Created",
      details: `${name} - Room ${room_number}`,
      status: "Success"
    };

    res.status(201).json({ message: "Patient registered successfully", recentActivity });
  } catch (error) {
    console.error('Error registering patient:', error);
    res.status(500).json({ message: 'Error registering patient', error: error.message });
  } finally {
    if (client) client.release();
    if (neo4jSession) await neo4jSession.close();
  }
});


app.get('/', async (req, res) => {
  res.render('index');
})

app.get('/login', async (req, res) => {
  res.render('login')
})

app.post('/login', async (req, res) => {
  let client;
  try {
    client = await postgresPool.connect();
    const { medicalId, staffId, patientId, password } = req.body;

    // Doctor Login
    if (medicalId && password) {
      const doctorResult = await client.query(
        'SELECT * FROM doctors WHERE TRIM(medical_id) = $1',
        [medicalId]
      );

      if (doctorResult.rows.length > 0) {
        const doctor = doctorResult.rows[0];
        if (doctor.password === password) {
          req.session.user = doctor;
          req.session.role = 'doctor';
          return res.json({ role: 'doctor', redirectUrl: '/doctor-dashboard' });
        } else {
          return res.status(401).json({ error: 'Invalid password for doctor.' });
        }
      } else {
        return res.status(404).json({ error: 'Doctor not found.' });
      }
    }

    // Staff Login
    if (staffId && password) {
      const staffResult = await client.query(
        'SELECT * FROM staff WHERE TRIM(staff_id) = $1',
        [staffId]
      );

      if (staffResult.rows.length > 0) {
        const staff = staffResult.rows[0];
        if (staff.password === password) {
          req.session.user = staff;
          req.session.role = 'staff';
          return res.json({ role: 'staff', redirectUrl: '/staff-dashboard' });
        } else {
          return res.status(401).json({ error: 'Invalid password for staff.' });
        }
      } else {
        return res.status(404).json({ error: 'Staff not found.' });
      }
    }

    // Patient Login
    if (patientId && password) {
      const patientResult = await client.query(
        'SELECT * FROM patients WHERE TRIM(patient_id) = $1',
        [patientId]
      );

      if (patientResult.rows.length > 0) {
        const patient = patientResult.rows[0];
        if (patient.access_code === password) {
          req.session.user = patient;
          req.session.role = 'patient';
          return res.json({ role: 'patient', redirectUrl: '/dashboard' });
        } else {
          return res.status(401).json({ error: 'Invalid access code for patient.' });
        }
      } else {
        return res.status(404).json({ error: 'Patient not found.' });
      }
    }

    return res.status(400).json({ error: 'Missing credentials.' });
  } catch (error) {
    console.error('Error during login:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  } finally {
    if (client) client.release();
  }
});

app.get('/staff-dashboard', async (req, res) => {
  if (!req.session.user || req.session.role !== 'staff') {
    return res.redirect('/login'); // Protect route
  }

  res.render('Staff_Dashboard');
});

app.get('/ward', async (req, res) => {
    res.render('ward')
})


app.get('/doctor-dashboard', async (req, res) => {
  if (!req.session.user || req.session.role !== 'doctor') {
    return res.redirect('/login'); // Protect route
  }

  const doctor = req.session.user;
  let client;

  try {
    client = await postgresPool.connect();

    // Fetch patients assigned to this doctor
    const patientResult = await client.query(
      'SELECT * FROM patients WHERE doctor_id = $1',
      [doctor.medical_id]
    );
    const patients = patientResult.rows;

    // Fetch notifications for this doctor
    const notificationResult = await client.query(
      'SELECT * FROM notifications WHERE doctor_id = $1',
      [doctor.medical_id]
    );
    const notifications = notificationResult.rows;

    res.render('Doctor_Dashboard', {
      doctor,
      patients,
      notifications
    });

  } catch (error) {
    console.error('Error fetching doctor dashboard data:', error);
    res.status(500).send('Internal Server Error');
  } finally {
    if (client) client.release();
  }
});

app.get('/dashboard', (req, res) => {
  res.render('dashboard');
});

app.get('/patient', async (req, res) => {
  const { patient_id } = req.query;
  if (!patient_id) return res.status(400).send('Patient ID is required');

  try {
    const client = await postgresPool.connect();

    // Fetch patient details
    const patientRes = await client.query(
      'SELECT * FROM patients WHERE patient_id = $1',
      [patient_id]
    );
    if (!patientRes.rows.length) {
      client.release();
      return res.status(404).send('Patient not found');
    }
    const patient = patientRes.rows[0];

    // Fetch medications, notes, lab orders, and treatment plans
    const [medications, progressNotes, labOrders, treatmentPlan] = await Promise.all([
      client.query('SELECT * FROM Medications WHERE patient_id = $1 ORDER BY started_at DESC', [patient_id]),
      client.query(`SELECT ProgressNotes.*, Doctors.name AS doctor_name FROM ProgressNotes JOIN Doctors ON ProgressNotes.doctor_id = Doctors.medical_id WHERE ProgressNotes.patient_id = $1 ORDER BY ProgressNotes.created_at DESC`, [patient_id]),
      client.query('SELECT * FROM LabOrders WHERE patient_id = $1 ORDER BY ordered_at DESC', [patient_id]),
      client.query('SELECT * FROM TreatmentPlans WHERE patient_id = $1', [patient_id]),
    ]);
    
    // Attach fetched data
    patient.medicationOrders = medications.rows;
    patient.progressNotes = progressNotes.rows;
    patient.labOrders = labOrders.rows;
    if (treatmentPlan.rows.length > 0) {
      patient.treatment_plan = treatmentPlan.rows[0].details;
      patient.treatment_plan_last_updated = treatmentPlan.rows[0].last_updated;
    }

    client.release();
    res.render('patientDetails', { patient });
  } catch (error) {
    console.error('Error fetching patient details:', error);
    res.status(500).send('Internal Server Error');
  }
});

app.post('/update-patient-details', async (req, res) => {

  const { patient_id, name, gender, age, status, room_number } = req.body;
  console.log(patient_id)
  if (!patient_id) {
    return res.status(400).send("Error: Patient ID is missing in the request.");
  }

  try {
    const client = await postgresPool.connect();
    await client.query(
      `UPDATE patients 
       SET name = $1, gender = $2, age = $3, status = $4, room_number = $5, last_updated = NOW() 
       WHERE patient_id = $6`,
      [name, gender, age, status, room_number, patient_id]
    );
    client.release();
    res.redirect(`/patient?patient_id=${patient_id}`);
  } catch (error) {
    console.error('Error updating patient details:', error);
    res.status(500).send('Error updating patient details');
  }
});


app.post('/add-medication', async (req, res) => {
  const { patient_id, doctor_id, medication_name, dosage, frequency, duration } = req.body;
  try {
    const client = await postgresPool.connect();
    await client.query(
      `INSERT INTO Medications (doctor_id, patient_id, name, dosage, frequency, duration, started_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [doctor_id, patient_id, medication_name, dosage, frequency, duration]
    );
    client.release();
    res.redirect(`/patient?patient_id=${patient_id}`);
  } catch (error) {
    console.error('Error adding medication:', error);
    res.status(500).send('Error adding medication');
  }
});


app.post('/update-treatment-plan', async (req, res) => {
  const { patient_id, doctor_id, treatment_plan } = req.body;
  try {
    const client = await postgresPool.connect();
    const tpRes = await client.query(
      'SELECT * FROM TreatmentPlans WHERE patient_id = $1 AND doctor_id = $2',
      [patient_id, doctor_id]
    );

    if (tpRes.rows.length > 0) {
      await client.query(
        'UPDATE TreatmentPlans SET details = $1, last_updated = NOW() WHERE patient_id = $2 AND doctor_id = $3',
        [treatment_plan, patient_id, doctor_id]
      );
    } else {
      await client.query(
        'INSERT INTO TreatmentPlans (doctor_id, patient_id, details, last_updated) VALUES ($1, $2, $3, NOW())',
        [doctor_id, patient_id, treatment_plan]
      );
    }
    client.release();
    res.redirect(`/patient?patient_id=${patient_id}`);
  } catch (error) {
    console.error('Error updating treatment plan:', error);
    res.status(500).send('Error updating treatment plan');
  }
});


app.post('/add-progress-note', async (req, res) => {
  const { patient_id, doctor_id, note } = req.body;
  try {
    const client = await postgresPool.connect();
    await client.query(
      'INSERT INTO ProgressNotes (doctor_id, patient_id, note, created_at) VALUES ($1, $2, $3, NOW())',
      [doctor_id, patient_id, note]
    );
    client.release();
    res.redirect(`/patient?patient_id=${patient_id}`);
  } catch (error) {
    console.error('Error adding progress note:', error);
    res.status(500).send('Error adding progress note');
  }
});

app.post('/add-lab-order', async (req, res) => {
  const { patient_id, doctor_id, test_name, status } = req.body;
  try {
    const client = await postgresPool.connect();
    await client.query(
      `INSERT INTO LabOrders (doctor_id, patient_id, test_name, status, ordered_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [doctor_id, patient_id, test_name, status || 'Pending']
    );
    client.release();
    res.redirect(`/patient?patient_id=${patient_id}`);
  } catch (error) {
    console.error('Error adding lab order:', error);
    res.status(500).send('Error adding lab order');
  }
});

app.get('/patient-details', async (req, res) => {
    res.render('Patient_Details_Staff');
});


app.post('/logout', (req, res) => {
  res.redirect('/');
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
