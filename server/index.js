const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 5000;

app.use(cors());

// Normal images (unchanged)
app.get("/api/images", (req, res) => {
  const imagesDir = path.join(__dirname, "images");
  fs.readdir(imagesDir, (err, files) => {
    if (err) return res.status(500).json({ error: "Failed to read images" });
    const imageUrls = files.map((file) => `/images/${file}`);
    res.json(imageUrls);
  });
});
app.use("/images", express.static(path.join(__dirname, "images")));

// Boss images (normal bubbles)
app.get("/api/bossimgs", (req, res) => {
  const bossImgsDir = path.join(__dirname, "bossimgs");
  fs.readdir(bossImgsDir, (err, files) => {
    if (err) return res.status(500).json({ error: "Failed to read boss images" });
    // filter out directories
    const onlyFiles = files.filter(f => !fs.statSync(path.join(bossImgsDir, f)).isDirectory());
    res.json(onlyFiles);
  });
});
app.use("/bossimgs", express.static(path.join(__dirname, "bossimgs")));

// Super bubble images moved to separate folder: superbubbleimg
app.get("/api/superbubbleimg", (req, res) => {
  const superBubbleDir = path.join(__dirname, "superbubbleimg");
  fs.readdir(superBubbleDir, (err, files) => {
    if (err)
      return res.status(500).json({ error: "Failed to read superbubble images" });
    const onlyFiles = files.filter(f => !fs.statSync(path.join(superBubbleDir, f)).isDirectory());
    res.json(onlyFiles);
  });
});
app.use("/superbubbleimg", express.static(path.join(__dirname, "superbubbleimg")));

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
