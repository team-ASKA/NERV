/**
 * Emotion analysis service for facial expression detection
 */
import { HumeClient } from 'hume';

interface EmotionData {
  name: string;
  score: number;
}

/**
 * Initialize Hume client for emotion analysis
 * @param apiKey The Hume API key
 * @param secretKey The Hume Secret key
 * @returns The Hume client
 */
export const initializeHumeClient = (apiKey: string, secretKey: string): HumeClient => {
  try {
    return new HumeClient({
      apiKey: apiKey,
      secretKey: secretKey,
    });
  } catch (error) {
    console.error('Error initializing Hume client:', error);
    throw new Error(`Failed to initialize Hume client: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

/**
 * Analyze emotions from an image using Hume API
 * @param client The Hume client
 * @param imageData Base64 encoded image data
 * @returns Array of detected emotions
 */
export const analyzeEmotions = async (
  client: HumeClient,
  imageData: string
): Promise<EmotionData[]> => {
  try {
    // Remove data URL prefix if present
    const base64Data = imageData.includes('data:image')
      ? imageData.split(',')[1]
      : imageData;
    
    // Call Hume API
    const response = await client.analyzeImage({
      image: {
        data: base64Data,
      },
      models: {
        face: {},
      },
    });
    
    // Extract emotion data from response
    const faceResults = response.face?.predictions || [];
    
    if (faceResults.length === 0) {
      console.log('No faces detected in the image');
      return [];
    }
    
    // Extract emotions from the first detected face
    const emotions = faceResults[0]?.emotions || [];
    
    // Convert to our EmotionData format and sort by score
    const formattedEmotions: EmotionData[] = emotions
      .map((emotion: any) => ({
        name: emotion.name,
        score: emotion.score,
      }))
      .sort((a: EmotionData, b: EmotionData) => b.score - a.score)
      .slice(0, 5); // Only keep top 5 emotions
    
    return formattedEmotions;
  } catch (error) {
    console.error('Error analyzing emotions:', error);
    return [];
  }
};

/**
 * Capture image from video element for emotion analysis
 * @param videoElement The video element to capture from
 * @returns Base64 encoded image data
 */
export const captureImageFromVideo = (
  videoElement: HTMLVideoElement | null
): string => {
  if (!videoElement) {
    console.error('Video element is null, cannot capture image');
    return '';
  }
  
  try {
    // Create a canvas element to draw the video frame
    const canvas = document.createElement('canvas');
    const { videoWidth, videoHeight } = videoElement;
    
    // Set the canvas dimensions to match the video
    canvas.width = videoWidth;
    canvas.height = videoHeight;
    
    // Draw the current video frame on the canvas
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Could not get canvas context');
    }
    
    // Draw the video frame
    context.drawImage(videoElement, 0, 0, videoWidth, videoHeight);
    
    // Convert canvas to base64 data URL and return
    return canvas.toDataURL('image/jpeg', 0.8);
  } catch (error) {
    console.error('Error capturing image from video:', error);
    return '';
  }
};

/**
 * Optimize emotion analysis by throttling and batch processing
 * @param client The Hume client
 * @param videoElement The video element to capture from
 * @param interval Capture interval in milliseconds
 * @param callback Callback function to receive emotion updates
 * @returns Function to stop the analysis
 */
export const startOptimizedEmotionAnalysis = (
  client: HumeClient,
  videoElement: HTMLVideoElement | null,
  interval: number = 2000, // Default: Capture every 2 seconds
  callback: (emotions: EmotionData[]) => void
): () => void => {
  if (!videoElement) {
    console.error('Video element is null, cannot start emotion analysis');
    return () => {};
  }
  
  let isAnalyzing = false;
  let stopRequested = false;
  let emotionBuffer: EmotionData[] = [];
  let analysisCount = 0;
  
  // Start the analysis loop
  const analyzeLoop = async () => {
    if (stopRequested) {
      return;
    }
    
    if (!isAnalyzing) {
      isAnalyzing = true;
      
      try {
        // Capture image from video
        const imageData = captureImageFromVideo(videoElement);
        
        if (imageData) {
          // Analyze emotions
          const emotions = await analyzeEmotions(client, imageData);
          
          // Only update if we have valid emotions
          if (emotions.length > 0) {
            emotionBuffer = [...emotionBuffer, ...emotions];
            
            // Every 3 analyses, average the emotions and send to callback
            analysisCount++;
            if (analysisCount >= 3) {
              // Calculate average emotions
              const averagedEmotions = averageEmotions(emotionBuffer);
              // Send to callback
              callback(averagedEmotions);
              // Reset buffer and count
              emotionBuffer = [];
              analysisCount = 0;
            }
          }
        }
      } catch (error) {
        console.error('Error in emotion analysis loop:', error);
      } finally {
        isAnalyzing = false;
      }
    }
    
    // Schedule next analysis
    setTimeout(analyzeLoop, interval);
  };
  
  // Start the analysis loop
  analyzeLoop();
  
  // Return function to stop analysis
  return () => {
    stopRequested = true;
  };
};

/**
 * Average multiple emotion readings
 * @param emotions Array of emotion data arrays
 * @returns Averaged emotions
 */
const averageEmotions = (emotions: EmotionData[]): EmotionData[] => {
  if (emotions.length === 0) {
    return [];
  }
  
  // Create a map to store accumulated scores for each emotion
  const emotionMap = new Map<string, { total: number; count: number }>();
  
  // Accumulate scores
  emotions.forEach((emotion) => {
    const existing = emotionMap.get(emotion.name);
    if (existing) {
      existing.total += emotion.score;
      existing.count += 1;
    } else {
      emotionMap.set(emotion.name, { total: emotion.score, count: 1 });
    }
  });
  
  // Calculate averages and convert to array
  const averagedEmotions: EmotionData[] = Array.from(emotionMap.entries()).map(
    ([name, { total, count }]) => ({
      name,
      score: total / count,
    })
  );
  
  // Sort by score (highest first) and return top 5
  return averagedEmotions
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}; 