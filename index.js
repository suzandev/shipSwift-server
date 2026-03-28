const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion } = require("mongodb");

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

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

    // ✅ Get All Parcels
    app.get("/parcels", async (req, res) => {
      try {
        const parcels = await parcelCollection.find().toArray();
        res.send(parcels);
      } catch (error) {
        res.status(500).send({ error: "Failed to fetch parcels" });
      }
    });

    // ✅ Create Parcel
    app.post("/parcels", async (req, res) => {
      try {
        const parcel = req.body;

        parcel.created_by = parcel.userEmail;
        parcel.creation_date = new Date();
        parcel.parcelStatus = "pending";
        parcel.paymentStatus = "unpaid";

        const result = await parcelCollection.insertOne(parcel);
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: "Failed to create parcel" });
      }
    });

    // ✅ Get User Parcels (latest first)
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
      } catch (error) {
        res.status(500).send({ error: "Failed to fetch user parcels" });
      }
    });

    // 🚀 ✅ FIXED: Parcel Stats API (THIS WAS MISSING)
    app.get("/parcels/stats", async (req, res) => {
      try {
        const email = req.query.email;

        if (!email) {
          return res.status(400).send({ error: "Email is required" });
        }

        const statsData = await parcelCollection
          .aggregate([
            {
              $match: { created_by: email },
            },
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
      } catch (error) {
        res.status(500).send({ error: "Failed to fetch stats" });
      }
    });

    await client.db("admin").command({ ping: 1 });
    console.log("✅ Connected to MongoDB");
  } finally {
    // keep alive
  }
}

run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("parcel Server Is Running");
});

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
