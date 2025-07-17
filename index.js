const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

dotenv.config();

const app = express();
const PORT = process.env.PORT ||3000;

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.esy9tcr.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server
    await client.connect();
    
    // Get the database
    const db = client.db("LifeSureDB");
    
    // Define collections
    const usersCollection = db.collection("users");
    const policiesCollection = db.collection("policies");
    const applicationsCollection = db.collection("applications");
    const blogsCollection = db.collection("blogs");
    const reviewsCollection = db.collection("reviews");
    const transactionsCollection = db.collection("transactions");
    const newsletterCollection = db.collection("newsletter");




    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");

    // Basic route
    app.get('/', (req, res) => {
      res.send('LifeSure Server is running successfully!');
    });

    // Test route to check collections
    app.get('/test', async (req, res) => {
      try {
        const collections = await db.listCollections().toArray();
        res.json({ 
          message: "Database connected successfully!", 
          collections: collections.map(col => col.name),
          timestamp: new Date()
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // ==================== USER ROUTES ====================
    // Create or update user profile
    app.post('/users', async (req, res) => {
      try {
        const { uid, email, displayName, photoURL, provider = 'email' } = req.body;

        if (!uid || !email) {
          return res.status(400).json({ 
            success: false,
            error: 'UID and email are required' 
          });
        }

        // Check if user already exists
        const existingUser = await usersCollection.findOne({ uid });

        if (existingUser) {
          // Update existing user
          const updateData = {
            email,
            displayName,
            photoURL,
            lastLogin: new Date(),
            updatedAt: new Date()
          };

          await usersCollection.updateOne({ uid }, { $set: updateData });
          const updatedUser = await usersCollection.findOne({ uid });
          
          return res.json({
            success: true,
            message: 'User profile updated successfully',
            user: updatedUser
          });
        } else {
          // Create new user with default customer role
          const newUser = {
            uid,
            email,
            displayName: displayName || email.split('@')[0],
            photoURL: photoURL || null,
            role: 'customer', // 🎯 This is the key line - automatic customer role
            provider,
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
            lastLogin: new Date()
          };

          await usersCollection.insertOne(newUser);
          
          return res.status(201).json({
            success: true,
            message: 'User created successfully with customer role',
            user: newUser
          });
        }
      } catch (error) {
        console.error('Error creating/updating user:', error);
        res.status(500).json({ 
          success: false,
          error: 'Failed to create/update user profile' 
        });
      }
    });

    // ==================== POLICY CRUD APIs ====================
    
    // 1. ADD POLICY (CREATE)
    app.post('/policies', async (req, res) => {
      try {
        const {
          title,
          category,
          description,
          minAge,
          maxAge,
          coverageMin,
          coverageMax,
          duration,
          basePremium,
          imageUrl
        } = req.body;

        // Validation
        if (!title || !category || !description || !minAge || !maxAge || !coverageMin || !coverageMax || !basePremium) {
          return res.status(400).json({
            success: false,
            message: 'All required fields must be provided'
          });
        }

        // Create new policy
        const newPolicy = {
          title,
          category,
          description,
          minAge: parseInt(minAge),
          maxAge: parseInt(maxAge),
          coverageMin: parseFloat(coverageMin),
          coverageMax: parseFloat(coverageMax),
          duration: duration || "",
          basePremium: parseFloat(basePremium),
          imageUrl: imageUrl || "",
          applicationsCount: 0,
        };

        const result = await policiesCollection.insertOne(newPolicy);
        const createdPolicy = await policiesCollection.findOne({ _id: result.insertedId });
        
        res.status(201).json({
          success: true,
          message: 'Policy created successfully',
          policy: createdPolicy
        });

      } catch (error) {
        console.error('Error creating policy:', error);
        res.status(500).json({
          success: false,
          message: 'Failed to create policy',
          error: error.message
        });
      }
    });

    // 2. GET ALL POLICIES (READ)
    app.get('/policies', async (req, res) => {
      try {
        const { 
          search,           // Search in title and category only
          category,         // Filter by specific category
          sortBy = 'createdAt', // Sort field
          sortOrder = 'desc',   // Sort order (asc/desc)
          page = 1,        // Page number for pagination
          limit = 10       // Items per page
        } = req.query;

        // Build dynamic query object
        let query = {};

        // 🔍 Case-insensitive search ONLY in title and category
        if (search && search.trim()) {
          query.$or = [
            { title: { $regex: search.trim(), $options: 'i' } },
            { category: { $regex: search.trim(), $options: 'i' } }
          ];
        }

        // 📂 Category filter (case-insensitive)
        if (category && category.trim() && category !== 'all') {
          query.category = { $regex: `^${category.trim()}$`, $options: 'i' };
        }

        //  Pagination setup
        const pageNum = parseInt(page) || 1;
        const limitNum = parseInt(limit) || 10;
        const skip = (pageNum - 1) * limitNum;

        // 🔄 Sort setup
        const sortField = sortBy || 'createdAt';
        const sortDirection = sortOrder === 'asc' ? 1 : -1;
        const sortObj = { [sortField]: sortDirection };

        // 📊 Execute query with filters, sorting, and pagination
        const policies = await policiesCollection
          .find(query)
          .sort(sortObj)
          .skip(skip)
          .limit(limitNum)
          .toArray();

        // 📈 Get total count for pagination
        const totalPolicies = await policiesCollection.countDocuments(query);
        const totalPages = Math.ceil(totalPolicies / limitNum);

        // 📋 Response with pagination info
        res.json({
          success: true,
          policies,
          pagination: {
            currentPage: pageNum,
            totalPages,
            totalPolicies,
            hasNext: pageNum < totalPages,
            hasPrev: pageNum > 1,
            limit: limitNum
          },
          filters: {
            search: search || null,
            category: category || null,
            sortBy: sortField,
            sortOrder: sortOrder
          }
        });

      } catch (error) {
        console.error('Error fetching policies:', error);
        res.status(500).json({
          success: false,
          message: 'Failed to fetch policies',
          error: error.message
        });
      }
    });

    // 🔥 TOP POLICIES ENDPOINT (for frontend) - MUST BE BEFORE /:id route
    app.get('/policies/top-policies', async (req, res) => {
      try {
        const policies = await policiesCollection
          .find({})
          .sort({ applicationsCount: -1 })
          .limit(6)
          .toArray();

        res.json({
          success: true,
          message: 'Top policies retrieved successfully',
          policies
        });

      } catch (error) {
        console.error('Error fetching top policies:', error);
        res.status(500).json({
          success: false,
          message: 'Failed to fetch top policies',
          error: error.message
        });
      }
    });

    // 3. GET SINGLE POLICY (READ)
    app.get('/policies/:id', async (req, res) => {
      try {
        const { id } = req.params;
        const policy = await policiesCollection.findOne({ 
          _id: new ObjectId(id)
        });

        if (!policy) {
          return res.status(404).json({
            success: false,
            message: 'Policy not found'
          });
        }

        res.json({
          success: true,
          policy
        });

      } catch (error) {
        console.error('Error fetching policy:', error);
        res.status(500).json({
          success: false,
          message: 'Failed to fetch policy',
          error: error.message
        });
      }
    });



    // 4. EDIT POLICY (UPDATE)
    app.put('/policies/:id', async (req, res) => {
      try {
        const { id } = req.params;
        const updateData = { ...req.body };
        const result = await policiesCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateData }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({
            success: false,
            message: 'Policy not found'
          });
        }

        const updatedPolicy = await policiesCollection.findOne({ 
          _id: new ObjectId(id) 
        });

        res.json({
          success: true,
          message: 'Policy updated successfully',
          policy: updatedPolicy
        });

      } catch (error) {
        console.error('Error updating policy:', error);
        res.status(500).json({
          success: false,
          message: 'Failed to update policy',
          error: error.message
        });
      }
    });

    // 5. DELETE POLICY (DELETE)
    app.delete('/policies/:id', async (req, res) => {
      try {
        const { id } = req.params;

        const result = await policiesCollection.deleteOne({ 
          _id: new ObjectId(id) 
        });

        if (result.deletedCount === 0) {
          return res.status(404).json({
            success: false,
            message: 'Policy not found'
          });
        }

        res.json({
          success: true,
          message: 'Policy deleted successfully'
        });

      } catch (error) {
        console.error('Error deleting policy:', error);
        res.status(500).json({
          success: false,
          message: 'Failed to delete policy',
          error: error.message
        });
      }
    });

    // Start server
    app.listen(PORT, () => {
      console.log(`LifeSure Server is running on http://localhost:${PORT}`);
    });

  } catch (error) {
    console.error("Failed to connect to MongoDB:", error);
    process.exit(1);
  }
}

run().catch(console.dir);