require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT ||3000;
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.PAYMENT_GATEWAY_KEY);

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

// Firebase Admin Setup
const admin = require("firebase-admin");
const serviceAccount = require("./firebase-adminsdk-key.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// Middleware: Verify Firebase Token
const verifyFirebaseToken = async (req, res, next) => {
  const authHeader = req.headers?.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).send({ error: 'Unauthorized access' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.decoded = decodedToken;
    next();
  } catch (error) {
    res.status(403).send({ error: 'Forbidden access' });
  }
};  

// ==================== GLOBAL VARIABLES FOR COLLECTIONS ====================
let usersCollection, policiesCollection, applicationsCollection, 
    blogsCollection, reviewsCollection, transactionsCollection, 
    newsletterCollection, paymentsCollection, claimsCollection, faqsCollection;

// ==================== SIMPLE ROLE MIDDLEWARE ====================

// 1. VERIFY ADMIN ROLE
const verifyAdmin = async (req, res, next) => {
  try {
    // Use UID from Firebase token
    const userId = req.decoded?.uid;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User ID is required'
      });
    }

    const user = await usersCollection.findOne({ uid: userId });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin role required.'
      });
    }

    req.user = user;
    next();

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to verify admin role'
    });
  }
};

// 2. VERIFY AGENT ROLE
const verifyAgent = async (req, res, next) => {
  try {
    const userId = req.decoded?.uid;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User ID is required'
      });
    }

    const user = await usersCollection.findOne({ uid: userId });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (user.role !== 'agent') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Agent role required.'
      });
    }

    req.user = user;
    next();

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to verify agent role'
    });
  }
};

// 3. VERIFY CUSTOMER ROLE
const verifyCustomer = async (req, res, next) => {
  try {
    const userId = req.decoded?.uid;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User ID is required'
      });
    }

    const user = await usersCollection.findOne({ uid: userId });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (user.role !== 'customer') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Customer role required.'
      });
    }

    req.user = user;
    next();

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to verify customer role'
    });
  }
};


async function run() {
  try {
    // Connect the client to the server
    // await client.connect();
    
    // Get the database
    const db = client.db("LifeSureDB");
    
    // ✅ ASSIGN COLLECTIONS TO GLOBAL VARIABLES (ADD THIS)
    usersCollection = db.collection("users");
    policiesCollection = db.collection("policies");
    applicationsCollection = db.collection("applications");
    blogsCollection = db.collection("blogs");
    reviewsCollection = db.collection("reviews");
    transactionsCollection = db.collection("transactions");
    newsletterCollection = db.collection("newsletter");
    paymentsCollection = db.collection("payments");
    claimsCollection = db.collection("claims");
    faqsCollection = db.collection("faqs");



    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log("Pinged your deployment. You successfully connected to MongoDB!");

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
    app.post('/policies', verifyFirebaseToken, verifyAdmin, async (req, res) => {
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
    app.put('/policies/:id', verifyFirebaseToken, verifyAdmin, async (req, res) => {
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
    app.delete('/policies/:id', verifyFirebaseToken, verifyAdmin, async (req, res) => {
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
    
    // GET all applications (for admin)
    app.get('/applications', verifyFirebaseToken, verifyAdmin, async (req, res) => {
      try {
        const applications = await applicationsCollection.aggregate([
          {
            $lookup: {
              from: "policies",
              localField: "policyId",
              foreignField: "_id",
              as: "policyInfo"
            }
          },
          {
            $unwind: {
              path: "$policyInfo",
              preserveNullAndEmptyArrays: true
            }
          },
          {
            $addFields: {
              policyName: "$policyInfo.title"
            }
          },
          {
            $sort: { createdAt: -1 }
          }
        ]).toArray();

        res.json({
          success: true,
          applications,
          message: 'All applications fetched by admin'
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          message: 'Failed to fetch applications'
        });
      }
    });
    
    // GET applications for a specific user
    app.get('/applications/user/:userId', verifyFirebaseToken, async (req, res) => {
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
    app.post('/reviews',verifyFirebaseToken, async (req, res) => {
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
    app.get('/users/:uid', verifyFirebaseToken, async (req, res) => {
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
    app.patch('/users/:uid/profile',verifyFirebaseToken, async (req, res) => {
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

    // ==================== STRIPE PAYMENT ROUTES ====================
    
    // 1. CREATE PAYMENT INTENT
    app.post('/create-payment-intent',verifyFirebaseToken, verifyCustomer, async (req, res) => {
      try {
        const { amount, policyId, userId } = req.body;
        
        if (!amount || !policyId || !userId) {
          return res.status(400).json({
            success: false,
            message: 'Amount, Policy ID, and User ID are required'
          });
        }

        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(amount * 100), // Convert to cents
          currency: 'usd',
          metadata: {
            policyId,
            userId
          }
        });

        res.json({
          success: true,
          clientSecret: paymentIntent.client_secret,
          paymentIntentId: paymentIntent.id
        });

      } catch (error) {
        console.error('Error creating payment intent:', error);
        res.status(500).json({
          success: false,
          message: 'Failed to create payment intent',
          error: error.message
        });
      }
    });

    // 2. CONFIRM PAYMENT (called after successful Stripe payment)
    app.post('/confirm-payment',verifyFirebaseToken,verifyCustomer, async (req, res) => {
      try {
        const { paymentIntentId, policyId, amount } = req.body;

        // Simple validation
        if (!paymentIntentId || !policyId || !amount) {
          return res.status(400).json({
            success: false,
            message: 'Payment details are incomplete'
          });
        }

        // Create simple payment record
        const payment = {
          paymentIntentId,
          userId: req.decoded.uid,
          userEmail: req.decoded.email,
          policyId: new ObjectId(policyId),
          amount: parseFloat(amount),
          status: 'completed',
          paymentDate: new Date()
        };

        // Save to database
        await paymentsCollection.insertOne(payment);

        res.json({
          success: true,
          message: 'Payment confirmed successfully'
        });

      } catch (error) {
        res.status(500).json({
          success: false,
          message: 'Payment confirmation failed'
        });
      }
    });


    // ==================== UPDATED PROTECTED ROUTES ====================

    // ADMIN ONLY - Create Policy 
    app.post('/admin/policies', verifyFirebaseToken, verifyAdmin, async (req, res) => {
      try {
        const policyData = req.body;

        const required = ['title', 'category', 'description', 'minAge', 'maxAge', 'coverageMin', 'coverageMax', 'basePremium'];
        const missing = required.filter(field => !policyData[field]);
        
        if (missing.length > 0) {
          return res.status(400).json({
            success: false,
            message: `Missing required fields: ${missing.join(', ')}`
          });
        }

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
          createdBy: req.user.uid,
          createdAt: new Date(),
          updatedAt: new Date()
        };

        const result = await policiesCollection.insertOne(newPolicy);
        
        res.status(201).json({
          success: true,
          message: 'Policy created successfully by admin',
          policy: { ...newPolicy, _id: result.insertedId }
        });

      } catch (error) {
        res.status(500).json({ 
          success: false, 
          message: 'Failed to create policy' 
        });
      }
    });

    // ADMIN ONLY - Delete Policy 
    app.delete('/admin/policies/:id', verifyFirebaseToken, verifyAdmin, async (req, res) => {
      try {
        const { id } = req.params;
        const result = await policiesCollection.deleteOne({ _id: new ObjectId(id) });
        
        if (result.deletedCount === 0) {
          return res.status(404).json({
            success: false,
            message: 'Policy not found'
          });
        }

        res.json({ 
          success: true, 
          message: 'Policy deleted successfully by admin' 
        });
      } catch (error) {
        res.status(500).json({ 
          success: false, 
          message: 'Failed to delete policy' 
        });
      }
    });

    // ADMIN ONLY - Update Policy 
    app.put('/admin/policies/:id', verifyFirebaseToken, verifyAdmin, async (req, res) => {
      try {
        const { id } = req.params;
        const updateData = { 
          ...req.body,
          updatedAt: new Date(),
          updatedBy: req.user.uid
        };
        
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
          message: 'Policy updated successfully by admin',
          policy: updatedPolicy
        });

      } catch (error) {
        res.status(500).json({
          success: false,
          message: 'Failed to update policy'
        });
      }
    });

    // ADMIN ONLY - View All Applications 
    app.get('/admin/applications', verifyFirebaseToken, verifyAdmin, async (req, res) => {
      try {
        const applications = await applicationsCollection.aggregate([
          {
            $lookup: {
              from: "policies",
              localField: "policyId",
              foreignField: "_id",
              as: "policyInfo"
            }
          },
          {
            $unwind: {
              path: "$policyInfo",
              preserveNullAndEmptyArrays: true
            }
          },
          {
            $addFields: {
              policyName: "$policyInfo.title"
            }
          },
          {
            $sort: { createdAt: -1 }
          }
        ]).toArray();

        res.json({
          success: true,
          applications,
          message: 'All applications fetched by admin'
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          message: 'Failed to fetch applications'
        });
      }
    });

    // ADMIN ONLY - View All Payments 
    app.get('/admin/payments', verifyFirebaseToken, verifyAdmin, async (req, res) => {
      try {
        const payments = await paymentsCollection
          .find({})
          .sort({ paymentDate: -1 })
          .toArray();

        res.json({
          success: true,
          payments,
          message: 'All payments fetched by admin'
        });

      } catch (error) {
        res.status(500).json({
          success: false,
          message: 'Failed to fetch payments'
        });
      }
    });

    // ADMIN ONLY - View All Users 
    app.get('/admin/users', verifyFirebaseToken, verifyAdmin, async (req, res) => {
      try {
        const users = await usersCollection
          .find({})
          .sort({ createdAt: -1 })
          .toArray();

        res.json({
          success: true,
          users,
          message: 'All users fetched by admin'
        });

      } catch (error) {
        res.status(500).json({
          success: false,
          message: 'Failed to fetch users'
        });
      }
    });

    // ADMIN ONLY - Role Management 
    app.patch('/admin/users/:targetUserId/role', verifyFirebaseToken, verifyAdmin, async (req, res) => {
      try {
        const { targetUserId } = req.params;
        const { Role } = req.body;

        const validRoles = ['admin', 'agent', 'customer'];
        if (!validRoles.includes(Role)) {
          return res.status(400).json({
            success: false,
            message: 'Invalid role. Must be admin, agent, or customer'
          });
        }

        const result = await usersCollection.updateOne(
          { uid: targetUserId },
          { 
            $set: { 
              role: Role, 
              updatedAt: new Date(),
              updatedBy: req.user.uid
            } 
          }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({
            success: false,
            message: 'User not found'
          });
        }

        res.json({
          success: true,
          message: `User role updated to ${Role} by admin`
        });

      } catch (error) {
        res.status(500).json({ 
          success: false, 
          message: 'Failed to update role' 
        });
      }
    });

    //Submit Application 
    app.post('/customer/applications', verifyFirebaseToken, async (req, res) => {
      try {
        const applicationData = req.body;

        // Fetch user info for all roles
        const user = await usersCollection.findOne({ uid: req.decoded.uid });
        if (!user) {
          return res.status(404).json({ success: false, message: 'User not found' });
        }

        if (!applicationData.policyId) {
          return res.status(400).json({
            success: false,
            message: 'Policy ID is required'
          });
        }

        // Convert policyId to ObjectId and handle invalid format
        let policyObjectId;
        try {
          policyObjectId = new ObjectId(applicationData.policyId);
        } catch (err) {
          return res.status(400).json({
            success: false,
            message: 'Invalid Policy ID format'
          });
        }

        const policy = await policiesCollection.findOne({ _id: policyObjectId });

        if (!policy) {
          return res.status(404).json({
            success: false,
            message: 'Policy not found'
          });
        }

        const newApplication = {
          ...applicationData,
          userId: user.uid,
          userEmail: user.email,
          policyId: policyObjectId,
          policyName: policy.title,
          submittedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date()
        };

        const result = await applicationsCollection.insertOne(newApplication);

        await policiesCollection.updateOne(
          { _id: policyObjectId },
          { $inc: { applicationsCount: 1 } }
        );

        res.status(201).json({
          success: true,
          message: 'Application submitted successfully by customer',
          application: { ...newApplication, _id: result.insertedId }
        });

      } catch (error) {
        console.error('Error submitting application:', error);
        res.status(500).json({
          success: false,
          message: 'Failed to submit application',
          error: error.message
        });
      }
    });

    // CUSTOMER ONLY - Create Payment Intent 
    app.post('/customer/create-payment-intent', verifyFirebaseToken, verifyCustomer, async (req, res) => {
      try {
        const { amount, policyId } = req.body;
        
        if (!amount || !policyId) {
          return res.status(400).json({
            success: false,
            message: 'Amount and Policy ID are required'
          });
        }

        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(amount * 100),
          currency: 'usd',
          metadata: {
            policyId,
            userId: req.user.uid,
            userEmail: req.decoded.email
          }
        });

        res.json({
          success: true,
          message: 'Payment intent created for customer',
          clientSecret: paymentIntent.client_secret,
          paymentIntentId: paymentIntent.id
        });

      } catch (error) {
        res.status(500).json({ 
          success: false, 
          message: 'Failed to create payment intent' 
        });
      }
    });

    // CUSTOMER ONLY - Get Own Applications 
    app.get('/customer/applications', verifyFirebaseToken, verifyCustomer, async (req, res) => {
      try {
        const applications = await applicationsCollection
          .find({ userId: req.user.uid })
          .sort({ createdAt: -1 })
          .toArray();

        const applicationsWithPolicy = await Promise.all(
          applications.map(async (app) => {
            const policy = await policiesCollection.findOne({ _id: app.policyId });
            return {
              ...app,
              policy: policy || null,
              policyName: policy?.title || 'Unknown Policy'
            };
          })
        );

        res.json({
          success: true,
          applications: applicationsWithPolicy
        });

      } catch (error) {
        res.status(500).json({
          success: false,
          message: 'Failed to fetch customer applications'
        });
      }
    });

    // CUSTOMER ONLY - Get Own Payments 
    app.get('/customer/payments', verifyFirebaseToken, verifyCustomer, async (req, res) => {
      try {
        const payments = await paymentsCollection
          .find({ userId: req.user.uid })
          .sort({ paymentDate: -1 })
          .toArray();

        res.json({
          success: true,
          payments
        });

      } catch (error) {
        res.status(500).json({
          success: false,
          message: 'Failed to fetch customer payments'
        });
      }
    });

    // AGENT ONLY - View Applications ( Agent Role) - if you add this later
    app.get('/agent/applications', verifyFirebaseToken, verifyAgent, async (req, res) => {
      try {
        const applications = await applicationsCollection
          .find({})
          .sort({ createdAt: -1 })
          .toArray();

        res.json({ 
          success: true, 
          applications,
          message: 'Applications fetched by agent'
        });
      } catch (error) {
        res.status(500).json({ 
          success: false, 
          message: 'Failed to fetch applications' 
        });
      }
    });

    // AGENT ONLY - Update Application Status
    app.patch('/agent/applications/:id/status', verifyFirebaseToken, verifyAgent, async (req, res) => {
      try {
        const { id } = req.params;
        const { status } = req.body;

        const validStatuses = ['pending', 'approved', 'rejected', 'processing'];
        
        if (!validStatuses.includes(status)) {
          return res.status(400).json({
            success: false,
            message: 'Invalid status'
          });
        }

        const result = await applicationsCollection.updateOne(
          { _id: new ObjectId(id) },
          { 
            $set: { 
              status, 
              updatedAt: new Date(),
              updatedBy: req.user.uid,
              updatedByEmail: req.decoded.email
            } 
          }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({
            success: false,
            message: 'Application not found'
          });
        }

        res.json({
          success: true,
          message: `Application status updated to ${status} by agent`
        });

      } catch (error) {
        res.status(500).json({
          success: false,
          message: 'Failed to update application status'
        });
      }
    });

    // AGENT ONLY - Get Assigned Customers
    app.get('/agent/customers', verifyFirebaseToken, verifyAgent, async (req, res) => {
      try {
        // Find all applications assigned to this agent, newest first
        const applications = await applicationsCollection
          .find({ assignedAgent: req.user.uid })
          .sort({ createdAt: -1 })
          .toArray();

        // Group by userId, keep latest application for each customer
        const customerMap = new Map();
        for (const app of applications) {
          if (!customerMap.has(app.userId)) {
            const user = await usersCollection.findOne({ uid: app.userId });
            customerMap.set(app.userId, {
              _id: app._id, // Add application _id for reference
              userId: app.userId,
              name: user?.displayName || user?.name || app.userEmail,
              email: app.userEmail,
              policies: [app.policyName],
              status: app.status,
            });
          } else {
            const customer = customerMap.get(app.userId);
            customer.policies.push(app.policyName);
          }
        }
        const customers = Array.from(customerMap.values());
        res.json({ success: true, customers });
      } catch (error) {
        res.status(500).json({ success: false, message: "Failed to fetch customers" });
      }
    });
    

    // PROTECTED PROFILE ROUTE - Get User Profile (Firebase Token only)
    app.get('/profile', verifyFirebaseToken, async (req, res) => {
      try {
        const user = await usersCollection.findOne({ uid: req.decoded.uid });
        
        if (!user) {
          return res.status(404).json({
            success: false,
            message: 'User not found'
          });
        }

        res.json({
          success: true,
          user: {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            photoURL: user.photoURL,
            role: user.role,
            createdAt: user.createdAt,
            lastLogin: user.lastLogin
          }
        });

      } catch (error) {
        res.status(500).json({
          success: false,
          message: 'Failed to fetch profile'
        });
      }
    });

    // PROTECTED PROFILE UPDATE - Update User Profile (Firebase Token only)
    app.patch('/profile', verifyFirebaseToken, async (req, res) => {
      try {
        const { displayName, photoURL } = req.body;

        if (!displayName?.trim()) {
          return res.status(400).json({ 
            success: false, 
            message: 'Display name is required' 
          });
        }

        const result = await usersCollection.updateOne(
          { uid: req.decoded.uid },
          { 
            $set: { 
              displayName: displayName.trim(), 
              photoURL, 
              updatedAt: new Date() 
            } 
          }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({
            success: false,
            message: 'User not found'
          });
        }

        const updatedUser = await usersCollection.findOne({ uid: req.decoded.uid });

        res.json({ 
          success: true, 
          message: 'Profile updated successfully', 
          user: updatedUser 
        });

      } catch (error) {
        res.status(500).json({ 
          success: false, 
          message: 'Profile update failed' 
        });
      }
    });

    // PROTECTED PAYMENT CONFIRMATION - Confirm Payment (Firebase Token only)
    app.post('/confirm-payment', verifyFirebaseToken, async (req, res) => {
      try {
        const { 
          paymentIntentId, 
          policyId, 
          amount 
        } = req.body;

        if (!paymentIntentId || !policyId || !amount) {
          return res.status(400).json({
            success: false,
            message: 'Missing required payment information'
          });
        }

        // Create payment record in database
        const paymentRecord = {
          paymentIntentId,
          userId: req.decoded.uid, // From Firebase token
          userEmail: req.decoded.email, // From Firebase token
          policyId: new ObjectId(policyId),
          amount: parseFloat(amount),
          currency: 'usd',
          status: 'completed',
          transactionId: `tx_${Date.now()}`,
          paymentDate: new Date(),
          createdAt: new Date(),
          updatedAt: new Date()
        };

        // Insert payment record
        const result = await paymentsCollection.insertOne(paymentRecord);

        res.json({
          success: true,
          message: 'Payment confirmed successfully',
          payment: { ...paymentRecord, _id: result.insertedId }
        });

      } catch (error) {
        console.error('Error confirming payment:', error);
        res.status(500).json({
          success: false,
          message: 'Failed to confirm payment',
          error: error.message
        });
      }
    });

    // ==================== 📝 BLOG MANAGEMENT APIs ====================
    
    // Get all blogs (public)
    app.get('/blogs', async (req, res) => {
      try {
        const { authorId, limit = 10 } = req.query;
        let query = {};
        if (authorId) query.authorId = authorId;

        const blogs = await blogsCollection
          .find(query)
          .sort({ createdAt: -1 })
          .limit(parseInt(limit))
          .toArray();

        res.json({ success: true, blogs });
      } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch blogs' });
      }
    });

    // AGENT ONLY - Create Blog
    app.post('/agent/blogs', verifyFirebaseToken, verifyAgent, async (req, res) => {
      try {
        const { title, content } = req.body;

        if (!title || !content) {
          return res.status(400).json({ success: false, message: 'Title and content are required' });
        }

        const newBlog = {
          title,
          content,
          authorId: req.user.uid,
          authorName: req.user.displayName || req.decoded.email,
          authorEmail: req.decoded.email,
          publishDate: new Date(),
          createdAt: new Date(),
          updatedAt: new Date()
        };

        const result = await blogsCollection.insertOne(newBlog);
        res.status(201).json({ success: true, message: 'Blog created successfully', blog: { ...newBlog, _id: result.insertedId } });
      } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to create blog' });
      }
    });

    // AGENT ONLY - Get Own Blogs
    app.get('/agent/blogs', verifyFirebaseToken, verifyAgent, async (req, res) => {
      try {
        const blogs = await blogsCollection
          .find({ authorId: req.user.uid })
          .sort({ createdAt: -1 })
          .toArray();

        res.json({ success: true, blogs });
      } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch agent blogs' });
      }
    });

    // AGENT ONLY - Update Blog
    app.put('/agent/blogs/:id', verifyFirebaseToken, verifyAgent, async (req, res) => {
      try {
        const { id } = req.params;
        const { title, content } = req.body;

        const result = await blogsCollection.updateOne(
          { _id: new ObjectId(id), authorId: req.user.uid },
          { $set: { title, content, updatedAt: new Date() } }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ success: false, message: 'Blog not found or access denied' });
        }

        res.json({ success: true, message: 'Blog updated successfully' });
      } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update blog' });
      }
    });

    // AGENT ONLY - Delete Blog
    app.delete('/agent/blogs/:id', verifyFirebaseToken, verifyAgent, async (req, res) => {
      try {
        const { id } = req.params;
        const result = await blogsCollection.deleteOne({ _id: new ObjectId(id), authorId: req.user.uid });

        if (result.deletedCount === 0) {
          return res.status(404).json({ success: false, message: 'Blog not found or access denied' });
        }

        res.json({ success: true, message: 'Blog deleted successfully' });
      } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to delete blog' });
      }
    });

    // ==================== 🧑‍💼 AGENT APPLICATION & MANAGEMENT APIs ====================

    // CUSTOMER - Apply to become Agent
    app.post('/apply-agent', verifyFirebaseToken, verifyCustomer, async (req, res) => {
      try {
        const { experience, qualifications, reason } = req.body;

        const existingApplication = await usersCollection.findOne({
          uid: req.user.uid,
          agentApplicationStatus: { $exists: true }
        });

        if (existingApplication) {
          return res.status(400).json({ success: false, message: 'Agent application already submitted' });
        }

        await usersCollection.updateOne(
          { uid: req.user.uid },
          {
            $set: {
              agentApplicationStatus: 'pending',
              agentApplication: { experience, qualifications, reason, appliedAt: new Date() },
              updatedAt: new Date()
            }
          }
        );

        res.json({ success: true, message: 'Agent application submitted successfully' });
      } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to submit agent application' });
      }
    });

    // ADMIN ONLY - Get Agent Applications
    app.get('/admin/agent-applications', verifyFirebaseToken, verifyAdmin, async (req, res) => {
      try {
        const { status = 'pending' } = req.query;
        const applications = await usersCollection
          .find({ agentApplicationStatus: status })
          .sort({ 'agentApplication.appliedAt': -1 })
          .toArray();

        res.json({ success: true, applications });
      } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch agent applications' });
      }
    });

    // ADMIN ONLY - Approve/Reject Agent Application
    app.patch('/admin/agent-applications/:userId', verifyFirebaseToken, verifyAdmin, async (req, res) => {
      try {
        const { userId } = req.params;
        const { action } = req.body;

        if (!['approve', 'reject'].includes(action)) {
          return res.status(400).json({ success: false, message: 'Invalid action. Use approve or reject' });
        }

        const updateData = {
          agentApplicationStatus: action === 'approve' ? 'approved' : 'rejected',
          updatedAt: new Date(),
          processedBy: req.user.uid,
          processedAt: new Date()
        };

        if (action === 'approve') updateData.role = 'agent';

        const result = await usersCollection.updateOne({ uid: userId }, { $set: updateData });

        if (result.matchedCount === 0) {
          return res.status(404).json({ success: false, message: 'Application not found' });
        }

        res.json({ success: true, message: `Agent application ${action}d successfully` });
      } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to process agent application' });
      }
    });

    // ADMIN ONLY - Get All Agents
    app.get('/admin/agents', verifyFirebaseToken, verifyAdmin, async (req, res) => {
      try {
        const agents = await usersCollection.find({ role: 'agent' }).sort({ createdAt: -1 }).toArray();
        res.json({ success: true, agents });
      } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch agents' });
      }
    });

    // ==================== 🏥 CLAIM REQUEST APIs ====================

    // CUSTOMER ONLY - Submit Claim
    app.post('/customer/claims', verifyFirebaseToken, verifyCustomer, async (req, res) => {
      try {
        const { policyId, reason, documents } = req.body;

        if (!policyId || !reason) {
          return res.status(400).json({ success: false, message: 'Policy ID and reason are required' });
        }

        const application = await applicationsCollection.findOne({
          userId: req.user.uid,
          policyId: new ObjectId(policyId),
          status: 'approved'
        });

        if (!application) {
          return res.status(404).json({ success: false, message: 'Active policy not found' });
        }

        const newClaim = {
          userId: req.user.uid,
          userEmail: req.decoded.email,
          policyId: new ObjectId(policyId),
          applicationId: application._id,
          reason,
          documents: documents || [],
          status: 'pending',
          submittedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date()
        };

        const result = await claimsCollection.insertOne(newClaim);
        res.status(201).json({ success: true, message: 'Claim submitted successfully', claim: { ...newClaim, _id: result.insertedId } });
      } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to submit claim' });
      }
    });

    // CUSTOMER ONLY - Get Own Claims
    app.get('/customer/claims', verifyFirebaseToken, verifyCustomer, async (req, res) => {
      try {
        const claims = await claimsCollection
          .find({ userId: req.user.uid })
          .sort({ createdAt: -1 })
          .toArray();

        res.json({ success: true, claims });
      } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch claims' });
      }
    });

    // ADMIN ONLY - Get All Claims
    app.get('/admin/claims', verifyFirebaseToken, verifyAdmin, async (req, res) => {
      try {
        const claims = await claimsCollection.find({}).sort({ createdAt: -1 }).toArray();
        res.json({ success: true, claims });
      } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch claims' });
      }
    });

    // ==================== 🔄 APPLICATION STATUS UPDATE APIs ====================

    // ADMIN ONLY - Assign Agent to Application
    app.patch('/admin/applications/:id/assign-agent', verifyFirebaseToken, verifyAdmin, async (req, res) => {
      try {
        const { id } = req.params;
        const { agentId } = req.body;

        if (!agentId) {
          return res.status(400).json({ success: false, message: 'Agent ID is required' });
        }

        const agent = await usersCollection.findOne({ uid: agentId, role: 'agent' });
        if (!agent) {
          return res.status(404).json({ success: false, message: 'Agent not found' });
        }

        const result = await applicationsCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              assignedAgent: agentId,
              assignedAgentName: agent.displayName,
              assignedAgentEmail: agent.email,
              assignedAt: new Date(),
              assignedBy: req.user.uid,
              updatedAt: new Date()
            }
          }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ success: false, message: 'Application not found' });
        }

        res.json({ success: true, message: 'Agent assigned successfully' });
      } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to assign agent' });
      }
    });

    // AGENT ONLY - Get Assigned Applications
    app.get('/agent/assigned-applications', verifyFirebaseToken, verifyAgent, async (req, res) => {
      try {
        const applications = await applicationsCollection
          .find({ assignedAgent: req.user.uid })
          .sort({ createdAt: -1 })
          .toArray();

        const applicationsWithDetails = await Promise.all(
          applications.map(async (app) => {
            const policy = await policiesCollection.findOne({ _id: app.policyId });
            const user = await usersCollection.findOne({ uid: app.userId });
            return { ...app, policy: policy || null, customer: user || null };
          })
        );

        res.json({ success: true, applications: applicationsWithDetails });
      } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch assigned applications' });
      }
    });

    // ==================== 💳 ADDITIONAL PAYMENT & APPLICATION APIs ====================

    // GET USER PAYMENTS (for Payments.jsx) - Updated to work with your existing structure
    app.get('/payments/user/:userId', verifyFirebaseToken, async (req, res) => {
      try {
        const { userId } = req.params;
        // Only allow self or admin
        const requestingUser = await usersCollection.findOne({ uid: req.decoded.uid });
        if (requestingUser.role !== 'admin' && req.decoded.uid !== userId) {
          return res.status(403).json({
            success: false,
            message: 'Access denied'
          });
        }

        const payments = await paymentsCollection
          .find({ userId })
          .sort({ paymentDate: -1 })
          .toArray();

        // Attach policy details
        const paymentsWithDetails = await Promise.all(
          payments.map(async (payment) => {
            const policy = await policiesCollection.findOne({ _id: payment.policyId });
            return {
              ...payment,
              policy: policy || null,
              policyName: policy?.title || 'Unknown Policy'
            };
          })
        );

        res.json({
          success: true,
          payments: paymentsWithDetails
        });

      } catch (error) {
        res.status(500).json({
          success: false,
          message: 'Failed to fetch payments'
        });
      }
    });

    // UPDATE APPLICATION STATUS (for Applications.jsx)
    app.patch('/applications/:id/status', verifyFirebaseToken, verifyAdmin, async (req, res) => {
      try {
        const { id } = req.params;
        const { status, assignedAgent } = req.body;

        const updateData = {
          status,
          updatedAt: new Date(),
          updatedBy: req.decoded.uid
        };

        if (assignedAgent) {
          updateData.assignedAgent = assignedAgent;
        }

        const result = await applicationsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateData }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({
            success: false,
            message: 'Application not found'
          });
        }

        res.json({
          success: true,
          message: 'Application status updated successfully'
        });

      } catch (error) {
        res.status(500).json({
          success: false,
          message: 'Failed to update application status'
        });
      }
    });

    // ==================== 📋 ENHANCED APPLICATION MANAGEMENT ====================

    // GET APPLICATION DETAILS (for view details modal)
    app.get('/admin/applications/:id', verifyFirebaseToken, verifyAdmin, async (req, res) => {
      try {
        const { id } = req.params;
        
        const application = await applicationsCollection.findOne({ _id: new ObjectId(id) });
        
        if (!application) {
          return res.status(404).json({
            success: false,
            message: 'Application not found'
          });
        }

        // Get related data
        const policy = await policiesCollection.findOne({ _id: application.policyId });
        const user = await usersCollection.findOne({ uid: application.userId });
        const assignedAgent = application.assignedAgent 
          ? await usersCollection.findOne({ uid: application.assignedAgent })
          : null;

        res.json({
          success: true,
          application: {
            ...application,
            policy: policy || null,
            customer: user || null,
            agent: assignedAgent || null
          }
        });

      } catch (error) {
        res.status(500).json({
          success: false,
          message: 'Failed to fetch application details'
        });
      }
    });

    // REJECT APPLICATION (for reject button)
    app.patch('/admin/applications/:id/reject', verifyFirebaseToken, verifyAdmin, async (req, res) => {
      try {
        const { id } = req.params;
        const { reason } = req.body;

        const result = await applicationsCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              status: 'rejected',
              rejectionReason: reason || 'No reason provided',
              rejectedAt: new Date(),
              rejectedBy: req.user.uid,
              updatedAt: new Date()
            }
          }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({
            success: false,
            message: 'Application not found'
          });
        }

        res.json({
          success: true,
          message: 'Application rejected successfully'
        });

      } catch (error) {
        res.status(500).json({
          success: false,
          message: 'Failed to reject application'
        });
      }
    });

    // ==================== 📊 DASHBOARD STATISTICS ====================

    // GET ADMIN DASHBOARD STATS
    app.get('/admin/dashboard-stats', verifyFirebaseToken, verifyAdmin, async (req, res) => {
      try {
        const totalUsers = await usersCollection.countDocuments();
        const totalPolicies = await policiesCollection.countDocuments();
        const totalApplications = await applicationsCollection.countDocuments();
        const pendingApplications = await applicationsCollection.countDocuments({ status: 'pending' });
        const approvedApplications = await applicationsCollection.countDocuments({ status: 'approved' });
        const totalAgents = await usersCollection.countDocuments({ role: 'agent' });
        const totalCustomers = await usersCollection.countDocuments({ role: 'customer' });

        // Calculate total revenue
        const revenueResult = await paymentsCollection.aggregate([
          { $match: { status: 'completed' } },
          { $group: { _id: null, total: { $sum: '$amount' } } }
        ]).toArray();

        const totalRevenue = revenueResult[0]?.total || 0;

        res.json({
          success: true,
          stats: {
            totalUsers,
            totalPolicies,
            totalApplications,
            pendingApplications,
            approvedApplications,
            totalAgents,
            totalCustomers,
            totalRevenue
          }
        });

      } catch (error) {
        res.status(500).json({
          success: false,
          message: 'Failed to fetch dashboard statistics'
        });
      }
    });

    // ==================== 👤 USER MANAGEMENT ENHANCEMENTS ====================

    // DELETE USER (for user management)
    app.delete('/admin/users/:userId', verifyFirebaseToken, verifyAdmin, async (req, res) => {
      try {
        const { userId } = req.params;

        // Don't allow deleting yourself
        if (userId === req.user.uid) {
          return res.status(400).json({
            success: false,
            message: 'Cannot delete your own account'
          });
        }

        const result = await usersCollection.deleteOne({ uid: userId });

        if (result.deletedCount === 0) {
          return res.status(404).json({
            success: false,
            message: 'User not found'
          });
        }

        res.json({
          success: true,
          message: 'User deleted successfully'
        });

      } catch (error) {
        res.status(500).json({
          success: false,
          message: 'Failed to delete user'
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