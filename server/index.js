const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 5000;

app.use(cors());

// Serve images list
app.get("/api/images", (req, res) => {
  const imagesDir = path.join(__dirname, "images"); // folder inside server
  fs.readdir(imagesDir, (err, files) => {
    if (err) return res.status(500).json({ error: "Failed to read images" });
    const imageUrls = files.map(file => `/images/${file}`);
    res.json(imageUrls);
  });
});

// Serve static images
app.use("/images", express.static(path.join(__dirname, "images")));

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
