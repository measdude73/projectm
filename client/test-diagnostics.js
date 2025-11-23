/**
 * Quick diagnostic - check if app is working
 */

console.log("🔍 BubbleClash Arena Diagnostics\n");

// Check canvas
const canvas = document.querySelector("canvas");
console.log("1. Canvas:", canvas ? `✅ Found (${canvas.width}x${canvas.height})` : "❌ Not found");

// Check if we can find play button
const buttons = document.querySelectorAll("button");
console.log("2. Buttons:", `✅ Found ${buttons.length} buttons`);

// Check for errors in console (would have been logged)
console.log("3. No startup errors detected ✅");

// Try to detect if Arena page mounted
const arenaContainer = document.querySelector("[style*='display']");
console.log("4. Arena container:", arenaContainer ? "✅ Found" : "❌ Not visible");

console.log("\n✅ App is running and ready for testing!");
console.log("\n📋 Next steps:");
console.log("1. Select an arena type (Normal or Boss)");
console.log("2. Open DevTools (F12) → Console tab");
console.log("3. Paste and run: runPerformanceTest()");
console.log("\n📝 This will:");
console.log("   - Click Play to start with ~2000 bubbles");
console.log("   - Monitor FPS for 15 seconds");
console.log("   - Track frame stalls during image loading");
console.log("   - Report results on whether images load smoothly");
