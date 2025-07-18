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
        const policyData = req.body;

        // Simple validation - just check required fields
        const required = ['title', 'category', 'description', 'minAge', 'maxAge', 'coverageMin', 'coverageMax', 'basePremium'];
        const missing = required.filter(field => !policyData[field]);
        
        if (missing.length > 0) {
          return res.status(400).json({
            success: false,
            message: `Missing required fields: ${missing.join(', ')}`
          });
        }

        // Create new policy with defaults
        const newPolicy = {
          ...policyData,
          minAge: parseInt(policyData.minAge),
          maxAge: parseInt(policyData.maxAge),
          coverageMin: parseFloat(policyData.coverageMin),
          coverageMax: parseFloat(policyData.coverageMax),
          basePremium: parseFloat(policyData.basePremium),
          duration: policyData.duration || "",
          imageUrl: policyData.imageUrl || "",
          applicationsCount: 0,
          createdAt: new Date(),
          updatedAt: new Date()
        };

        const result = await policiesCollection.insertOne(newPolicy);
        
        res.status(201).json({
          success: true,
          message: 'Policy created successfully',
          policy: { ...newPolicy, _id: result.insertedId }
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

    // ==================== APPLICATION ROUTES ====================
    app.post('/applications', async (req, res) => {
      try {
        const applicationData = req.body;
        
        // Simple validation - just check if required data exists
        if (!applicationData.userId || !applicationData.policyId) {
          return res.status(400).json({
            success: false,
            message: 'User ID and Policy ID are required'
          });
        }

        // Check if policy exists
        const policy = await policiesCollection.findOne({ 
          _id: new ObjectId(applicationData.policyId) 
        });
        
        if (!policy) {
          return res.status(404).json({
            success: false,
            message: 'Policy not found'
          });
        }

        // Simply store the entire application data as received from frontend
        const newApplication = {
          ...applicationData,  // This includes all form data
          policyId: new ObjectId(applicationData.policyId),
          submittedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date()
        };

        // Insert application
        const result = await applicationsCollection.insertOne(newApplication);
        
        // Update policy count
        await policiesCollection.updateOne(
          { _id: new ObjectId(applicationData.policyId) },
          { $inc: { applicationsCount: 1 } }
        );

        res.status(201).json({
          success: true,
          message: 'Application submitted successfully',
          application: { ...newApplication, _id: result.insertedId }
        });

      } catch (error) { // ✅ Fixed: Added error parameter
        console.error('Error submitting application:', error);
        res.status(500).json({
          success: false,
          message: 'Failed to submit application',
          error: error.message
        });
      }
    });
    
    // GET all applications (for admin)
    app.get('/applications', async (req, res) => {
      try {
        const applications = await applicationsCollection
          .find({})
          .sort({ createdAt: -1 })
          .toArray();

        res.json({
          success: true,
          applications
        });

      } catch (error) {
        console.error('Error fetching applications:', error);
        res.status(500).json({
          success: false,
          message: 'Failed to fetch applications',
          error: error.message
        });
      }
    });
    
    // GET applications for a specific user
    app.get('/applications/user/:userId', async (req, res) => {
      try {
        const { userId } = req.params;
        
        const applications = await applicationsCollection
          .find({ userId })
          .sort({ createdAt: -1 })
          .toArray();

        // Get policy details for each application
        const applicationsWithPolicy = await Promise.all(
          applications.map(async (app) => {
            const policy = await policiesCollection.findOne({ _id: app.policyId });
            return {
              ...app,
              policy: policy || null,
              policyName: policy?.title || 'Unknown Policy',
              premium: policy?.basePremium || null,
              coverageAmount: policy?.coverageMax || null,
              duration: policy?.duration || null
            };
          })
        );

        res.json({
          success: true,
          applications: applicationsWithPolicy
        });

      } catch (error) {
        console.error('Error fetching user applications:', error);
        res.status(500).json({
          success: false,
          message: 'Failed to fetch applications',
          error: error.message
        });
      }
    });

    // ==================== REVIEW ROUTES ====================
    // Submit review for a policy
    app.post('/reviews', async (req, res) => {
      try {
        const reviewData = req.body;
        
        // Validation
        if (!reviewData.rating || !reviewData.feedback || !reviewData.policyId || !reviewData.userId) {
          return res.status(400).json({
            success: false,
            message: 'Rating, feedback, policy ID, and user ID are required'
          });
        }

        if (reviewData.rating < 1 || reviewData.rating > 5) {
          return res.status(400).json({
            success: false,
            message: 'Rating must be between 1 and 5'
          });
        }

        // Check if user already reviewed this policy
        const existingReview = await reviewsCollection.findOne({
          userId: reviewData.userId,
          policyId: reviewData.policyId
        });

        if (existingReview) {
          return res.status(400).json({
            success: false,
            message: 'You have already reviewed this policy'
          });
        }

        // Create new review
        const newReview = {
          ...reviewData,
          policyId: new ObjectId(reviewData.policyId),
          rating: parseInt(reviewData.rating),
          isApproved: true,
          createdAt: new Date(),
          updatedAt: new Date()
        };

        const result = await reviewsCollection.insertOne(newReview);

        res.status(201).json({
          success: true,
          message: 'Review submitted successfully',
          review: { ...newReview, _id: result.insertedId }
        });

      } catch (error) {
        console.error('Error submitting review:', error);
        res.status(500).json({
          success: false,
          message: 'Failed to submit review',
          error: error.message
        });
      }
    });

    // GET all reviews (for display on website)
    app.get('/reviews', async (req, res) => {
      try {
        const { policyId, limit = 10 } = req.query;
        
        let query = { isApproved: true };
        
        if (policyId) {
          query.policyId = new ObjectId(policyId);
        }

        const reviews = await reviewsCollection
          .find(query)
          .sort({ createdAt: -1 })
          .limit(parseInt(limit))
          .toArray();

        res.json({
          success: true,
          reviews
        });

      } catch (error) {
        console.error('Error fetching reviews:', error);
        res.status(500).json({
          success: false,
          message: 'Failed to fetch reviews',
          error: error.message
        });
      }
    });

    // ==================== USER PROFILE ROUTES ====================
    
    // 1. GET USER PROFILE
    app.get('/users/:uid', async (req, res) => {
      try {
        const user = await usersCollection.findOne({ uid: req.params.uid });
        
        if (!user) {
          return res.status(404).json({ success: false, message: 'User not found' });
        }

        res.json({ success: true, user });

      } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch user' });
      }
    });

    // 2. UPDATE USER PROFILE (Super Simple)
    app.patch('/users/:uid/profile', async (req, res) => {
      try {
        const { displayName, photoURL } = req.body;

        if (!displayName?.trim()) {
          return res.status(400).json({ success: false, message: 'Name is required' });
        }

        await usersCollection.updateOne(
          { uid: req.params.uid },
          { $set: { displayName: displayName.trim(), photoURL, updatedAt: new Date() } }
        );

        const user = await usersCollection.findOne({ uid: req.params.uid });

        res.json({ success: true, message: 'Profile updated', user });

      } catch (error) {
        res.status(500).json({ success: false, message: 'Update failed' });
      }
    });

    // 3. UPDATE LAST LOGIN
    app.patch('/users/:uid/last-login', async (req, res) => {
      try {
        await usersCollection.updateOne(
          { uid: req.params.uid },
          { $set: { lastLogin: new Date() } }
        );

        res.json({ success: true, message: 'Last login updated' });

      } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update' });
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