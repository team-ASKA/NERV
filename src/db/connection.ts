import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/orato';

const connectDB = async () => {
  if (mongoose.connections[0].readyState) {
    // If already connected, use the existing connection
    console.log('Using existing MongoDB connection');
    return;
  }

  try {
    await mongoose.connect(MONGODB_URI);
    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

export default connectDB; 