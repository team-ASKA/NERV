import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import VideoSnippet from '../../models/VideoSnippet';
import connectDB from '../../db/connection';

const router = express.Router();

// Set up multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../../uploads/videos');
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueId = uuidv4();
    const extension = path.extname(file.originalname);
    cb(null, `${uniqueId}${extension}`);
  }
});

const upload = multer({ 
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB file size limit
  },
  fileFilter: (req, file, cb) => {
    // Accept only video files
    const allowedTypes = ['video/webm', 'video/mp4', 'video/quicktime'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only webm, mp4, and quicktime videos are allowed.') as any);
    }
  }
});

// Connect to MongoDB
connectDB();

// POST /api/videos/upload - upload a video snippet
router.post('/upload', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided' });
    }

    const { 
      userId, 
      interviewId, 
      questionId, 
      question, 
      answer, 
      emotions, 
      duration 
    } = req.body;

    // Validate required fields
    if (!userId || !interviewId || !questionId || !question || !answer) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Create file path for client access
    const videoUrl = `/uploads/videos/${req.file.filename}`;

    // Create new video snippet document
    const videoSnippet = new VideoSnippet({
      userId,
      interviewId,
      questionId,
      question,
      answer,
      videoUrl,
      emotions: JSON.parse(emotions),
      duration: parseInt(duration) || 0,
      timestamp: new Date()
    });

    // Save to database
    await videoSnippet.save();

    res.status(201).json({
      success: true,
      videoUrl,
      videoId: videoSnippet._id
    });
  } catch (error) {
    console.error('Error uploading video:', error);
    res.status(500).json({ error: 'Server error uploading video' });
  }
});

// GET /api/videos/:interviewId - get all videos for a specific interview
router.get('/:interviewId', async (req, res) => {
  try {
    const { interviewId } = req.params;
    
    if (!interviewId) {
      return res.status(400).json({ error: 'Interview ID is required' });
    }
    
    const videos = await VideoSnippet.find({ interviewId })
      .sort({ timestamp: 1 })
      .lean();
    
    res.status(200).json(videos);
  } catch (error) {
    console.error('Error fetching videos:', error);
    res.status(500).json({ error: 'Server error fetching videos' });
  }
});

export default router; 