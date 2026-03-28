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

    // ✅ Get All Parcels (existing)
    app.get("/parcels", async (req, res) => {
      try {
        const parcels = await parcelCollection.find().toArray();
        res.send(parcels);
      } catch (error) {
        res.status(500).send({ error: "Failed to fetch parcels" });
      }
    });

    // ✅ Create Parcel (UPDATED 🔥)
    app.post("/parcels", async (req, res) => {
      try {
        const parcel = req.body;

        // 🔥 Add extra fields (IMPORTANT)
        parcel.created_by = parcel.userEmail; // or from auth later
        parcel.creation_date = new Date();
        parcel.parcelStatus = "pending";
        parcel.paymentStatus = "unpaid";

        const result = await parcelCollection.insertOne(parcel);
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: "Failed to create parcel" });
      }
    });

    // ✅ 🔥 NEW API: Get Parcels by User Email (Latest First)
    app.get("/parcels/user", async (req, res) => {
      try {
        const email = req.query.email;

        if (!email) {
          return res.status(400).send({ error: "Email is required" });
        }

        const query = { created_by: email };

        const parcels = await parcelCollection
          .find(query)
          .sort({ creation_date: -1 }) // 🔥 latest first
          .toArray();

        res.send(parcels);
      } catch (error) {
        res.status(500).send({ error: "Failed to fetch user parcels" });
      }
    });

    await client.db("admin").command({ ping: 1 });
    console.log("✅ Connected to MongoDB");
  } finally {
    // keep connection alive
  }
}

run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("parcel Server Is Running");
});

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
