import mongoose from "mongoose";
import Redis from "ioredis";

async function testConnections() {
  // Test MongoDB
  try {
    await mongoose.connect("mongodb://localhost:27017/job_scheduler");
    console.log("✅ MongoDB connected");
    
    // Create a test collection
    const testSchema = new mongoose.Schema({ name: String, timestamp: Date });
    const Test = mongoose.model("ConnectionTest", testSchema);
    
    await Test.create({ name: "test", timestamp: new Date() });
    console.log("✅ MongoDB write successful");
    
    const count = await Test.countDocuments();
    console.log(`✅ MongoDB has ${count} documents`);
    
    await mongoose.connection.close();
  } catch (err) {
    console.error("❌ MongoDB error:", err.message);
  }

  // Test Redis
  try {
    const redis = new Redis({
      host: "localhost",
      port: 6379,
    });
    
    await redis.set("connection_test", "working");
    const value = await redis.get("connection_test");
    console.log("✅ Redis connected, test value:", value);
    
    // Test Redis operations for job queue
    await redis.zadd("test_queue", Date.now(), "job_1");
    const queueSize = await redis.zcard("test_queue");
    console.log(`✅ Redis sorted set working, queue size: ${queueSize}`);
    
    redis.disconnect();
  } catch (err) {
    console.error("❌ Redis error:", err.message);
  }
  
  console.log("\n✅ Database setup complete! Ready to build job scheduler.");
  process.exit(0);
}

testConnections();