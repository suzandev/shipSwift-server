const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

dotenv.config();

// =========================
// STRIPE INIT
// =========================
if (!process.env.STRIPE_SECRET_KEY) {
  console.error("❌ STRIPE_SECRET_KEY is missing in .env");
}

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// =========================
// MongoDB SETUP
// =========================
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.on5po.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    const db = client.db("parcelDB");
    const parcelCollection = db.collection("parcels");

    // 🔥 NEW COLLECTION
    const trackingCollection = db.collection("tracking");

    // 🔥 INDEX (IMPORTANT)
    await trackingCollection.createIndex({ trackingNumber: 1 });

    // =========================
    // GET ALL PARCELS
    // =========================
    app.get("/parcels", async (req, res) => {
      try {
        const parcels = await parcelCollection.find().toArray();
        res.send(parcels);
      } catch {
        res.status(500).send({ error: "Failed to fetch parcels" });
      }
    });

    // =========================
    // CREATE PARCEL + TRACKING
    // =========================
    app.post("/parcels", async (req, res) => {
      try {
        const parcel = req.body;

        parcel.created_by = parcel.userEmail;
        parcel.creation_date = new Date();
        parcel.parcelStatus = "pending";
        parcel.paymentStatus = "unpaid";

        // 🔥 TRACKING NUMBER GENERATE
        const trackingNumber = `SWIFT-${Math.random()
          .toString(36)
          .substring(2, 8)
          .toUpperCase()}`;

        parcel.trackingNumber = trackingNumber;

        // 🔥 PRICE
        let amount = 0;

        if (parcel.parcelType === "document") {
          amount = 60;
        } else {
          const weight = parcel.weight || 0;
          amount = weight <= 1 ? 80 : 80 + (weight - 1) * 20;
        }

        parcel.price = amount;

        const result = await parcelCollection.insertOne(parcel);

        // 🔥 INITIAL TRACK ENTRY
        await trackingCollection.insertOne({
          trackingNumber,
          parcelId: result.insertedId,
          status: "Pending",
          message: "Parcel created",
          location: parcel.senderCenter || "Warehouse",
          time: new Date(),
        });

        res.send(result);
      } catch (error) {
        res.status(500).send({ error: "Failed to create parcel" });
      }
    });

    // =========================
    // ADD TRACK UPDATE
    // =========================
    app.post("/tracking", async (req, res) => {
      try {
        const { trackingNumber, status, message, location } = req.body;

        const result = await trackingCollection.insertOne({
          trackingNumber,
          status,
          message,
          location,
          time: new Date(),
        });
        // 🔥 2. UPDATE PARCEL STATUS
        await parcelCollection.updateOne(
          { trackingNumber },
          {
            $set: {
              parcelStatus: status.toLowerCase(),
            },
          },
        );

        res.send(result);
      } catch {
        res.status(500).send({ error: "Failed to add tracking update" });
      }
    });

    // =========================
    // GET TRACKING HISTORY
    // =========================
    app.get("/tracking/:trackingNumber", async (req, res) => {
      try {
        const trackingNumber = req.params.trackingNumber.toUpperCase();

        const updates = await trackingCollection
          .find({ trackingNumber })
          .sort({ time: 1 })
          .toArray();

        if (!updates.length) {
          return res.status(404).send({ error: "Tracking not found" });
        }

        res.send(updates);
      } catch {
        res.status(500).send({ error: "Failed to fetch tracking" });
      }
    });

    // =========================
    // GET USER PARCELS
    // =========================
    app.get("/parcels/user", async (req, res) => {
      try {
        const email = req.query.email;

        if (!email) {
          return res.status(400).send({ error: "Email is required" });
        }

        const parcels = await parcelCollection
          .find({ created_by: email })
          .sort({ creation_date: -1 })
          .toArray();

        res.send(parcels);
      } catch {
        res.status(500).send({ error: "Failed to fetch user parcels" });
      }
    });

    // =========================
    // STATS
    // =========================
    app.get("/parcels/stats", async (req, res) => {
      try {
        const email = req.query.email;

        const statsData = await parcelCollection
          .aggregate([
            { $match: { created_by: email } },
            {
              $group: {
                _id: "$parcelStatus",
                count: { $sum: 1 },
              },
            },
          ])
          .toArray();

        const stats = { pending: 0, shipped: 0, delivered: 0 };

        statsData.forEach((item) => {
          if (item._id === "pending") stats.pending = item.count;
          if (item._id === "shipped") stats.shipped = item.count;
          if (item._id === "delivered") stats.delivered = item.count;
        });

        res.send(stats);
      } catch {
        res.status(500).send({ error: "Failed to fetch stats" });
      }
    });

    // =========================
    // PAYMENT HISTORY
    // =========================
    app.get("/payments", async (req, res) => {
      try {
        const email = req.query.email;

        const payments = await parcelCollection
          .find({ created_by: email, paymentStatus: "paid" })
          .sort({ paid_at: -1 })
          .toArray();

        res.send(payments);
      } catch {
        res.status(500).send({ error: "Failed to fetch payments" });
      }
    });

    // =========================
    // STRIPE PAYMENT INTENT
    // =========================
    app.post("/create-payment-intent", async (req, res) => {
      try {
        const { parcelId } = req.body;

        const parcel = await parcelCollection.findOne({
          _id: new ObjectId(parcelId),
        });

        let amount = parcel.price || 60;
        const amountInUSD = amount / 110;

        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(amountInUSD * 100),
          currency: "usd",
          payment_method_types: ["card"],
        });

        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // =========================
    // PAYMENT UPDATE
    // =========================
    app.patch("/parcels/payment/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const { email, transactionId } = req.body;

        const result = await parcelCollection.updateOne(
          { _id: new ObjectId(id), created_by: email },
          {
            $set: {
              paymentStatus: "paid",
              paid_at: new Date(),
              transactionId,
            },
          },
        );

        res.send(result);
      } catch {
        res.status(500).send({ error: "Failed to update payment" });
      }
    });

    console.log("✅ MongoDB Connected");
  } finally {
  }
}

run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("🚀 Parcel Server Running");
});

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
