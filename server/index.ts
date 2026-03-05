import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import technicalRound from "./routes/technicalRound";
import projectRound from "./routes/projectRound";
import hrRound from "./routes/hrRound";
import summary from "./routes/summary";

dotenv.config();

// Require keys from environment
if (!process.env.GEMINI_API_KEY) {
  console.warn('GEMINI_API_KEY not set - all AI features will fail');
}

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use("/api/technical", technicalRound);
app.use("/api/project", projectRound);
app.use("/api/hr", hrRound);
app.use("/api/summary", summary);

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "OK", message: "Interview API Server is running" });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Health check available at: http://localhost:${PORT}/health`);
});
