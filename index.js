const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

dotenv.config();

// =========================
// STRIPE INIT (FIXED)
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
    // CREATE PARCEL (PRICE FIXED HERE)
    // =========================
    app.post("/parcels", async (req, res) => {
      try {
        const parcel = req.body;

        parcel.created_by = parcel.userEmail;
        parcel.creation_date = new Date();
        parcel.parcelStatus = "pending";
        parcel.paymentStatus = "unpaid";

        // 🔥 PRICE CALCULATION (FIXED)
        let amount = 0;

        if (parcel.parcelType === "document") {
          amount = 60;
        } else {
          const weight = parcel.weight || 0;
          amount = weight <= 1 ? 80 : 80 + (weight - 1) * 20;
        }

        parcel.price = amount;

        const result = await parcelCollection.insertOne(parcel);
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: "Failed to create parcel" });
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

        if (!email) {
          return res.status(400).send({ error: "Email is required" });
        }

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

        const stats = {
          pending: 0,
          shipped: 0,
          delivered: 0,
        };

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
    // GET SINGLE PARCEL (PRICE SAFETY FIX)
    // =========================
    app.get("/parcels/:id", async (req, res) => {
      try {
        const id = req.params.id;

        const parcel = await parcelCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!parcel) {
          return res.status(404).send({ error: "Parcel not found" });
        }

        // 🔥 FIX OLD DATA (ENSURE PRICE ALWAYS EXISTS)
        if (!parcel.price) {
          let amount = 0;

          if (parcel.parcelType === "document") {
            amount = 60;
          } else {
            const weight = parcel.weight || 0;
            amount = weight <= 1 ? 80 : 80 + (weight - 1) * 20;
          }

          parcel.price = amount;
        }

        res.send(parcel);
      } catch {
        res.status(500).send({ error: "Failed to fetch parcel" });
      }
    });

    // =========================
    // DELETE PARCEL
    // =========================
    app.delete("/parcels/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const email = req.query.email;

        const query = email
          ? { _id: new ObjectId(id), created_by: email }
          : { _id: new ObjectId(id) };

        const result = await parcelCollection.deleteOne(query);

        if (result.deletedCount === 0) {
          return res.status(404).send({ error: "Parcel not found" });
        }

        res.send({ success: true });
      } catch {
        res.status(500).send({ error: "Failed to delete parcel" });
      }
    });

    // =========================
    // 💳 STRIPE PAYMENT INTENT (FIXED)
    // =========================
    app.post("/create-payment-intent", async (req, res) => {
      try {
        const { parcelId } = req.body;

        const parcel = await parcelCollection.findOne({
          _id: new ObjectId(parcelId),
        });

        if (!parcel) {
          return res.status(404).send({ error: "Parcel not found" });
        }

        // 🔥 ALWAYS USE DB PRICE
        const amount = parcel.price || 0;

        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount * 100,
          currency: "bdt",
          payment_method_types: ["card"],
        });

        res.send({
          clientSecret: paymentIntent.client_secret,
        });
      } catch (error) {
        res.status(500).send({ error: "Failed to create payment intent" });
      }
    });

    // =========================
    // PAYMENT UPDATE (SECURED FIXED)
    // =========================
    app.patch("/parcels/payment/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const { email, transactionId } = req.body;

        if (!email) {
          return res.status(400).send({ error: "Email required" });
        }

        const result = await parcelCollection.updateOne(
          {
            _id: new ObjectId(id),
            created_by: email,
          },
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

    // =========================
    // DB CHECK
    // =========================
    await client.db("admin").command({ ping: 1 });
    console.log("✅ MongoDB Connected");
  } finally {
    // keep alive
  }
}

run().catch(console.dir);

// =========================
// ROOT
// =========================
app.get("/", (req, res) => {
  res.send("🚀 Parcel Server Running");
});

// =========================
// START SERVER
// =========================
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
