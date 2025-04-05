import mongoose, { Schema, Document } from 'mongoose';

export interface IVideoSnippet extends Document {
  userId: string;
  interviewId: string;
  questionId: string;
  question: string;
  answer: string;
  videoUrl: string;
  emotions: {
    name: string;
    score: number;
  }[];
  duration: number;
  timestamp: Date;
}

const VideoSnippetSchema: Schema = new Schema({
  userId: { type: String, required: true, index: true },
  interviewId: { type: String, required: true, index: true },
  questionId: { type: String, required: true },
  question: { type: String, required: true },
  answer: { type: String, required: true },
  videoUrl: { type: String, required: true },
  emotions: [{
    name: { type: String, required: true },
    score: { type: Number, required: true }
  }],
  duration: { type: Number, required: true },
  timestamp: { type: Date, default: Date.now }
});

// Create index for faster queries
VideoSnippetSchema.index({ userId: 1, interviewId: 1 });

export default mongoose.model<IVideoSnippet>('VideoSnippet', VideoSnippetSchema); 