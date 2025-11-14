const express = require("express");
const serverless = require("serverless-http");
const admin = require("firebase-admin");

const app = express();

let credential;

if (process.env.NODE_ENV === "production") {
  credential = admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL
  });
} else {
  credential = admin.credential.applicationDefault();
}

admin.initializeApp({ credential });

app.get("/", (req, res) => {
  res.json({ message: "Serverless Firebase-Express is Running!" });
});

module.exports = serverless(app);
